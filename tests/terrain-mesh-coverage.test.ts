/**
 * VAL BORBERA HILLCLIMB — Terrain Surface Coverage Suite
 *
 * The defect this suite exists for: the landscape used to be two surfaces (a
 * road-relative corridor and a world-grid backdrop) that neither met nor agreed. Where
 * they failed to meet, a downward ray hit nothing and the player saw through the
 * mountain. Where they overlapped, a ray hit twice and the two surfaces z-fought.
 *
 * Exactly one hit per ray is the property that says "one continuous surface", and it is
 * checked directly rather than inferred.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { createHeightField } from "../src/game/track/terrain/heightField";
import { buildTerrainMesh, leafSizeAt } from "../src/game/track/terrain/TerrainMeshBuilder";
import { VERGE_WIDTH } from "../src/game/track/terrain/layers/roadProfile";

/**
 * A triangle's normal cannot tell "vertical skirt apron" from "vertical cliff face" —
 * the height field legitimately produces near-vertical drops right next to the road
 * (the exposed-drop profile reaches slopes far steeper than any normal.y threshold you
 * could pick), so a normal-based filter misclassifies real surface as skirt at exactly
 * the places this suite is supposed to be checking. TerrainMeshBuilder tags skirt
 * vertices explicitly instead (the `isSkirt` vertex attribute); a triangle counts as a
 * skirt triangle if ANY of its three vertices is tagged, not all three — a skirt
 * triangle always shares its top edge with the surface quad it hangs from, so it always
 * has 1-2 surface-tagged corners and never all three flagged (see TerrainMeshBuilder.ts).
 */
function isSkirtHit(hit: THREE.Intersection): boolean {
  if (!hit.face) return false;
  const mesh = hit.object as THREE.Mesh;
  const attr = (mesh.geometry as THREE.BufferGeometry).attributes.isSkirt;
  if (!attr) return false;
  return attr.getX(hit.face.a) === 1 || attr.getX(hit.face.b) === 1 || attr.getX(hit.face.c) === 1;
}

describe("leafSizeAt", () => {
  it("grades from 4 m at the road to 256 m at the horizon", () => {
    assert.equal(leafSizeAt(0), 4);
    assert.equal(leafSizeAt(-10), 4);
    assert.equal(leafSizeAt(100), 34);
    assert.equal(leafSizeAt(10000), 256);
  });
});

describe("Terrain surface coverage", () => {
  for (const entry of STAGE_LIST) {
    it(`${entry.id}: a downward ray hits the terrain exactly once`, () => {
      const spline = new TrackSpline(getStageDef(entry.id));
      const field = createHeightField(spline);
      const mesh = buildTerrainMesh(field);
      mesh.updateMatrixWorld(true);

      const raycaster = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const all = spline.getAllSamples();

      let holes = 0;
      let doubles = 0;
      let probes = 0;
      const firstHole: string[] = [];

      for (let i = 5; i < all.length - 5; i += 23) {
        const s = all[i];
        // Probe out to 500 m each side: this spans the old corridor/backdrop seam,
        // which sat wherever the corridor happened to stop between 5 m and 260 m.
        for (const lat of [9, 18, 35, 70, 130, 220, 340, 500]) {
          for (const side of [-1, 1]) {
            const x = s.x + s.normalX * lat * side;
            const z = s.z + s.normalZ * lat * side;
            probes++;

            raycaster.set(new THREE.Vector3(x, 6000, z), down);
            // Skirts can legitimately be grazed; count only hits on the real ground
            // surface, identified by the mesh's explicit isSkirt tagging (not by normal
            // — this stage has genuine near-vertical cliffs that a normal threshold
            // cannot tell apart from a skirt apron; see isSkirtHit above).
            const hits = raycaster
              .intersectObject(mesh, true)
              .filter((h) => !isSkirtHit(h));

            if (hits.length === 0) {
              holes++;
              if (firstHole.length < 5) firstHole.push(`s=${s.s.toFixed(0)} lat=${lat * side}`);
            } else if (hits.length > 1 && Math.abs(hits[0].point.y - hits[1].point.y) > 0.5) {
              doubles++;
            }
          }
        }
      }

      assert.equal(holes, 0, `${entry.id}: ${holes}/${probes} probes found no ground. First: ${firstHole.join(", ")}`);
      assert.equal(doubles, 0, `${entry.id}: ${doubles}/${probes} probes hit two separated surfaces`);
    });

    it(`${entry.id}: the mesh surface agrees with the field it was built from`, () => {
      const spline = new TrackSpline(getStageDef(entry.id));
      const field = createHeightField(spline);
      const mesh = buildTerrainMesh(field);
      mesh.updateMatrixWorld(true);

      const raycaster = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const all = spline.getAllSamples();

      // There is no fixed Lipschitz bound on the field's slope (Task 5 withdrew the
      // 2.5 m/m assumption — a 125 m drop legitimately reaches ~6.9 m/m, and these
      // stages go steeper still at hairpins). A 4 m leaf cannot resolve an 80 m/m
      // cliff — that is an accepted LOD limit, not a bug. What this test actually
      // checks is narrower than "the mesh reproduces the field exactly": it is "the
      // mesh samples the field it was built from", i.e. deviation stays within what a
      // flat quad of this size, sampling a surface of this shape, can be expected to
      // produce, with a safety margin.
      //
      // The bound makes NO smoothness assumption: a flat quad's values over a cell lie
      // between that cell's extremes, so its worst departure from the surface is
      // bounded by how much the surface itself varies across the cell (its total
      // variation), sampled on a grid rather than a cross. This field is deliberately
      // only C0 — Task 5 replaced a broken soft-min with a plain minimum over road
      // tiers, which leaves a V-shaped gradient KINK where two tiers' faded proposals
      // cross. A five-point cross straddling such a crease reads as flat (both arms
      // land at nearly the same height) while a quad spanning it departs by the full
      // depth of the V — that is exactly what defeated the first two attempts at this
      // bound (point-slope, then chord sag; see task-7-report.md for both). This bound
      // is honest rather than circular: it measures the field, not the mesh, and would
      // still catch a builder that sampled the wrong function, used a stale height, or
      // had an indexing bug, because any of those produce a vertex outside the range
      // the field actually takes over the cell.
      let violations = 0;
      let worstRatio = 0;
      const worstDetail: string[] = [];
      for (let i = 5; i < all.length - 5; i += 41) {
        const s = all[i];
        for (const lat of [12, 40, 90]) {
          for (const side of [-1, 1]) {
            const x = s.x + s.normalX * lat * side;
            const z = s.z + s.normalZ * lat * side;
            raycaster.set(new THREE.Vector3(x, 6000, z), down);
            const hits = raycaster
              .intersectObject(mesh, true)
              .filter((h) => !isSkirtHit(h));
            if (hits.length === 0) continue;

            const dev = Math.abs(hits[0].point.y - field.heightAt(x, z));

            const L = leafSizeAt(field.distToRoute(x, z));
            const h = L / 2;

            let lo = Infinity;
            let hi = -Infinity;
            const N = 4; // 5x5 grid over the cell span
            for (let gi = 0; gi <= N; gi++) {
              for (let gj = 0; gj <= N; gj++) {
                const sx = x - h + (2 * h * gi) / N;
                const sz = z - h + (2 * h * gj) / N;
                const v = field.sampleAt(sx, sz).height;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
              }
            }
            const allowed = (hi - lo) * 1.5 + 0.5;

            if (dev > allowed) {
              violations++;
              const ratio = allowed > 0 ? dev / allowed : Infinity;
              if (ratio > worstRatio) {
                worstRatio = ratio;
                worstDetail.push(
                  `x=${x.toFixed(1)} z=${z.toFixed(1)} dev=${dev.toFixed(2)}m allowed=${allowed.toFixed(2)}m totalVariation=${(hi - lo).toFixed(2)} leaf=${L.toFixed(1)}`,
                );
              }
            }
          }
        }
      }
      assert.equal(
        violations,
        0,
        `${entry.id}: ${violations} probes exceeded the field's own total-variation bound. Worst: ${worstDetail.slice(-1).join("")}`,
      );
    });

    it(`${entry.id}: no terrain vertex sits above the road it passes`, () => {
      // This is the single most important test in the file: it is the one that says
      // "terrain never climbs onto the road". Its oracle for "is this vertex on the
      // road" must therefore be exact, which rules out TrackSpline.projectFrenet: `t`
      // is a NORMAL-only offset from the nearest sample's local frame, with no bound on
      // the tangential component, so a point kilometres away that happens to be
      // tangentially aligned with a sample reports a tiny `t` and is wrongly treated as
      // on-ribbon (found during this task: a point 3.29 km from the road reported
      // proj.t = -0.79). `field.index.nearest` has no such blind spot — `dist` is the
      // true 2D distance to the nearest centreline sample — so it is used here instead.
      //
      // Deliberately NOT filtered by isSkirt: a skirt vertex hanging below the road is
      // fine (that's its job), but a skirt vertex ABOVE the road would be a genuine
      // defect, so every vertex is checked.
      const spline = new TrackSpline(getStageDef(entry.id));
      const field = createHeightField(spline);
      const mesh = buildTerrainMesh(field);
      const pos = mesh.geometry.attributes.position;

      // RULING (task-7-report.md, authorised deliberately, not a test-tuning fudge):
      // the mesh stores positions as float32, whose ulp at these altitudes (~1700 m) is
      // ~1e-4 m. A vertex the field placed exactly at roadY - ROAD_CLEARANCE can round
      // UP by a fraction of an ulp on storage. That is storage precision, not a
      // clearance failure: the margin being defended is 0.25 m. Anything above this
      // bound is real. (Found during this task: both borbera-sprint violations under
      // the previous flat 1e-6 epsilon were 1.28e-5 m against a 0.25 m clearance —
      // six thousand times smaller than the margin, and literally unrenderable.)
      let violations = 0;
      let worstBy = 0;
      const worstDetail: string[] = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const hit = field.index.nearest(x, z);
        if (hit.dist > hit.sample.halfWidth + VERGE_WIDTH) continue;
        const eps = Math.abs(hit.sample.y) * 2e-7 + 1e-9;
        const over = y - (hit.sample.y - 0.25 + eps);
        if (over > 0) {
          violations++;
          if (over > worstBy) {
            worstBy = over;
            worstDetail.push(`x=${x.toFixed(1)} z=${z.toFixed(1)} y=${y.toFixed(2)} roadY=${hit.sample.y.toFixed(2)} dist=${hit.dist.toFixed(2)} over=${over.toFixed(3)}`);
          }
        }
      }
      assert.equal(
        violations,
        0,
        `${entry.id}: ${violations} vertices on the road, worst by ${worstBy.toFixed(3)} m. Worst: ${worstDetail.slice(-1).join("")}`,
      );
    });
  }
});
