import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { buildRoadIndex, RoadIndex } from "../src/game/track/terrain/roadIndex";
import { createHeightField } from "../src/game/track/terrain/heightField";
import {
  profileHeightAt,
  VERGE_WIDTH,
  ROAD_CLEARANCE,
  VALLEY_FLOOR_ALT,
  MAX_VISIBLE_DROP,
} from "../src/game/track/terrain/layers/roadProfile";
import { buildBaseAltitude } from "../src/game/track/terrain/layers/baseAltitude";
import { FIELD_PADDING } from "../src/game/track/terrain/heightField";
import { ridgeReliefAt, ridgeWeightAt } from "../src/game/track/terrain/layers/ridgeLayer";
import { carveAt, CARVE_RADIUS } from "../src/game/track/terrain/layers/roadCarveLayer";
import { valleyLandAt, VALLEY_SPAN } from "../src/game/track/terrain/layers/valleyLayer";

// Performance guard: the "never above the road" sweep below is O(samples * lateral steps)
// per stage, each carveAt() doing a spatial query. Striding the SAMPLE loop (never the
// 0.4 m lateral step, which is the point of the test) keeps the whole suite fast without
// weakening what it catches.
const SAMPLE_STRIDE = 1;

/**
 * roadProfile.ts's own internal slope constants, duplicated because they are not exported
 * and this file must not modify roadProfile.ts. If either changes, this must too.
 *
 * STALENESS THIS FIXES. The value here used to be `DROP_FALLOFF = 0.055` and the bound below
 * was `depth * DROP_FALLOFF` — the near-verge gradient when the exposed drop used a fixed
 * falloff RATE. That constant no longer exists: the profile now holds a fixed near-verge
 * SLOPE and lets the rate follow from the depth, precisely so that a deep drop does not fall
 * off a cliff at the verge. The old expression therefore kept handing out a tolerance
 * proportional to dropDepth: on Salita di Cosola, `280 * 0.055` = 15.4 m/m against a profile
 * that can no longer exceed 1.36 m/m anywhere. Every continuity assertion below was running
 * with roughly ten times the slack it was written to have, and would have passed a genuine
 * wedge discontinuity. A duplicated constant that silently outlives the code it mirrors is
 * worse than no bound at all, because the suite still reports green.
 */
const DROP_SLOPE = 1.15;
/** The cut side's steepest branch: HILLSIDE_RISE * HILL_FALLOFF = 85 * 0.016. */
const CUT_MAX_SLOPE = 1.36;

/**
 * The steepest slope profileHeightAt can legitimately produce at any lateral offset.
 *
 * Now independent of the sample: the exposed branch is capped at DROP_SLOPE by construction
 * whatever depth it eventually reaches, and the cut branch at CUT_MAX_SLOPE. A cliff at this
 * slope is real terrain, not a defect, and the continuity tests below derive their tolerance
 * from it rather than from a fixed constant that would either outlaw real cliffs or hide
 * real jumps. The parameter is kept so call sites read as "the bound for THIS sample" and so
 * a future depth-dependent branch has somewhere to go.
 */
function maxLegitSlopeForSample(_s: { dropDepth?: number; altitude: number }): number {
  return Math.max(DROP_SLOPE, CUT_MAX_SLOPE);
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
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const a = buildBaseAltitude(spline, 2500);
    const b = buildBaseAltitude(spline, 2500);
    const s = spline.getAllSamples()[100];
    for (let i = 0; i < 50; i++) {
      const x = s.x + i * 37, z = s.z - i * 53;
      assert.equal(a.sample(x, z), b.sample(x, z));
    }
  });
});

describe("valleyLayer", () => {
  it("returns base exactly at the road (distToRoute 0) and approaches floor at VALLEY_SPAN", () => {
    // valleyLandAt is a pure blend of two numbers by a smoothstep of distToRoute/VALLEY_SPAN;
    // this pins both ends of that blend directly, with no grid or spline involved.
    assert.equal(valleyLandAt(1000, 400, 0), 1000, "distToRoute 0 should return base exactly");
    // smoothstep saturates to exactly 1 at t=1, so VALLEY_SPAN itself should land on floor
    // exactly (not just approximately).
    assert.equal(valleyLandAt(1000, 400, VALLEY_SPAN), 400, "distToRoute VALLEY_SPAN should return floor exactly");
    // And it stays there beyond VALLEY_SPAN (smoothstep's t is clamped to 1).
    assert.equal(valleyLandAt(1000, 400, VALLEY_SPAN * 5), 400, "distToRoute beyond VALLEY_SPAN should stay at floor");
  });

  it("keeps ground far below the road on the far side of an exposed ridge section (the anti-moat assertion)", () => {
    // This is the whole point of the layer: before this fix, roadCarveLayer's fade toward
    // `land` had no notion of a floor below the road, so the ground plunged away from the
    // ribbon and was dragged straight back up to road-altitude land within ~90 m (measured:
    // cresta-ebro at 80% along the stage, road y=1563.5, exposure "both", dropDepth 1300 —
    // lat 200 sat at road-34.8 and lat 1500 sat at road+54, i.e. the "valley" fully healed
    // shut and climbed back above the plateau). A threshold of "at least 150 m below the
    // road" at 400 m lateral would have FAILED against that pre-fix measurement (only ~35 m
    // below at less than half the distance, and above the road entirely by 1500 m) and
    // passes now that the floor grid gives the drop somewhere to actually settle.
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const field = createHeightField(spline);
    const all = spline.getAllSamples();
    // Find a both-sides-exposed sample rather than assuming where one sits. The ridge section
    // has moved as the stage was reshaped, and hardcoding a fraction of the route made this
    // test fail for a reason that had nothing to do with what it checks.
    const s = all
      .filter((smp) => smp.exposure === "both")
      .reduce<(typeof all)[number] | undefined>(
        (best, smp) => (!best || smp.dropDepth > best.dropDepth ? smp : best),
        undefined
      );
    assert.ok(s, "stage should contain a section exposed on both sides");

    for (const side of [-1, 1]) {
      const x = s!.x + s.normalX * 400 * side;
      const z = s.z + s.normalZ * 400 * side;
      const h = field.heightAt(x, z);
      // Threshold derived from the stage's OWN declared drop rather than a fixed 150 m, which
      // was calibrated when this section declared 1,300 m drops. The stage now declares a few
      // hundred, so a fixed figure tested the stage data rather than the moat behaviour. What
      // matters is that the ground stays a substantial fraction of the declared drop below the
      // road far out — i.e. that the drop does not heal shut on its way to the field's floor.
      const expectedFloor = s!.y - s!.dropDepth * 0.25;
      assert.ok(
        h < expectedFloor,
        `lat ${400 * side}: ground ${h.toFixed(1)} is not well below road ${s!.y.toFixed(1)} ` +
          `(expected below ${expectedFloor.toFixed(1)}, drop declared ${s!.dropDepth} m — moat healed shut)`
      );
    }
  });

  it("is continuous in distToRoute across the valley span", () => {
    // valleyLandAt itself has no spline/grid dependence, so its continuity is walked here
    // through the same real base/floor grids heightField uses, sweeping laterally off one
    // road sample the same way roadCarveLayer's and baseAltitude's own continuity tests do.
    //
    // Tolerance at each step is derived from what was actually measured at that step, not a
    // fresh magic slope constant: the step in `base` and the step in `floor` are exactly
    // valleyLandAt's own inputs, so their measured deltas already bound how far a linear
    // blend of them can move; what those two omit is the blend WEIGHT itself changing, whose
    // max derivative is smoothstep's own well-known 1.5 (the same shape already reused for
    // ridgeWeightAt and roadCarveLayer's falloff in this file and in heightField.ts),
    // multiplied by the current gap between floor and base and by the step's own
    // contribution to distToRoute.
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    const index = buildRoadIndex(spline, 1);
    const base = buildBaseAltitude(spline, FIELD_PADDING);
    const s = spline.getAllSamples()[500];
    const step = 0.5;

    const landAt = (x: number, z: number): number =>
      valleyLandAt(base.sample(x, z), base.floor(x, z), index.nearest(x, z).dist);

    function toleranceFor(x0: number, z0: number, x1: number, z1: number): number {
      const dBase = Math.abs(base.sample(x1, z1) - base.sample(x0, z0));
      const dFloor = Math.abs(base.floor(x1, z1) - base.floor(x0, z0));
      const gap0 = Math.abs(base.floor(x0, z0) - base.sample(x0, z0));
      const gap1 = Math.abs(base.floor(x1, z1) - base.sample(x1, z1));
      const maxGap = Math.max(gap0, gap1);
      const rampMax = 1.5 / VALLEY_SPAN; // smoothstep's max derivative
      const dDist = Math.abs(index.nearest(x1, z1).dist - index.nearest(x0, z0).dist);
      return (dBase + dFloor + maxGap * rampMax * dDist) * 1.25;
    }

    let prevX = s.x - s.normalX * 260, prevZ = s.z - s.normalZ * 260;
    let prev = landAt(prevX, prevZ);
    for (let lat = -259.5; lat <= 260; lat += step) {
      const x = s.x + s.normalX * lat, z = s.z + s.normalZ * lat;
      const h = landAt(x, z);
      const tolerance = toleranceFor(prevX, prevZ, x, z);
      assert.ok(
        Math.abs(h - prev) <= tolerance + 1e-9,
        `valleyLandAt jumped ${Math.abs(h - prev).toFixed(3)} m at lat ${lat} (tolerance ${tolerance.toFixed(3)} m)`
      );
      prev = h;
      prevX = x;
      prevZ = z;
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

  it("is inert beyond the carve radius: height falls through to the land exactly", () => {
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    const index = buildRoadIndex(spline, 1);
    const s = spline.getAllSamples()[400];
    const landAt = () => s.y + 200;
    const far = carveAt(s.x + s.normalX * 400, s.z + s.normalZ * 400, index, landAt);
    assert.equal(far.nearestDist, Infinity);
    assert.equal(far.height, s.y + 200);
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
      // The layer no longer returns the faded minimum alone: it clamps that between a
      // support floor (MAX_BANK_SLOPE) and a hard clearance ceiling (MAX_CUT_SLOPE), added so
      // one tier's drop profile could not pull the ground out from under a neighbouring
      // tier. Where either is the binding constraint the result follows ITS slope, plus the
      // gradient of the continuity slack that fades each one out at the query radius. Both
      // constants must track roadCarveLayer.ts.
      const MAX_CUT_SLOPE_FOR_TEST = 3.0;
      const CONTINUITY_SLACK_FOR_TEST = 60;
      const CORE_RADIUS_FOR_CARVE = 12;
      const slackGradient = CONTINUITY_SLACK_FOR_TEST * (1.5 / (CARVE_RADIUS - CORE_RADIUS_FOR_CARVE));
      const constraintBound = MAX_CUT_SLOPE_FOR_TEST + slackGradient;
      return Math.max(max, constraintBound) * 1.25 * step;
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

describe("HeightField", () => {
  // A flat 2.5 m/m Lipschitz bound on the field's slope does not hold and is not assumed
  // here. A declared dropDepth cliff has an initial slope of depth * DROP_FALLOFF
  // (maxLegitSlopeForSample above), which can legitimately exceed 2.5 m/m — e.g. a 125 m
  // drop starts at ~6.9 m/m, a real cliff shape produced by the profile itself, not a
  // defect. The bound here is derived per probe from the actual road
  // samples carveAt would combine there (near field, mirroring roadCarveLayer's own
  // "is continuous across the medial axis" test's toleranceFor), or from the ridge layer's
  // own analytic gradient bound (far field, where no road tier is within CARVE_RADIUS of
  // any of the probed points).
  const RIDGE_GRADIENT_BOUND = 1.092; // ridgeReliefAt's raw analytic gradient bound, m/m
  // Must track heightField.ts's RIDGE_SCALE, duplicated here for the same reason
  // DROP_FALLOFF is duplicated above: this file must not import implementation constants
  // that heightField.ts does not export.
  const RIDGE_SCALE_FOR_TEST = 0.65;

  // maxLegitSlopeForSample (above) only bounds the EXPOSED side's drop branch of
  // profileHeightAt (depth * DROP_FALLOFF) — that is all roadCarveLayer's own continuity
  // test needed, because the one sample it sweeps happens to be exposed with a nonzero
  // dropDepth. Applying it verbatim here (as amendment D's literal instructions read)
  // FAILED at the very first probe: borbera-sprint s=0 lat=-6 is exposure "none",
  // dropDepth 0, so maxLegitSlopeForSample returns exactly 0 — yet the real field there
  // steps 0.034 m/m, from the OPEN-VALLEY-RISE branch of profileHeightAt (a completely
  // different, legitimate, non-cliff slope that formula never modeled). This is not a
  // discontinuity: separately verified the cut and hillside-rise branches also have their
  // own non-zero legitimate slopes profileHeightAt can produce (the hillside-rise branch's
  // initial slope is (HILLSIDE_RISE - CUT_HEIGHT) * HILL_FALLOFF ≈ 1.26 m/m). Rather than
  // hand-derive an analytic bound per branch (repeating what round 4 already did once, and
  // risking missing a branch the way this first draft did), this measures the ACTUAL
  // worst-case slope profileHeightAt can produce for a given sample directly, by finite
  // difference across the sample's own full lateral range out to CARVE_RADIUS on both
  // sides — i.e. every branch the profile can take, empirically, not a subset chosen by
  // hand. Memoized per sample object since the same samples recur across probes/hits.
  const profileSlopeCache = new WeakMap<object, number>();
  function maxProfileSlopeForSample(s: Parameters<typeof profileHeightAt>[0]): number {
    const cached = profileSlopeCache.get(s);
    if (cached !== undefined) return cached;
    let max = 0;
    const dstep = 0.5;
    let prev = profileHeightAt(s, -CARVE_RADIUS);
    for (let lat = -CARVE_RADIUS + dstep; lat <= CARVE_RADIUS + 1e-9; lat += dstep) {
      const h = profileHeightAt(s, lat);
      const slope = Math.abs(h - prev) / dstep;
      if (slope > max) max = slope;
      prev = h;
    }
    profileSlopeCache.set(s, max);
    return max;
  }

  // roadCarveLayer.ts's CORE_RADIUS is not exported (only CARVE_RADIUS is); duplicated
  // here for the same reason DROP_FALLOFF is duplicated above. Must track that file.
  const CORE_RADIUS_FOR_TEST = 12;

  function fieldToleranceAt(
    index: RoadIndex,
    base: ReturnType<typeof buildBaseAltitude>,
    points: Array<[number, number]>
  ): number {
    let maxSlope = 0;
    let maxLandGap = 0;
    let sawHit = false;
    for (const [px, pz] of points) {
      const land = base.sample(px, pz);
      for (const h of index.query(px, pz, CARVE_RADIUS)) {
        sawHit = true;
        const slope = maxProfileSlopeForSample(h.sample);
        if (slope > maxSlope) maxSlope = slope;
        // A second near-field finding: carveAt's height is
        // land + (proposed - land) * w, so its gradient includes a term
        // (proposed - land) * dw/dn that neither amendment D's literal formula nor
        // maxProfileSlopeForSample alone accounts for — both implicitly assumed `land`
        // stays close to `proposed` (true of the synthetic landAt stubs
        // roadCarveLayer.test's own continuity test used, false of the REAL landAt
        // amendment B mandates here: base.sample(x,z), which tracks the whole stage's
        // altitude and can differ from a nearby road sample's own profile height by
        // hundreds of metres, e.g. near a stage's start). Measured concretely:
        // salita-cosola s=0 lat=-20 stepped 1.31 m/m against a tolerance of 0.37 m/m
        // computed from maxProfileSlopeForSample alone; decomposing carveAt's own
        // formula there showed the (proposed - land) * dw/dn term at ~1.07 m/m, dwarfing
        // the profile-slope term. This is a real, amendment-mandated consequence of
        // fading a possibly-very-different `land` in over just
        // (CARVE_RADIUS - CORE_RADIUS) = 78 m, not a wedge bug — the field is still
        // provably continuous in VALUE, just steep in this band where land and the road
        // profile disagree by a lot. Bounding it from the actual candidates available at
        // this probe (not a fixed constant, per the same data-derived philosophy as
        // amendment D):
        const gap = Math.abs(profileHeightAt(h.sample, h.lat) - land);
        if (gap > maxLandGap) maxLandGap = gap;
      }
    }
    if (!sawHit) {
      // Far field: no road tier within CARVE_RADIUS of any of the probed points, so
      // carveAt contributes nothing there (weight 0) and heightAt's far-field branch
      // governs: base.sample(x,z) + ridgeWeightAt(d) * (RIDGE_BASE + ridgeReliefAt*RIDGE_SCALE).
      //
      // FINDING (reported per amendment D's instruction to stop and report a genuine
      // Lipschitz failure with numbers): amendment D's literal far-field tolerance —
      // "1.092 m/m raw, times RIDGE_SCALE", i.e. RIDGE_GRADIENT_BOUND * RIDGE_SCALE_FOR_TEST
      // alone — FAILED at borbera-sprint s=330.04 lat=600 (distToRoute ~590 m, inside the
      // ridgeWeightAt ramp, 180-800 m): measured step 0.7137 m/m against that tolerance of
      // 0.7098 m/m. Decomposed directly (not a wedge/cliff — genuinely gentle terrain):
      //   weight-ramp term  (ridgeWeightAt(d1)-ridgeWeightAt(d0)) * (RIDGE_BASE + relief*RIDGE_SCALE)  = -0.5354
      //   relief term       ridgeWeightAt(d) * RIDGE_SCALE * (relief1 - relief0)                        = -0.1696
      //   base term         base.sample(x,z+1) - base.sample(x,z)                                       = -0.0087
      //   total                                                                                          = -0.7137
      // The dominant term (0.535 of 0.714) is the WEIGHT RAMP itself: ridgeWeightAt's own
      // derivative, multiplied by (RIDGE_BASE + relief*RIDGE_SCALE) which can be as large as
      // ~470 m, was entirely omitted from amendment D's stated bound. That bound only covers
      // the relief-gradient term (RIDGE_SCALE * RIDGE_GRADIENT_BOUND); it implicitly assumed
      // "far field" meant the weight had already saturated (d >= RIDGE_FULL = 800, where
      // ridgeWeightAt's derivative is 0), but "no hits" (this branch) starts at
      // CARVE_RADIUS = 90 m, deep inside the 180-800 m ramp where the weight is still
      // changing. This is not a code defect — it's real terrain, a smooth blend of a ~190 m
      // ridge amplitude onto the base altitude over 620 m — but amendment D's tolerance
      // formula as literally stated does not bound it. Completing it analytically, the same
      // way amendment D itself completed the original fixed 2.5 m/m Lipschitz bound:
      //   weightRampBound = W'_max * (RIDGE_BASE + RIDGE_AMPLITUDE * RIDGE_SCALE)
      //     W'_max = 1.5 / (RIDGE_FULL - RIDGE_START)          -- smoothstep's max derivative
      //     RIDGE_AMPLITUDE = 160+140+80+50 = 430               -- sum of ridgeReliefAt's harmonic amplitudes, its own |gradient| bound over any unit direction is at most this (not tight, but a safe global cap independent of the 1.092 empirical bound)
      //   reliefRampBound  = RIDGE_SCALE_FOR_TEST * RIDGE_GRADIENT_BOUND   -- amendment D's original term, unchanged
      //   baseBound        = 2.5                                -- baseAltitude's own "is continuous" test bound, established elsewhere in this file
      // Summed (not maxed) because all three terms can act in the same direction
      // simultaneously, then given the same 1.25 safety margin every other branch of this
      // test uses.
      const RIDGE_FULL = 800, RIDGE_START = 180; // must track ridgeLayer.ts
      const RIDGE_AMPLITUDE = 160 + 140 + 80 + 50; // must track ridgeReliefAt's harmonic amplitudes
      const RIDGE_BASE_FOR_TEST = 190; // must track heightField.ts's RIDGE_BASE
      const weightRampBound =
        (1.5 / (RIDGE_FULL - RIDGE_START)) * (RIDGE_BASE_FOR_TEST + RIDGE_AMPLITUDE * RIDGE_SCALE_FOR_TEST);
      const reliefRampBound = RIDGE_SCALE_FOR_TEST * RIDGE_GRADIENT_BOUND;
      const baseBound = 2.5;
      return (weightRampBound + reliefRampBound + baseBound) * 1.25;
    }
    // Falloff's max derivative is the same smoothstep shape as the ridge weight's, just
    // over (CORE_RADIUS, CARVE_RADIUS) instead of (RIDGE_START, RIDGE_FULL); |dd/dn| <= 1
    // for the same reason (distance-to-a-set is 1-Lipschitz).
    const wRampMax = 1.5 / (CARVE_RADIUS - CORE_RADIUS_FOR_TEST);
    const landGapBound = maxLandGap * wRampMax;
    // The carve also clamps its result between a support floor and a hard clearance ceiling
    // (roadCarveLayer.ts, MAX_BANK_SLOPE / MAX_CUT_SLOPE), added so one tier's drop profile
    // could no longer pull the ground out from under a neighbouring tier. Where either
    // constraint is the binding one the field follows IT, not the profile, so its own slope
    // belongs in this bound: the steeper of the two, plus the gradient of the continuity
    // slack that fades each constraint out at the radius edge. Both constants must track
    // roadCarveLayer.ts, for the same reason CORE_RADIUS_FOR_TEST above does.
    const MAX_CUT_SLOPE_FOR_TEST = 3.0;
    const CONTINUITY_SLACK_FOR_TEST = 60;
    const constraintBound = MAX_CUT_SLOPE_FOR_TEST + CONTINUITY_SLACK_FOR_TEST * wRampMax;
    return (Math.max(maxSlope, constraintBound) + landGapBound) * 1.25;
  }

  it("satisfies a data-derived Lipschitz bound (amendment D — see comment above)", () => {
    for (const entry of STAGE_LIST) {
      const spline = new TrackSpline(getStageDef(entry.id));
      const field = createHeightField(spline);
      const index = field.index;
      // Same deterministic construction heightField.ts uses internally (buildBaseAltitude
      // is a pure function of the spline), so this `base` matches the field's own `land`
      // exactly — needed to compute the near-field ramp tolerance term above.
      const base = buildBaseAltitude(spline, FIELD_PADDING);
      const all = spline.getAllSamples();

      for (let i = 0; i < all.length; i += 17) {
        const s = all[i];
        for (const lat of [6, 20, 55, 110, 240, 600, 1500]) {
          for (const side of [-1, 1]) {
            const x = s.x + s.normalX * lat * side;
            const z = s.z + s.normalZ * lat * side;
            const h0 = field.heightAt(x, z);
            const hx = field.heightAt(x + 1, z);
            const hz = field.heightAt(x, z + 1);
            const dhx = Math.abs(hx - h0);
            const dhz = Math.abs(hz - h0);
            const tolerance = fieldToleranceAt(index, base, [
              [x, z],
              [x + 1, z],
              [x, z + 1],
            ]);
            assert.ok(
              dhx <= tolerance,
              `${entry.id} s=${s.s} lat=${lat * side}: field steps ${dhx.toFixed(2)} m per metre in x (tolerance ${tolerance.toFixed(2)} m)`
            );
            assert.ok(
              dhz <= tolerance,
              `${entry.id} s=${s.s} lat=${lat * side}: field steps ${dhz.toFixed(2)} m per metre in z (tolerance ${tolerance.toFixed(2)} m)`
            );
          }
        }
      }
    }
  });

  it("never places ground above the road on any ribbon", () => {
    for (const entry of STAGE_LIST) {
      const spline = new TrackSpline(getStageDef(entry.id));
      const field = createHeightField(spline);

      for (const s of spline.getAllSamples()) {
        for (let lat = -(s.halfWidth + 1.7); lat <= s.halfWidth + 1.7; lat += 0.3) {
          const h = field.heightAt(s.x + s.normalX * lat, s.z + s.normalZ * lat);
          assert.ok(
            h <= s.y - 0.25 + 1e-6,
            `${entry.id} s=${s.s} lat=${lat.toFixed(1)}: ${h.toFixed(3)} above road ${s.y.toFixed(3)}`
          );
        }
      }
    }
  });

  it("is deterministic", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const a = createHeightField(spline);
    const b = createHeightField(spline);
    const s = spline.getAllSamples()[500];
    for (let i = 0; i < 200; i++) {
      const x = s.x + i * 13.7, z = s.z - i * 29.1;
      assert.equal(a.heightAt(x, z), b.heightAt(x, z), `mismatch at ${x},${z}`);
    }
  });

  it("returns colours in range", () => {
    const spline = new TrackSpline(getStageDef("salita-cosola"));
    const field = createHeightField(spline);
    const all = spline.getAllSamples();
    for (let i = 0; i < all.length; i += 40) {
      for (const lat of [10, 80, 400]) {
        const c = field.classifyAt(all[i].x + all[i].normalX * lat, all[i].z + all[i].normalZ * lat);
        for (const v of [c.r, c.g, c.b]) {
          assert.ok(v >= 0 && v <= 1, `colour component out of range: ${v}`);
        }
      }
    }
  });

  // Review finding: sampleAt was added so height and colour can share one spatial query
  // instead of heightAt and classifyAt each re-deriving it. This pins "behaviour
  // identical": sampleAt's height/colour must match calling heightAt/classifyAt
  // separately, exactly, at every probe — including at least one far-field point (beyond
  // CARVE_RADIUS, no road hits at all) and one in-band point (near-field, carveAt has
  // hits), since those take different code paths inside sampleAt.
  /**
   * REPLACES a tautology. This test used to assert
   * `field.sampleAt(x, z).height === field.heightAt(x, z)` — but createHeightField defines
   * `heightAt: (x, z) => sampleAt(x, z).height` and `classifyAt: (x, z) => sampleAt(x, z).color`,
   * so it was asserting `sampleAt(p).height === sampleAt(p).height`. It could only ever fail
   * if the field were non-deterministic, which the test above it already covers, and it went
   * on passing through every terrain defect this suite exists to catch.
   *
   * The property worth having is the one the implementation actually risks. `sampleAt` runs
   * one `index.query` for the centre point and then REUSES that hit list for its two slope
   * probes via `reproject`, which builds new RoadHit objects from the shared `sample`
   * references. If any of that ever mutated a hit or a sample in place — or if the index's
   * per-query scratch state leaked between calls — results would start depending on what was
   * sampled just before, and a terrain mesh would come out subtly different depending on the
   * order its vertices happened to be generated in. Nothing else in this suite would notice:
   * every other test samples points in one fixed order.
   */
  it("sampleAt is a pure function of position, whatever was sampled before it", () => {
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    const field = createHeightField(spline);
    const all = spline.getAllSamples();

    const probes: [number, number][] = [];
    for (let i = 0; i < all.length; i += 97) {
      const s = all[i];
      // Near field, the seam at CARVE_RADIUS, and far field.
      for (const lat of [4, 30, 90, 400, 1200]) {
        for (const side of [-1, 1]) {
          probes.push([s.x + s.normalX * lat * side, s.z + s.normalZ * lat * side]);
        }
      }
    }
    assert.ok(probes.length > 100, "expected a decent set of probe points");

    // Baseline, in order.
    const baseline = probes.map(([x, z]) => field.sampleAt(x, z));

    // Now re-sample each point again, but with the whole probe set walked in between and in
    // reverse — so every call is preceded by a different query neighbourhood than it was the
    // first time.
    for (let i = probes.length - 1; i >= 0; i--) {
      const [x, z] = probes[i];
      const again = field.sampleAt(x, z);
      assert.equal(
        again.height,
        baseline[i].height,
        `sampleAt(${x.toFixed(2)}, ${z.toFixed(2)}) returned ${again.height} after a different ` +
          `call order, ${baseline[i].height} before — the field is carrying state between calls`
      );
      assert.deepEqual(again.color, baseline[i].color, "colour changed with call order");
    }

    // And the convenience wrappers must not diverge from the combined entry point. This is
    // trivially true while they delegate; it is here so that an optimisation which gives
    // heightAt its own cheaper path — the obvious next change to this file — cannot silently
    // return something different from what the mesh builder sees.
    for (let i = 0; i < probes.length; i += 7) {
      const [x, z] = probes[i];
      assert.equal(field.heightAt(x, z), baseline[i].height, "heightAt diverged from sampleAt");
      assert.deepEqual(field.classifyAt(x, z), baseline[i].color, "classifyAt diverged from sampleAt");
    }
  });
});
