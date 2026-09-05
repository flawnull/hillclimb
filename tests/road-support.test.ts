/**
 * VAL BORBERA HILLCLIMB — Road Support Suite
 *
 * "The road is floating" was the longest-running complaint about this game, and nothing
 * tested for it. The existing terrain suites check that the ground is never ABOVE the road
 * (clearance) and that the field is continuous (Lipschitz); both are satisfied perfectly by
 * a carriageway suspended a hundred metres in the air.
 *
 * What was actually wrong: `roadProfile.ts` used a fixed falloff RATE for the exposed drop,
 * so the slope at the verge was `dropDepth * 0.055` — a stage declaring a 250 m drop fell
 * 13.75 m for every metre off the verge. The carve layer combines road samples by MINIMUM,
 * so one such sample pulled the ground out from under its neighbours too. Measured on Salita
 * di Cosola before the fix, the surface sat 20-130 m below the carriageway three metres off
 * the centreline along most of the stage.
 *
 * These tests measure the thing the player sees: how far the ground is below the edge of the
 * road they are driving on, and whether there is any structure holding it up where it is
 * genuinely in the air.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { RoadMesh } from "../src/game/track/RoadMesh";
import { createHeightField } from "../src/game/track/terrain/heightField";
import { TerrainSystem } from "../src/game/track/terrain/TerrainSystem";

/** Matches TerrainSystem.buildEmbankment: below this the verge meets the ground. */
const MIN_EXPOSED = 3.5;
/** Matches TerrainSystem.buildEmbankment: above this the road is on a viaduct, not a wall. */
const MAX_WALL = 16;

interface Node {
  x: number;
  y: number;
  z: number;
  /** How far the outer edge of the verge stands above the ground beneath it, metres. */
  gap: number;
}

function verticalProfile(stageId: string): { nodes: Node[]; terrain: TerrainSystem } {
  const spline = new TrackSpline(getStageDef(stageId));
  const field = createHeightField(spline);
  const terrain = new TerrainSystem(spline, field);
  const nodes: Node[] = [];

  for (const s of spline.getAllSamples()) {
    for (const side of [-1, 1] as const) {
      const lat = (s.halfWidth + 1.2) * side;
      const x = s.x + s.normalX * lat;
      const z = s.z + s.normalZ * lat;
      const top = s.y - 0.28;
      nodes.push({ x, y: top, z, gap: top - field.heightAt(x, z) });
    }
  }

  return { nodes, terrain };
}

const PROFILES = new Map<string, ReturnType<typeof verticalProfile>>();
for (const entry of STAGE_LIST) PROFILES.set(entry.id, verticalProfile(entry.id));

describe("The road stands on the ground", () => {
  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: the carriageway is bedded into the hillside for most of its length`, () => {
      const { nodes } = PROFILES.get(stageId)!;
      const gaps = nodes.map((n) => n.gap).sort((a, b) => a - b);
      const p50 = gaps[Math.floor(gaps.length * 0.5)];
      const p90 = gaps[Math.floor(gaps.length * 0.9)];

      // Measured after the fix: Borbera Sprint p50 0.20 m / p90 0.28 m; Salita di Cosola
      // p50 0.73 m / p90 1.64 m. Before it, the same measurement ran to tens of metres over
      // most of Salita. The thresholds are loose enough that ordinary terrain variation and
      // future stage authoring will not trip them, and tight enough that the old behaviour
      // could not possibly pass.
      assert.ok(
        p50 < 2.0,
        `${stageId}: the median verge stands ${p50.toFixed(2)} m above the ground beneath it — ` +
          `half the stage is on structure or in the air`
      );
      assert.ok(
        p90 < MIN_EXPOSED,
        `${stageId}: 10% of the stage has its verge more than ${p90.toFixed(2)} m above the ground`
      );
    });

    it(`${stageId}: only a small part of the stage needs to be carried on a viaduct`, () => {
      const { nodes } = PROFILES.get(stageId)!;
      const onViaduct = nodes.filter((n) => n.gap > MAX_WALL).length;
      const share = onViaduct / nodes.length;
      // A single-valued heightfield cannot be under both legs of a stacked switchback, so
      // some viaduct is inherent and correct. A LOT of it means the carve has broken again:
      // before the profile fix, Salita di Cosola wanted roughly a kilometre of it.
      assert.ok(
        share < 0.12,
        `${stageId}: ${(share * 100).toFixed(1)}% of the verge is more than ${MAX_WALL} m above ` +
          `the ground (${onViaduct} of ${nodes.length} nodes) — that is a bridge, not a hill road`
      );
    });

    it(`${stageId}: nothing is left hanging in the air with no structure under it`, () => {
      const { nodes, terrain } = PROFILES.get(stageId)!;

      // Every embankment / fascia / pier vertex, in world space.
      const structure: THREE.Vector3[] = [];
      terrain.embankmentMesh.updateMatrixWorld(true);
      terrain.embankmentMesh.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          structure.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld));
        }
      });

      // Only the genuinely airborne stretches are judged. Between MIN_EXPOSED and MAX_WALL
      // the builder deliberately drops runs shorter than 26 m, because a 10 m stub of
      // retaining wall reads as a detached slab standing in the grass rather than as
      // structure; a 4 m bank with no wall is a bank. Above MAX_WALL there is no such
      // argument — that is a carriageway in mid-air.
      const airborne = nodes.filter((n) => n.gap > MAX_WALL);
      if (airborne.length === 0) return;
      assert.ok(structure.length > 0, `${stageId}: ${airborne.length} airborne nodes and no structure at all`);

      let unsupported = 0;
      let worst: Node | null = null;
      for (const n of airborne) {
        const held = structure.some(
          (v) => Math.hypot(v.x - n.x, v.z - n.z) < 6.0 && v.y < n.y + 1.0
        );
        if (!held) {
          unsupported++;
          if (!worst || n.gap > worst.gap) worst = n;
        }
      }

      assert.strictEqual(
        unsupported,
        0,
        `${stageId}: ${unsupported} of ${airborne.length} airborne verge nodes have no embankment, ` +
          `deck fascia or pier beneath them (worst: ${worst?.gap.toFixed(1)} m above the ground)`
      );
    });

    it(`${stageId}: the carriageway is solid when seen from underneath`, () => {
      // The deck is one sheet with a top face and no soffit, so whether it exists at all
      // from below is decided entirely by `material.side` (see RoadMesh's material). At the
      // three.js default of `FrontSide` it is culled from underneath and the sky shows
      // through it — guardrails and kerb markers hanging over an empty gap wherever a
      // switchback passes above you. Raycaster honours `material.side` exactly as the
      // rasteriser does, so probing from both directions is a faithful test of what the
      // player will actually see.
      const spline = new TrackSpline(getStageDef(stageId));
      const road = new RoadMesh(spline);
      const raycaster = new THREE.Raycaster();
      const samples = spline.getAllSamples();

      let above = 0;
      let below = 0;
      let probes = 0;
      for (let i = 0; i < samples.length; i += 20) {
        const s = samples[i];
        probes++;
        raycaster.set(new THREE.Vector3(s.x, s.y + 30, s.z), new THREE.Vector3(0, -1, 0));
        if (raycaster.intersectObject(road.mesh, true).length > 0) above++;
        raycaster.set(new THREE.Vector3(s.x, s.y - 30, s.z), new THREE.Vector3(0, 1, 0));
        if (raycaster.intersectObject(road.mesh, true).length > 0) below++;
      }

      assert.ok(above > probes * 0.9, `${stageId}: deck missing from ABOVE at ${probes - above}/${probes} probes`);
      assert.strictEqual(
        below,
        above,
        `${stageId}: the deck is visible from above at ${above}/${probes} probe points but from ` +
          `below at only ${below} — it is see-through from underneath, so the sky shows where the ` +
          `carriageway should be`
      );
    });
  }
});
