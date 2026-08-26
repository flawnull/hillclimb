/**
 * VAL BORBERA HILLCLIMB — Terrain Continuity Regression Suite
 *
 * Two structural bugs, both reported by the user as "textures/mountain look broken
 * further along the road" and confirmed live: trees floating disconnected from any
 * visible ground, and a hard-edged "cardboard wedge" cliff in the distant mountains.
 *
 * Neither was a texture bug. Both were the terrain-generation math disagreeing with
 * itself across two different code paths that are each individually correct in
 * isolation but were never checked against each other.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { TerrainSystem } from "../src/game/track/terrain/TerrainSystem";

describe("Vegetation is grounded on the surface that is actually drawn", () => {
  for (const entry of STAGE_LIST) {
    it(`${entry.id}: every instance sits on the height field`, () => {
      const spline = new TrackSpline(getStageDef(entry.id));
      const system = new TerrainSystem(spline);

      const mat4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      let worst = 0;
      let checked = 0;

      system.vegetationGroup.traverse((node) => {
        if (!(node instanceof THREE.InstancedMesh)) return;
        for (let i = 0; i < node.count; i++) {
          node.getMatrixAt(i, mat4);
          pos.setFromMatrixPosition(mat4);
          checked++;
          worst = Math.max(worst, Math.abs(pos.y - system.field.heightAt(pos.x, pos.z)));
        }
      });

      assert.ok(checked > 100, `${entry.id}: only ${checked} instances placed`);
      // Instances are deliberately embedded a little into the ground; anything beyond
      // 1.5 m means the scatter is grounding against a different surface than the mesh.
      assert.ok(worst < 1.5, `${entry.id}: worst instance is ${worst.toFixed(2)} m off the field`);
    });
  }
});

describe("The terrain has no second surface", () => {
  for (const entry of STAGE_LIST) {
    it(`${entry.id}: TerrainSystem exposes no separate backdrop`, () => {
      const spline = new TrackSpline(getStageDef(entry.id));
      const system = new TerrainSystem(spline);
      assert.equal(
        (system as unknown as Record<string, unknown>).backdropMesh,
        undefined,
        "a separate backdrop surface is exactly the defect this refactor removed"
      );
    });
  }
});
