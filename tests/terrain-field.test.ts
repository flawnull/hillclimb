import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { buildRoadIndex } from "../src/game/track/terrain/roadIndex";
import { profileHeightAt, VERGE_WIDTH, ROAD_CLEARANCE } from "../src/game/track/terrain/layers/roadProfile";
import { buildBaseAltitude } from "../src/game/track/terrain/layers/baseAltitude";
import { ridgeReliefAt, ridgeWeightAt } from "../src/game/track/terrain/layers/ridgeLayer";

describe("RoadIndex", () => {
  it("returns exactly the samples a brute-force scan would return", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const index = buildRoadIndex(spline, 1);
    const all = spline.getAllSamples();
    const radius = 90;

    // Deterministic probe points: offset laterally from every 40th sample.
    for (let i = 0; i < all.length; i += 40) {
      const s = all[i];
      const px = s.x + s.normalX * 55;
      const pz = s.z + s.normalZ * 55;

      const expected = new Set<number>();
      for (let k = 0; k < all.length; k++) {
        const dx = all[k].x - px;
        const dz = all[k].z - pz;
        if (Math.sqrt(dx * dx + dz * dz) <= radius) expected.add(k);
      }

      const got = new Set(index.query(px, pz, radius).map((h) => h.sample.s));
      const expectedS = new Set([...expected].map((k) => all[k].s));

      assert.equal(got.size, expectedS.size, `probe ${i}: hit count mismatch`);
      for (const s2 of expectedS) assert.ok(got.has(s2), `probe ${i}: missing sample s=${s2}`);
    }
  });

  it("nearest() agrees with a brute-force nearest scan", () => {
    for (const entry of STAGE_LIST) {
      const spline = new TrackSpline(getStageDef(entry.id));
      const index = buildRoadIndex(spline, 1);
      const all = spline.getAllSamples();

      for (let i = 0; i < all.length; i += 60) {
        const s = all[i];
        const px = s.x + s.normalX * 130 + 17;
        const pz = s.z + s.normalZ * 130 - 23;

        let best = Infinity;
        for (const k of all) {
          const dx = k.x - px, dz = k.z - pz;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < best) best = d;
        }

        assert.ok(
          Math.abs(index.nearest(px, pz).dist - best) < 1e-6,
          `${entry.id} probe ${i}: nearest dist ${index.nearest(px, pz).dist} != ${best}`
        );
      }
    }
  });

  it("reports lat as the signed lateral offset from the centreline", () => {
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    const index = buildRoadIndex(spline, 1);
    const s = spline.getAllSamples()[300];

    const right = index.nearest(s.x + s.normalX * 12, s.z + s.normalZ * 12);
    const left = index.nearest(s.x - s.normalX * 12, s.z - s.normalZ * 12);

    assert.ok(right.lat > 8, `expected positive lat, got ${right.lat}`);
    assert.ok(left.lat < -8, `expected negative lat, got ${left.lat}`);
  });

  it("bounds accurately cover the spline's extent", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const index = buildRoadIndex(spline, 1);
    const all = spline.getAllSamples();

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of all) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    }

    assert.equal(index.bounds.minX, minX, "bounds.minX mismatch");
    assert.equal(index.bounds.maxX, maxX, "bounds.maxX mismatch");
    assert.equal(index.bounds.minZ, minZ, "bounds.minZ mismatch");
    assert.equal(index.bounds.maxZ, maxZ, "bounds.maxZ mismatch");
  });
});

describe("roadProfile", () => {
  it("keeps the ribbon and verge below the road surface", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    for (const s of spline.getAllSamples()) {
      // Probes up to halfWidth + VERGE_WIDTH + 0.5 test the clearance clamp band boundary.
      // Beyond +0.5, the profile rises into rock cuts by design; the invariant is enforced
      // by the field clamp (Task 3) and mesh vertex validation, not this layer.
      for (const lat of [0, 1, s.halfWidth * 0.5, s.halfWidth, s.halfWidth + VERGE_WIDTH, s.halfWidth + VERGE_WIDTH + 0.01, s.halfWidth + VERGE_WIDTH + 0.5]) {
        for (const side of [-1, 1]) {
          const h = profileHeightAt(s, lat * side);
          assert.ok(
            h <= s.y - ROAD_CLEARANCE + 1e-9,
            `lat ${lat * side} at s=${s.s}: ground ${h} is not below road ${s.y}`
          );
        }
      }
    }
  });

  it("rises on the cut side and falls on the exposed side", () => {
    // Search STAGE_LIST for the first stage containing a left-exposed sample
    let exposed: any = null;
    let stageId: string | null = null;
    for (const entry of STAGE_LIST) {
      const spline = new TrackSpline(getStageDef(entry.id));
      exposed = spline.getAllSamples().find((s) => s.exposure === "left");
      if (exposed) {
        stageId = entry.id;
        break;
      }
    }
    assert.ok(exposed, "should find a stage containing a left-exposed section");

    assert.ok(profileHeightAt(exposed!, -40) < exposed!.y - 5, "left side should drop away");
    assert.ok(profileHeightAt(exposed!, 40) > exposed!.y, "right side should cut into the hill");
  });

  it("is continuous in lat", () => {
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    const s = spline.getAllSamples()[500];
    let prev = profileHeightAt(s, -260);
    for (let lat = -259.5; lat <= 260; lat += 0.5) {
      const h = profileHeightAt(s, lat);
      assert.ok(Math.abs(h - prev) < 2.0, `jump of ${Math.abs(h - prev)} m at lat ${lat}`);
      prev = h;
    }
  });
});

describe("baseAltitude", () => {
  it("tracks the road's altitude near the road", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const base = buildBaseAltitude(spline, 2500);
    const all = spline.getAllSamples();

    for (let i = 20; i < all.length - 20; i += 50) {
      const s = all[i];
      const h = base.sample(s.x, s.z);
      assert.ok(
        Math.abs(h - s.y) < 260,
        `at s=${s.s} base altitude ${h.toFixed(0)} is far from road ${s.y.toFixed(0)}`
      );
    }
  });

  it("is continuous", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const base = buildBaseAltitude(spline, 2500);
    const s = spline.getAllSamples()[400];

    let prev = base.sample(s.x - 500, s.z);
    for (let dx = -499; dx <= 500; dx += 1) {
      const h = base.sample(s.x + dx, s.z);
      assert.ok(Math.abs(h - prev) < 2.5, `base altitude jumped ${Math.abs(h - prev)} m at dx=${dx}`);
      prev = h;
    }
  });

  it("is deterministic", () => {
    const spline = new TrackSpline(getStageDef("cresta-ebro"));
    const a = buildBaseAltitude(spline, 2500);
    const b = buildBaseAltitude(spline, 2500);
    const s = spline.getAllSamples()[100];
    for (let i = 0; i < 50; i++) {
      const x = s.x + i * 37, z = s.z - i * 53;
      assert.equal(a.sample(x, z), b.sample(x, z));
    }
  });
});

describe("ridgeLayer", () => {
  it("weights ridges out entirely near the road and fully in the far field", () => {
    assert.equal(ridgeWeightAt(0), 0);
    assert.equal(ridgeWeightAt(179), 0);
    assert.equal(ridgeWeightAt(800), 1);
    assert.equal(ridgeWeightAt(5000), 1);
    assert.ok(ridgeWeightAt(490) > 0.4 && ridgeWeightAt(490) < 0.6);
  });

  it("has a zero derivative at both ends of the blend, so ridges never crease in", () => {
    assert.ok(Math.abs(ridgeWeightAt(181) - ridgeWeightAt(180)) < 1e-3);
    assert.ok(Math.abs(ridgeWeightAt(799) - ridgeWeightAt(800)) < 1e-3);
  });

  it("is continuous in world space", () => {
    let prev = ridgeReliefAt(0, 0);
    for (let x = 1; x <= 4000; x += 1) {
      const h = ridgeReliefAt(x, 137);
      assert.ok(Math.abs(h - prev) < 2.0, `relief jumped ${Math.abs(h - prev)} at x=${x}`);
      prev = h;
    }
  });

  it("is deterministic", () => {
    for (let i = 0; i < 100; i++) {
      const x = i * 91.7, z = i * -43.3;
      assert.equal(ridgeReliefAt(x, z), ridgeReliefAt(x, z));
    }
  });
});
