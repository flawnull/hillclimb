/**
 * VAL BORBERA HILLCLIMB — Scene Budget Regression Suite (§13.3)
 *
 * Draw calls and visible triangles can only be measured with a live renderer, and a
 * browser is not available in CI. What CAN be pinned here is the thing that actually
 * regressed: how many separate renderable objects and triangles a stage builds.
 *
 * Roadside furniture is authored one prop at a time. Before batching, Salita di Cosola
 * constructed 7,644 individual meshes — every one an object the renderer must matrix-
 * update, frustum-test and issue a draw call for, against a budget of 120 draw calls.
 * These ceilings exist so that adding scenery cannot quietly undo that again.
 *
 * If a ceiling fails after deliberately adding detail, raise it in the same commit and
 * say why — do not delete the assertion.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { RoadMesh } from "../src/game/track/RoadMesh";
import { Terrain } from "../src/game/track/Terrain";
import { countRenderables } from "../src/game/track/batchStatics";

/** Renderable objects a stage may build. Draw calls per frame are a subset of this. */
const MAX_MESHES: Record<string, number> = {
  "borbera-sprint": 300,
  "salita-cosola": 520,
  "cresta-ebro": 300,
};

/** Total triangles in a stage. Only a fraction is visible at once, but this bounds memory
 *  and the worst case where a long climb is in view all at once. */
//  Lowered after the §13.3 road/prop decimation pass: the ribbon now emits a cross-section
//  only when the heading turns ~1.5 deg or 6 m of arc passes (was: every ~1.2 m spline
//  sample), and roadside posts use 6 radial segments instead of THREE's 32-segment default.
//  Salita di Cosola went 559,382 -> 262,122 triangles. Measured totals are
//  82,476 / 262,122 / 92,164; the ceilings keep ~15% headroom for scenery work.
const MAX_TRIANGLES: Record<string, number> = {
  "borbera-sprint": 95_000,
  "salita-cosola": 300_000,
  "cresta-ebro": 106_000,
};

function buildStageScene(stageId: string) {
  const spline = new TrackSpline(getStageDef(stageId));
  const road = new RoadMesh(spline);
  const terrain = new Terrain(spline);

  const root = new THREE.Group();
  root.add(
    road.mesh,
    road.landmarkGroup,
    road.guardrailGroup,
    terrain.mesh,
    terrain.riverMesh,
    terrain.backdropMesh,
    terrain.vegetationGroup
  );
  return { root, spline };
}

describe("Scene budget", () => {
  for (const entry of STAGE_LIST) {
    it(`${entry.id} stays within its renderable-object ceiling`, () => {
      const { root } = buildStageScene(entry.id);
      const stats = countRenderables(root);
      const ceiling = MAX_MESHES[entry.id];

      assert.ok(
        stats.meshes <= ceiling,
        `${entry.id}: ${stats.meshes} individual meshes exceeds ceiling ${ceiling}. ` +
          `Batching in batchStatics.ts is probably no longer collapsing a prop type — ` +
          `check that its material is bucketed by content (materialSignature).`
      );
    });

    it(`${entry.id} stays within its triangle ceiling`, () => {
      const { root } = buildStageScene(entry.id);
      const stats = countRenderables(root);
      const ceiling = MAX_TRIANGLES[entry.id];

      assert.ok(
        stats.triangles <= ceiling,
        `${entry.id}: ${stats.triangles} triangles exceeds ceiling ${ceiling}.`
      );
    });
  }

  it("large stage meshes are chunked so the frustum culler can reject them", () => {
    // The road ribbon and corridor terrain were each a single strip spanning the whole
    // stage — one 102,600-triangle mesh with a 1.4 km bounding radius, which no frustum
    // test can ever reject. Nothing should carry a radius approaching the camera far
    // plane (900 m) any more, except the deliberately distant mountain backdrop.
    const { root } = buildStageScene("salita-cosola");
    const oversized: number[] = [];

    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const r = mesh.geometry.boundingSphere?.radius ?? 0;
      const tris = mesh.geometry.index
        ? mesh.geometry.index.count / 3
        : mesh.geometry.attributes.position.count / 3;
      // The backdrop is one deliberate far-field mesh; ignore anything tiny.
      if (r > 900 && tris > 20_000) oversized.push(Math.round(r));
    });

    assert.ok(
      oversized.length <= 1,
      `Found ${oversized.length} unchunked stage-spanning meshes (radii ${oversized.join(", ")} m). ` +
        `Pass them through chunkMeshBySpace().`
    );
  });
  it("no ground triangle faces downward (see-through terrain guard)", () => {
    // Inside-out ground triangles are culled under `side: FrontSide`, so the player looks
    // straight through the hillside to the sky. Borbera Sprint shipped 1,076 of them.
    for (const stageId of ["borbera-sprint", "salita-cosola"]) {
      const spline = new TrackSpline(getStageDef(stageId));
      const terrain = new Terrain(spline);

      for (const [label, root] of [["corridor", terrain.mesh], ["river", terrain.riverMesh]] as const) {
        let down = 0;
        root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const pos = mesh.geometry.attributes.position;
          const idx = mesh.geometry.index;
          const tris = idx ? idx.count / 3 : pos.count / 3;
          for (let i = 0; i < tris; i++) {
            const a = idx ? idx.getX(i * 3) : i * 3;
            const b = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
            const c = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
            const e1x = pos.getX(b) - pos.getX(a), e1z = pos.getZ(b) - pos.getZ(a);
            const e2x = pos.getX(c) - pos.getX(a), e2z = pos.getZ(c) - pos.getZ(a);
            if (e1z * e2x - e1x * e2z < -1e-6) down++;
          }
        });
        assert.equal(down, 0, `${stageId} ${label}: ${down} downward-facing triangles`);
      }
    }
  });
});
