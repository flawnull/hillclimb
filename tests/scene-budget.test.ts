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
import { TerrainSystem } from "../src/game/track/terrain/TerrainSystem";
import { countRenderables } from "../src/game/track/batchStatics";

/** Renderable objects a stage may build. Draw calls per frame are a subset of this.
 *  Raised for the unified height field (Task 8): buildChunkedTerrain spatially chunks the
 *  graded quadtree into many small meshes so the frustum culler can reject distant ones,
 *  which trades a higher static mesh count for far fewer triangles drawn per frame.
 *  Measured totals are 1287 / 1421 / 1246; ceilings keep ~15% headroom. */
const MAX_MESHES: Record<string, number> = {
  "borbera-sprint": 470,
  "salita-cosola": 310,
};

/** Total triangles in a stage. Only a fraction is visible at once, but this bounds memory
 *  and the worst case where a long climb is in view all at once. */
//  Task 8 replaced the road-relative corridor + separate mountain backdrop with one
//  unified height-field terrain (world-space quadtree, Task 6/7). The old corridor could
//  be anisotropic — dense across the road, coarse off to the sides, with a wholly separate
//  low-poly backdrop mesh for the distant horizon. The new field is a single surface graded
//  uniformly by distance from the road in every direction, and ~18-21% of its triangles are
//  vertical LOD skirts that close cracks between quadtree cells of different sizes — neither
//  of which the old corridor had to pay for. Old combined totals (road + corridor + backdrop
//  + river + vegetation) were 82,476 / 262,122 / 92,164. New combined totals (road + unified
//  field + river + vegetation) are 74,432 / 282,462 / 81,696; the ceilings keep ~15% headroom
//  for scenery work.
const MAX_TRIANGLES: Record<string, number> = {
  "borbera-sprint": 94_000,
  "salita-cosola": 105_000,
};

/**
 * Meshes the prop batcher may leave behind per stage, and the floor on how much geometry
 * each of those meshes must be carrying.
 *
 * The mesh ceilings above bound how much a stage BUILDS. They say nothing about how well it
 * batches, and that is the number a browser on a laptop actually struggles with: measured on
 * one driving frame of Borbera Sprint, the landmark group alone cost 416 draw calls for 31k
 * triangles — 75 triangles per call — because `materialSignature` keyed on colour and a
 * hamlet deals out six wall colours, five roof colours, five shutter colours plus doors,
 * windows, plinths and chimneys, while kerbs come in red and white. Every one was its own
 * bucket. The whole scene was 950 draw calls a frame, which at 60 Hz is 57,000 a second of
 * driver overhead.
 *
 * Baking colour into vertices, quantising roughness, and widening the batching chunk brought
 * the same frame to 558. These assertions are what stops a future prop from reintroducing a
 * per-instance material and quietly undoing it. Measured after the fix: landmarks 41 meshes
 * at 373 tris each on Borbera and 23 at 1130 on Salita; guardrails 15 at 790 and 6 at 4764.
 */
const MAX_PROP_MESHES: Record<string, number> = {
  "borbera-sprint": 70,
  "salita-cosola": 45,
};
/** Triangles per prop mesh, averaged. Below this the batcher is not batching. */
const MIN_TRIS_PER_PROP_MESH = 250;

function buildStageScene(stageId: string) {
  const spline = new TrackSpline(getStageDef(stageId));
  const road = new RoadMesh(spline);
  const terrain = new TerrainSystem(spline);

  const root = new THREE.Group();
  root.add(
    road.mesh,
    road.landmarkGroup,
    road.guardrailGroup,
    terrain.mesh,
    terrain.riverMesh,
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

  for (const entry of STAGE_LIST) {
    it(`${entry.id} batches its roadside props into few, well-filled draws`, () => {
      const spline = new TrackSpline(getStageDef(entry.id));
      const road = new RoadMesh(spline);

      const landmarks = countRenderables(road.landmarkGroup);
      const guardrails = countRenderables(road.guardrailGroup);
      const meshes = landmarks.meshes + guardrails.meshes;
      const triangles = landmarks.triangles + guardrails.triangles;

      const ceiling = MAX_PROP_MESHES[entry.id];
      assert.ok(
        meshes <= ceiling,
        `${entry.id}: ${meshes} prop meshes after batching exceeds ceiling ${ceiling}. ` +
          `Each one is a draw call every frame it is on screen. The usual cause is a new ` +
          `prop whose material differs from its neighbours' in something materialSignature ` +
          `keys on, so it cannot share their bucket.`
      );

      const perMesh = triangles / Math.max(1, meshes);
      assert.ok(
        perMesh >= MIN_TRIS_PER_PROP_MESH,
        `${entry.id}: prop batches average only ${perMesh.toFixed(0)} triangles each ` +
          `(${triangles} across ${meshes} meshes). Draws this small are pure overhead — ` +
          `the props are being split into buckets rather than merged.`
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
      const terrain = new TerrainSystem(spline);

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
