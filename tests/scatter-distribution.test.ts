/**
 * VAL BORBERA HILLCLIMB — Scatter Distribution Regression Suite
 *
 * The existing scatter tests check that nothing is IN the road and that everything sits ON
 * the ground. Both passed while the scatter itself was badly broken, because neither looks
 * at how the placements are DISTRIBUTED.
 *
 * The bug they missed: every attribute of a scattered object was read off one random value.
 *
 *   const rand = fract(sin(i * 12.9898 + k * 78.233) * 43758.5453);
 *   const side = rand > 0.5 ? 1 : -1;
 *   const dist = halfWidth + 3.6 + rand * maxTreeDist + k * 6;
 *   ... and scale, rotation, species and rock-vs-tree from the same `rand`
 *
 * Side and distance could not disagree, and species is a threshold on the same number, so it
 * inherited the split. Measured on Borbera Sprint before the fix: left-hand trees stood
 * 7.5-33.5 m from the road and right-hand trees 23.9-54.3 m — ranges that barely overlap —
 * with 281 cypresses on the left and NONE on the right, and 74 boulders on the right and
 * none on the left. Every individual placement was legal. The population was nonsense.
 *
 * So these tests assert properties of the POPULATION, which is the level the defect lived
 * at. They are deliberately loose — scatter is random and a stage's exposure genuinely is
 * asymmetric, so a 90/10 split is allowed and only a near-total one fails. A test that
 * demanded balance would fail on honest terrain.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { RoadMesh } from "../src/game/track/RoadMesh";
import { createHeightField } from "../src/game/track/terrain/heightField";
import { TerrainSystem } from "../src/game/track/terrain/TerrainSystem";
import { buildHamlet } from "../src/game/track/HamletBuilder";

interface Placement {
  species: string;
  x: number;
  z: number;
  /** Signed lateral offset from the centreline: negative left, positive right. */
  t: number;
  /** Distance from the edge of the carriageway. */
  offEdge: number;
}

/** Builds one stage's world once and reads every scattered instance out of it. */
function scatterOf(stageId: string): { placements: Placement[]; buildings: { x: number; z: number; r: number }[] } {
  const spline = new TrackSpline(getStageDef(stageId));
  const field = createHeightField(spline);
  const road = new RoadMesh(spline, (x, z) => field.heightAt(x, z));
  const terrain = new TerrainSystem(spline, field, road.buildingFootprints);

  const placements: Placement[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();

  terrain.vegetationGroup.traverse((node) => {
    const inst = node as THREE.InstancedMesh;
    if (!inst.isInstancedMesh) return;
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const proj = spline.projectFrenet(p.x, p.z);
      placements.push({
        species: inst.name,
        x: p.x,
        z: p.z,
        t: proj.t,
        offEdge: Math.abs(proj.t) - proj.sample.halfWidth,
      });
    }
  });

  return { placements, buildings: road.buildingFootprints };
}

// Built once per stage and shared: constructing a stage's height field, road and terrain is
// by far the most expensive thing in this file, and every test below reads the same world.
const WORLDS = new Map<string, ReturnType<typeof scatterOf>>();
for (const entry of STAGE_LIST) WORLDS.set(entry.id, scatterOf(entry.id));

describe("Vegetation scatter is a population, not one number repeated", () => {
  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: no species lives entirely on one side of the road`, () => {
      const { placements } = WORLDS.get(stageId)!;
      const bySpecies = new Map<string, { left: number; right: number }>();
      for (const pl of placements) {
        const row = bySpecies.get(pl.species) ?? { left: 0, right: 0 };
        if (pl.t < 0) row.left++;
        else row.right++;
        bySpecies.set(pl.species, row);
      }

      for (const [species, row] of bySpecies) {
        const total = row.left + row.right;
        // Rare species are not evidence of anything; only judge ones with a real population.
        if (total < 25) continue;
        const minorityShare = Math.min(row.left, row.right) / total;
        assert.ok(
          minorityShare > 0.10,
          `${stageId}: ${species} is ${row.left} left / ${row.right} right — ` +
            `${(minorityShare * 100).toFixed(1)}% on its minority side. A species confined to one ` +
            `verge means an attribute is correlated with the side draw.`
        );
      }
    });

    it(`${stageId}: both verges are scattered over a comparable range of distances`, () => {
      const { placements } = WORLDS.get(stageId)!;
      // "veg-scrub" is a deliberate second population: sparse background filler placed
      // 65-225 m out to break up the bald mid-distance fields, an order of magnitude
      // further than the roadside hedge species this test protects. Its own side/distance
      // independence is covered by the "no species lives entirely on one side" test above;
      // mixing its much larger distances into this aggregate mean would fail on nothing
      // more than an ordinary random left/right count difference in that population, not on
      // the side draw dictating its distance draw.
      const roadside = placements.filter((p) => p.species !== "veg-scrub");
      const left = roadside.filter((p) => p.t < 0).map((p) => p.offEdge);
      const right = roadside.filter((p) => p.t > 0).map((p) => p.offEdge);
      assert.ok(left.length > 40 && right.length > 40, `${stageId}: too few placements to judge`);

      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const meanL = mean(left);
      const meanR = mean(right);

      // Before the fix these were 18.2 m and 35.8 m — the two sides did not merely differ,
      // one was a hedge and the other was distant scatter. Terrain is genuinely asymmetric
      // (the exposed side scatters further, by design), so this only rejects a gulf.
      assert.ok(
        Math.abs(meanL - meanR) < 9,
        `${stageId}: mean distance off the carriageway edge is ${meanL.toFixed(1)} m on the left ` +
          `and ${meanR.toFixed(1)} m on the right — the side draw is dictating the distance draw.`
      );

      // And each side must itself span a range rather than sit in a band.
      for (const [label, arr] of [["left", left], ["right", right]] as const) {
        const lo = Math.min(...arr);
        const hi = Math.max(...arr);
        assert.ok(
          hi - lo > 20,
          `${stageId}: ${label}-hand scatter spans only ${lo.toFixed(1)}-${hi.toFixed(1)} m off the edge`
        );
      }
    });

    it(`${stageId}: nothing is scattered inside a hamlet building`, () => {
      const { placements, buildings } = WORLDS.get(stageId)!;
      if (buildings.length === 0) return;
      let worst: { d: number; species: string } | null = null;
      for (const pl of placements) {
        for (const b of buildings) {
          const clearance = Math.hypot(b.x - pl.x, b.z - pl.z) - b.r;
          if (worst === null || clearance < worst.d) worst = { d: clearance, species: pl.species };
        }
      }
      assert.ok(worst !== null);
      assert.ok(
        worst.d > 0,
        `${stageId}: a ${worst.species} stands ${(-worst.d).toFixed(1)} m inside a building footprint`
      );
    });
  }
});

describe("Hamlets are villages, not repeated houses", () => {
  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: no two buildings occupy the same ground`, () => {
      const { buildings } = WORLDS.get(stageId)!;
      assert.ok(buildings.length > 0, `${stageId}: expected at least one hamlet`);
      for (let i = 0; i < buildings.length; i++) {
        for (let j = i + 1; j < buildings.length; j++) {
          const a = buildings[i];
          const b = buildings[j];
          const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
          assert.ok(
            gap > 0,
            `${stageId}: two buildings overlap by ${(-gap).toFixed(1)} m. ` +
              `The previous generator produced exactly this by running twice on the two ` +
              `samples village() marks, two metres apart, with the same seed.`
          );
        }
      }
    });

    it(`${stageId}: buildings are set back from the carriageway and have depth`, () => {
      const spline = new TrackSpline(getStageDef(stageId));
      const { buildings } = WORLDS.get(stageId)!;
      const offsets = buildings.map((b) => Math.abs(spline.projectFrenet(b.x, b.z).t));
      const lo = Math.min(...offsets);
      const hi = Math.max(...offsets);
      // Every dwelling used to stand 4.8-10.2 m from the centreline: a row along the
      // shoulder. A hamlet has depth, and the road passes it rather than running through
      // its front gardens.
      assert.ok(
        hi > 24,
        `${stageId}: the furthest building is only ${hi.toFixed(1)} m from the centreline — ` +
          `this is a row along the shoulder, not a village`
      );
      assert.ok(
        lo >= 8,
        `${stageId}: a building stands ${lo.toFixed(1)} m from the centreline, on the verge`
      );
    });
  }
});

describe("A hamlet is built from varied buildings", () => {
  // Exercises buildHamlet directly rather than through RoadMesh, because the landmark group
  // is merged by batchStaticGroup before it leaves RoadMesh and individual buildings are no
  // longer separable there.
  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: no two buildings in a hamlet are the same shape`, () => {
      const spline = new TrackSpline(getStageDef(stageId));
      const field = createHeightField(spline);
      const samples = spline.getAllSamples();

      let anchors = 0;
      let lastS = -Infinity;
      for (const s of samples) {
        if (s.landmark !== "hamlet" || s.s < 50) continue;
        if (s.s - lastS < 40) continue;
        lastS = s.s;
        anchors++;

        const group = new THREE.Group();
        buildHamlet(s, samples, group, (x, z) => field.heightAt(x, z));

        const shapes = new Set<string>();
        const wallColors = new Set<string>();
        const roofForms = new Set<string>();
        const box = new THREE.Box3();

        for (const child of group.children) {
          // Child order inside a building is plinth, body, roof, then openings.
          const body = child.children[1] as THREE.Mesh;
          const roof = child.children[2] as THREE.Mesh;
          box.setFromObject(body);
          const size = box.getSize(new THREE.Vector3());
          // Full precision. Two buildings rounding to the same tenth of a metre is a
          // coincidence; two with byte-identical dimensions is a generator that repeats
          // itself, which is exactly what the previous seed arithmetic did.
          shapes.add(`${size.x}x${size.y}x${size.z}`);
          wallColors.add((body.material as THREE.MeshStandardMaterial).color.getHexString());
          // A gable roof is the six-vertex prism; a hipped one is a four-sided cone.
          roofForms.add(roof.geometry.attributes.position.count === 6 ? "gable" : "hip");
        }

        assert.ok(group.children.length >= 5, `${stageId} s=${s.s.toFixed(0)}: only ${group.children.length} buildings`);
        // The old generator guaranteed repeats: its four dwellings' seeds were offset by
        // 5, 17, 52 and 64, which modulo the five variants are 0, 2, 2, 4 and modulo the six
        // wall colours are 5, 5, 4, 4 — two identical pairs, every time.
        assert.strictEqual(
          shapes.size,
          group.children.length,
          `${stageId} s=${s.s.toFixed(0)}: ${group.children.length} buildings but only ${shapes.size} ` +
            `distinct dimensions — some are exact clones of each other`
        );
        assert.ok(
          wallColors.size >= 3,
          `${stageId} s=${s.s.toFixed(0)}: only ${wallColors.size} wall colours across ${group.children.length} buildings`
        );
        assert.ok(roofForms.size >= 1);
      }

      assert.ok(anchors > 0, `${stageId}: expected at least one hamlet anchor`);
    });
  }
});
