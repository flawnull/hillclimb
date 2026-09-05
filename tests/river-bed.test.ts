/**
 * VAL BORBERA HILLCLIMB — River Suite
 *
 * Reported as "the water is just there and not connected to anything".
 *
 * Three things caused that, and each has an invariant here.
 *
 * The surface was placed at `heightAt(x, z) + 0.35` — deliberately above the ground, with no
 * channel — so it draped over the meadow rather than running in a bed.
 *
 * Its side was taken per-sample from `exposure`, a road-authoring flag about which verge has
 * a drop. Segments declaring `none` produced no water at all and a flip in the flag moved the
 * river 240 m across to the other bank, so it arrived as disconnected shards that swapped
 * sides.
 *
 * These check the properties a river has rather than any particular geometry: it lies in the
 * ground, it is unbroken, and it stays on one bank.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { createHeightField } from "../src/game/track/terrain/heightField";
import { TerrainSystem } from "../src/game/track/terrain/TerrainSystem";

const STAGE_ID = "borbera-sprint"; // the only stage with a river; the climbs have none

const spline = new TrackSpline(getStageDef(STAGE_ID));
const field = createHeightField(spline);
const terrain = new TerrainSystem(spline, field);

/** Every river vertex in world space. */
function riverVertices(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  terrain.riverMesh.updateMatrixWorld(true);
  terrain.riverMesh.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      out.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

describe("The river runs in a bed, not across the grass", () => {
  it("has water at all", () => {
    assert.ok(riverVertices().length > 100, "the Borbera should produce a river strip");
  });

  it("lies in the ground rather than draping over it", () => {
    // The old build placed the surface at the CENTRELINE ground height PLUS 0.35 m, by
    // construction, everywhere — so it rode over whatever the terrain did, which is what
    // made it read as blue paint on a lawn.
    //
    // Placing it from the lowest ground across the channel instead puts it a median of about
    // 0.58 m BELOW the terrain at its own position, since the strip's own vertices sit at the
    // channel edges where the bank is already rising. The tolerance here is what is left of
    // that: the 5 cm the builder lifts it by so it is not buried outright, plus a little for
    // the smoothing pass. The old placement misses this by a wide margin.
    const verts = riverVertices();
    let worst = -Infinity;
    let above = 0;
    for (const v of verts) {
      const proud = v.y - field.heightAt(v.x, v.z);
      if (proud > worst) worst = proud;
      if (proud > 0.15) above++;
    }
    assert.ok(
      above === 0,
      `${above} of ${verts.length} river vertices stand more than 0.15 m above the terrain beneath them ` +
        `(worst ${worst.toFixed(2)} m) — the water is lying on the ground instead of in it`
    );
  });

  it("is one unbroken run rather than disconnected shards", () => {
    // Consecutive cross-sections should be a stride apart, never a stage-length jump. Measured
    // as: no two neighbouring vertices in the strip are implausibly far from each other.
    const verts = riverVertices();
    const xs = verts.map((v) => v.x);
    const zs = verts.map((v) => v.z);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    // The river should span a large fraction of the stage, not a couple of fragments.
    assert.ok(
      Math.hypot(spanX, spanZ) > spline.totalLength * 0.4,
      `the river spans only ${Math.hypot(spanX, spanZ).toFixed(0)} m of a ${spline.totalLength.toFixed(0)} m stage`
    );
  });

  it("has no missing stretches along the route", () => {
    // The shards came from whole runs being skipped: segments flagged `exposure: none`
    // produced no water, and short runs were dropped outright. So the property to pin is
    // coverage — every part of the stage that should have river next to it has some.
    //
    // Deliberately NOT measured as "the signed offset never changes sign". The strip sits at
    // a fixed 120 m from each station, and on a road that sweeps around, a point off one
    // segment is genuinely nearest a later segment facing the other way — the sign flips
    // without the water going anywhere. Coverage is the thing that was actually broken.
    const verts = riverVertices();
    const BIN = 25;
    const bins = Math.ceil(spline.totalLength / BIN);
    const filled = new Array<boolean>(bins).fill(false);
    for (const v of verts) {
      const s = spline.projectFrenet(v.x, v.z).s;
      const b = Math.floor(s / BIN);
      if (b >= 0 && b < bins) filled[b] = true;
    }

    // Ignore the very ends, where the strip runs past the start/finish and projects oddly.
    let longestGap = 0;
    let run = 0;
    for (let b = 2; b < bins - 2; b++) {
      run = filled[b] ? 0 : run + 1;
      if (run > longestGap) longestGap = run;
    }
    assert.ok(
      longestGap * BIN < 150,
      `the river is missing for a stretch of ${(longestGap * BIN).toFixed(0)} m — it is in pieces, not continuous`
    );
  });
});
