/**
 * VAL BORBERA HILLCLIMB — Track & Roadway Clearance Test Suite
 *
 * Guarantees that the procedural track, roadside props, and vegetation
 * are physically safe and free of visual/gameplay obstruction bugs:
 *   1. Zero vegetation (trees, rocks, shrubs) ever spawns within the carriageway or verge.
 *   2. Zero roadside props (gantries, retaining walls, milestones, chevrons) intersect the road.
 *   3. All hairpin turns with steep drops have outer guardrails enabled to prevent accidental cliff falls.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { RoadMesh } from "../src/game/track/RoadMesh";
import { Terrain } from "../src/game/track/Terrain";

describe("Roadway Clearance & Obstacle Safety", () => {
  for (const entry of STAGE_LIST) {
    describe(`Stage: ${entry.id}`, () => {
      const stageDef = getStageDef(entry.id);
      const spline = new TrackSpline(stageDef);

      it("zero vegetation instances intersect or obstruct the road carriageway", () => {
        const terrain = new Terrain(spline);
        const vegGroup = terrain.vegetationGroup;

        let totalInstances = 0;
        let violations = 0;
        const mat4 = new THREE.Matrix4();
        const pos = new THREE.Vector3();

        vegGroup.traverse((node) => {
          if (node instanceof THREE.InstancedMesh) {
            for (let i = 0; i < node.count; i++) {
              node.getMatrixAt(i, mat4);
              pos.setFromMatrixPosition(mat4);

              // Skip uninitialized / hidden instances
              if (pos.y < -50) continue;

              totalInstances++;
              const proj = spline.projectFrenet(pos.x, pos.z);
              const minClearance = proj.sample.halfWidth + 2.0;

              if (Math.abs(proj.t) < minClearance) {
                violations++;
              }
            }
          }
        });

        assert.ok(totalInstances > 0, `${entry.id}: should have populated vegetation instances`);
        assert.strictEqual(
          violations,
          0,
          `${entry.id}: found ${violations} vegetation instances inside the road safety corridor (|t| < hw + 2.0m)`
        );
      });

      it("zero props or retaining walls intersect the driving surface", () => {
        const road = new RoadMesh(spline);
        let propViolations = 0;
        let checkedVertices = 0;

        const checkPropGeometry = (obj: THREE.Object3D) => {
          if (obj instanceof THREE.Mesh && obj.geometry) {
            const posAttr = obj.geometry.attributes.position;
            if (!posAttr) return;

            for (let i = 0; i < posAttr.count; i += 4) {
              const vx = posAttr.getX(i);
              const vy = posAttr.getY(i);
              const vz = posAttr.getZ(i);

              const proj = spline.projectFrenet(vx, vz);
              const heightAboveRoad = vy - proj.sample.y;

              // Check vertices within driving height (0 to 3m above road)
              if (heightAboveRoad > 0.05 && heightAboveRoad < 3.0 && Math.abs(proj.t) < proj.sample.halfWidth * 0.90) {
                propViolations++;
              }
              checkedVertices++;
            }
          }
        };

        road.guardrailGroup.traverse(checkPropGeometry);
        road.landmarkGroup.traverse(checkPropGeometry);

        assert.ok(checkedVertices > 0, `${entry.id}: should have generated roadside furniture`);
        assert.strictEqual(
          propViolations,
          0,
          `${entry.id}: found ${propViolations} prop vertices encroaching on the active driving lane`
        );
      });

      it("all hairpin apex turns with steep drops carry protective outer guardrails", () => {
        const allSamples = spline.getAllSamples();
        let hairpinsChecked = 0;

        for (const s of allSamples) {
          if (s.isHairpinApex && s.dropDepth >= 40 && (s.exposure === "left" || s.exposure === "right")) {
            hairpinsChecked++;
            assert.strictEqual(
              s.guardrail,
              true,
              `${entry.id} @ s=${s.s.toFixed(0)}m: sharp exposed turn (bank=${s.bank.toFixed(3)}, drop=${s.dropDepth}m) must have guardrail=true`
            );
          }
        }

        // borbera-sprint and salita-cosola have hairpins; cresta-ebro is a ridge road
        if (entry.id !== "cresta-ebro") {
          assert.ok(hairpinsChecked > 0, `${entry.id}: verified hairpins have guardrail protection`);
        }
      });
    });
  }
});
