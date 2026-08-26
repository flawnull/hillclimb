import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { buildRoadIndex } from "../src/game/track/terrain/roadIndex";
import {
  profileHeightAt,
  VERGE_WIDTH,
  ROAD_CLEARANCE,
  VALLEY_FLOOR_ALT,
  MAX_VISIBLE_DROP,
} from "../src/game/track/terrain/layers/roadProfile";
import { buildBaseAltitude } from "../src/game/track/terrain/layers/baseAltitude";
import { ridgeReliefAt, ridgeWeightAt } from "../src/game/track/terrain/layers/ridgeLayer";
import { carveAt, CARVE_RADIUS } from "../src/game/track/terrain/layers/roadCarveLayer";

// Performance guard: the "never above the road" sweep below is O(samples * lateral steps)
// per stage, each carveAt() doing a spatial query. Striding the SAMPLE loop (never the
// 0.4 m lateral step, which is the point of the test) keeps the whole suite fast without
// weakening what it catches.
const SAMPLE_STRIDE = 1;

// roadProfile.ts's own internal falloff constant for the exposed-side drop
// (`1 - 1/(1 + dd * DROP_FALLOFF)`), duplicated here because it is not exported and this
// file must not modify roadProfile.ts. If that constant ever changes, this must too.
const DROP_FALLOFF = 0.055;

/**
 * The steepest slope profileHeightAt can legitimately produce: the initial gradient of
 * the exposed-side drop at d=0, `depth * DROP_FALLOFF`, where `depth` is exactly what
 * roadProfile.ts uses — min(dropDepth, altitude - VALLEY_FLOOR_ALT, MAX_VISIBLE_DROP).
 * A cliff at this slope is real terrain, not a defect; the continuity tests below assert
 * against a tolerance derived from this bound (computed per stage from its own samples),
 * not a fixed constant, so they catch wedge discontinuities without outlawing real cliffs.
 */
function maxLegitSlopeForSample(s: { dropDepth?: number; altitude: number }): number {
  const declared = s.dropDepth ?? 40;
  const toValleyFloor = Math.max(20, s.altitude - VALLEY_FLOOR_ALT);
  const depth = Math.min(declared, toValleyFloor, MAX_VISIBLE_DROP);
  return depth * DROP_FALLOFF;
}

function maxLegitSlope(spline: TrackSpline): number {
  let max = 0;
  for (const s of spline.getAllSamples()) {
    const slope = maxLegitSlopeForSample(s);
    if (slope > max) max = slope;
  }
  return max;
}

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
    const step = 0.5;
    // A real cliff is allowed; a wedge discontinuity is not. Tolerance is derived from
    // this sample's own steepest legitimate slope (see maxLegitSlopeForSample above),
    // not a fixed constant that would either outlaw real cliffs or hide real jumps.
    const tolerance = maxLegitSlopeForSample(s) * 1.25 * step;
    let prev = profileHeightAt(s, -260);
    for (let lat = -259.5; lat <= 260; lat += step) {
      const h = profileHeightAt(s, lat);
      assert.ok(
        Math.abs(h - prev) < tolerance,
        `jump of ${Math.abs(h - prev)} m at lat ${lat} (tolerance ${tolerance.toFixed(2)} m)`
      );
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

describe("roadCarveLayer", () => {
  // This test is the belt, not a backstop for one. carveAt() has no runtime clearance
  // clamp: the guarantee that ground never rises above the road is proved by construction
  // instead (a flat-core falloff makes the nearest tier's weight exactly 1 on its own
  // ribbon, and softMin never exceeds the true min of its inputs — see roadCarveLayer.ts).
  // This test is what holds that reasoning to account across every stage and ribbon,
  // rather than a cap silently enforcing it at runtime.
  it("never returns ground above the road, anywhere on any ribbon", () => {
    for (const entry of STAGE_LIST) {
      const spline = new TrackSpline(getStageDef(entry.id));
      const index = buildRoadIndex(spline, 1);

      const allSamples = spline.getAllSamples();
      for (let si = 0; si < allSamples.length; si += SAMPLE_STRIDE) {
        const s = allSamples[si];
        // Stand-in for the land layer: a constant well above the local road. Only the
        // continuity test below needs landAt to actually vary with distance.
        const landAt = () => s.y + 200;
        for (let lat = -(s.halfWidth + 1.2); lat <= s.halfWidth + 1.2; lat += 0.4) {
          const x = s.x + s.normalX * lat;
          const z = s.z + s.normalZ * lat;
          const r = carveAt(x, z, index, landAt);
          assert.ok(
            r.height <= s.y - 0.25 + 1e-6,
            `${entry.id} s=${s.s} lat=${lat.toFixed(1)}: ground ${r.height.toFixed(3)} above road ${s.y.toFixed(3)}`
          );
        }
      }
    }
  });

  it("stays below BOTH tiers in the gap between stacked switchbacks", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const index = buildRoadIndex(spline, 1);
    const all = spline.getAllSamples();

    // Find a point where two road tiers are within 60 m of each other laterally.
    let probes = 0;
    for (let i = 0; i < all.length; i += 25) {
      const s = all[i];
      // Stand-in for the land layer: a constant well above the local road.
      const landAt = () => s.y + 200;
      for (let lat = 8; lat < 60; lat += 4) {
        for (const side of [-1, 1]) {
          const x = s.x + s.normalX * lat * side;
          const z = s.z + s.normalZ * lat * side;
          const hits = index.query(x, z, CARVE_RADIUS);
          const tiers = hits.filter((h) => Math.abs(h.sample.s - s.s) > 200);
          if (tiers.length === 0) continue;

          probes++;
          const h = carveAt(x, z, index, landAt).height;
          for (const t of tiers) {
            if (t.dist > t.sample.halfWidth + 1.2) continue;
            assert.ok(
              h <= t.sample.y - 0.25 + 1e-6,
              `ground ${h.toFixed(2)} intrudes on opposing tier at s=${t.sample.s}`
            );
          }
        }
      }
    }
    assert.ok(probes > 50, `expected many stacked-tier probes, got ${probes}`);
  });

  it("falls to zero weight beyond the carve radius", () => {
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    const index = buildRoadIndex(spline, 1);
    const s = spline.getAllSamples()[400];
    const landAt = () => s.y + 200;
    const far = carveAt(s.x + s.normalX * 400, s.z + s.normalZ * 400, index, landAt);
    assert.equal(far.weight, 0);
  });

  it("is continuous across the medial axis between two tiers", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const index = buildRoadIndex(spline, 1);
    const s = spline.getAllSamples()[600];

    // Stand-in for the land layer. Unlike the other tests' constant stub, this one must
    // actually be a continuous function of the distance it is handed: carveAt() now
    // blends toward whatever landAt(nearestDist) returns, so a discontinuous or constant
    // stub here would test the stub's shape instead of the layer's continuity.
    //
    // It must saturate to its asymptotic value strictly BELOW CARVE_RADIUS (90 m), not
    // at it: carveAt's hits.length === 0 branch reports nearestDist as Infinity (it
    // never queried past the radius to find the true distance), so landAt(Infinity) must
    // already equal what landAt returns for a hit sitting right at the radius edge, or
    // the hits/no-hits transition itself becomes a fresh discontinuity.
    const landAt = (nearestDist: number) => s.y + 200 + 0.05 * Math.min(nearestDist, 60);

    // The tolerance at each step is derived from the samples the layer actually combines
    // at that point, not a whole-stage bound: a whole-stage maxLegitSlope is dominated by
    // whichever single sample on the stage has the deepest declared dropDepth, wherever it
    // happens to be, which can make the bound near-vacuous everywhere else on the stage
    // (measured: salita-cosola's whole-stage bound is ~28 m per 0.5 m step, driven by one
    // sample far from where this sweep runs, against a genuine local cliff of ~3.3 m).
    // Bounding by the union of hits actually queried at the current and previous probe —
    // exactly what carveAt() itself combines — keeps the test tight where it runs while
    // still comfortably admitting any real cliff the layer can legitimately produce there.
    const step = 0.5;

    function toleranceFor(px: number, pz: number, prevPx: number, prevPz: number): number {
      let max = 0;
      for (const h of index.query(px, pz, CARVE_RADIUS)) {
        const slope = maxLegitSlopeForSample(h.sample);
        if (slope > max) max = slope;
      }
      for (const h of index.query(prevPx, prevPz, CARVE_RADIUS)) {
        const slope = maxLegitSlopeForSample(h.sample);
        if (slope > max) max = slope;
      }
      return max * 1.25 * step;
    }

    let prevX = s.x - s.normalX * 120, prevZ = s.z - s.normalZ * 120;
    let prev = carveAt(prevX, prevZ, index, landAt).height;
    for (let lat = -119.5; lat <= 120; lat += step) {
      const x = s.x + s.normalX * lat, z = s.z + s.normalZ * lat;
      const h = carveAt(x, z, index, landAt).height;
      const tolerance = toleranceFor(x, z, prevX, prevZ);
      // <= rather than <: when both the current and previous probe have zero hits (far
      // past CARVE_RADIUS from every tier), both height and tolerance are legitimately 0,
      // and 0 <= 0 is exactly "no jump", not a violation.
      assert.ok(
        Math.abs(h - prev) <= tolerance,
        `carve jumped ${Math.abs(h - prev).toFixed(2)} m at lat ${lat} (tolerance ${tolerance.toFixed(2)} m)`
      );
      prev = h;
      prevX = x;
      prevZ = z;
    }
  });
});
