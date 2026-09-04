/**
 * VAL BORBERA HILLCLIMB — Pasture and cattle placement
 *
 * Farms and grazing cattle fill the middle distance between the hamlets. Siting is the whole
 * job: a cascina on a cliff face, or in the same field as a hamlet, or hanging over the drop,
 * is worse than no cascina at all. These pin the four rules a site has to clear, because none
 * of them is visible from a screenshot taken somewhere else on the stage.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { createHeightField } from "../src/game/track/terrain/heightField";
import { buildPastures } from "../src/game/track/PastureBuilder";
import { RoadMesh } from "../src/game/track/RoadMesh";

describe("Pastures are sited, not scattered", () => {
  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: farms and cattle keep off the road`, () => {
      const spline = new TrackSpline(getStageDef(stageId));
      const field = createHeightField(spline);
      const group = new THREE.Group();
      buildPastures(spline.getAllSamples(), group, (x, z) => field.heightAt(x, z), []);

      group.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      let worst = Infinity;
      let worstWhat = "";
      group.traverse((node) => {
        if (!(node as THREE.Mesh).isMesh) return;
        p.setFromMatrixPosition(node.matrixWorld);
        const proj = spline.projectFrenet(p.x, p.z);
        const clear = Math.abs(proj.t) - proj.sample.halfWidth;
        if (clear < worst) {
          worst = clear;
          worstWhat = `${(node.parent?.children.length ?? 0) > 5 ? "farm part" : "animal"} at s=${proj.sample.s.toFixed(0)}`;
        }
      });
      if (worst === Infinity) return; // no pastures on this stage
      assert.ok(
        worst > 15,
        `${stageId}: something stands ${worst.toFixed(1)} m from the carriageway edge (${worstWhat}). ` +
          `These are middle-distance scenery; anything this close reads as roadside furniture ` +
          `and competes with the driving.`
      );
    });

    it(`${stageId}: farms do not stand in a hamlet`, () => {
      const spline = new TrackSpline(getStageDef(stageId));
      const field = createHeightField(spline);
      const road = new RoadMesh(spline, (x, z) => field.heightAt(x, z));
      const group = new THREE.Group();

      // The road builder places hamlets first and hands their footprints on; a pasture must
      // respect them. Rebuild against those same footprints and check nothing overlaps.
      const hamlets = road.buildingFootprints.filter((b) => b.r < 20);
      const farms = buildPastures(spline.getAllSamples(), group, (x, z) => field.heightAt(x, z), hamlets);
      for (const farm of farms) {
        for (const h of hamlets) {
          const gap = Math.hypot(farm.x - h.x, farm.z - h.z) - farm.r - h.r;
          assert.ok(gap > 0, `${stageId}: a farmyard overlaps a hamlet building by ${(-gap).toFixed(1)} m`);
        }
      }
      for (let i = 0; i < farms.length; i++) {
        for (let j = i + 1; j < farms.length; j++) {
          const gap = Math.hypot(farms[i].x - farms[j].x, farms[i].z - farms[j].z) - farms[i].r - farms[j].r;
          assert.ok(gap > 0, `${stageId}: two farmyards overlap by ${(-gap).toFixed(1)} m`);
        }
      }
    });

    it(`${stageId}: nothing grazes a cliff`, () => {
      const spline = new TrackSpline(getStageDef(stageId));
      const field = createHeightField(spline);
      const group = new THREE.Group();
      buildPastures(spline.getAllSamples(), group, (x, z) => field.heightAt(x, z), []);

      group.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      let steepest = 0;
      let floating = 0;
      group.traverse((node) => {
        if (!(node as THREE.Mesh).isMesh) return;
        p.setFromMatrixPosition(node.matrixWorld);
        const ground = field.heightAt(p.x, p.z);
        // Every part sits within a building's height of the ground beneath it. A farm
        // hanging in the air, or buried, is the failure this catches.
        const above = p.y - ground;
        if (above > 9 || above < -3) floating++;
        const slope =
          Math.abs(field.heightAt(p.x + 4, p.z) - ground) + Math.abs(field.heightAt(p.x, p.z + 4) - ground);
        if (slope > steepest) steepest = slope;
      });
      assert.strictEqual(floating, 0, `${stageId}: ${floating} pasture parts are not on the ground`);
      assert.ok(
        steepest < 14,
        `${stageId}: something sits on ground falling ${steepest.toFixed(1)} m over 4 m — that is a cliff`
      );
    });
  }
});
