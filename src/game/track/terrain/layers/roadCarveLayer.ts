/**
 * VAL BORBERA HILLCLIMB — Road Carve Layer
 *
 * How the road cuts the landscape. Every road sample within CARVE_RADIUS proposes a
 * ground height from its own lateral profile, and they combine by MINIMUM.
 *
 * Minimum rather than nearest-neighbour is the whole point. The previous corridor mesh
 * picked one road tier and then clamped its own width to 40% of the gap to the opposing
 * tier, because a road-relative parameterization folds over itself at a hairpin. That
 * clamp is what left holes between stacked tornanti. Taking the minimum over all tiers
 * has no fold to avoid: the ground simply stays below every road near it, and two stacked
 * tiers get one continuous surface between them, with a gradient kink (a valley) where
 * their proposals cross rather than a hole.
 *
 * The clearance guarantee lives here, in the field, and not in the mesh builder. That is
 * what makes "terrain on the road" unrepresentable rather than merely untuned: no
 * sampling density, no chord sag across a curve, and no future constant can lift ground
 * onto the ribbon. It was originally enforced by an explicit clamp; it is now enforced by
 * construction instead (see the notes below) and held to account by a test rather than a
 * runtime cap.
 *
 * FADING TOWARD THE LAND, NOT A CONSTANT (fixed defect): the
 * first version of this file computed a per-hit C1 falloff `w` but only used it to
 * populate the `weight` output — every hit still contributed its raw `profileHeightAt` to
 * the combination at full strength regardless of distance, and vanished with no fade at
 * the hard `CARVE_RADIUS` query cutoff. That was wrong twice over: it let a road sample
 * 90 m away drag ground meters below a completely different tier, and it produced an
 * actual discontinuity at the cutoff (measured: 57.6 m over 0.5 m of lateral travel). The
 * fix is to blend each candidate toward the surrounding LAND height — not a neutral
 * constant — by its own falloff weight before it enters the combination: `land +
 * (proposed - land) * w`. At w=1 (on the ribbon) this is exactly the raw profile; at w=0
 * the candidate proposes "the land as it would be without this road" and is inert.
 * Because `land` is itself derived from the same `nearestDist` this function already
 * computes, land is passed in as a callback rather than looked up separately, so the
 * whole field still costs exactly one spatial query per point.
 *
 * NO HARD CLEARANCE CLAMP (fixed defect): an earlier version
 * of this file also capped `height` below `sample.y - ROAD_CLEARANCE` for any hit whose
 * `|lat| <= halfWidth + VERGE_WIDTH + CLAMP_MARGIN`, on top of the combination above. That
 * clamp was itself a hard, unfaded, all-or-nothing per-hit contribution — the exact same
 * defect class as the query-radius cutoff, just relocated. Crossing the clamp band
 * boundary snapped `clampCeiling` from `Infinity` to a fixed value with no fade,
 * producing an 8.31 m jump over 0.5 m of lateral travel where a probe passed close to a
 * different tier's ribbon.
 *
 * The clamp is provably unnecessary once `w` reaches exactly 1 near the road, so it is
 * deleted rather than faded like the round-1 fix. The argument: on tier i's own ribbon,
 * `profileHeightAt(sample_i, lat_i) <= sample_i.y - ROAD_CLEARANCE` by construction (Task
 * 2), and a plain minimum never exceeds any of its inputs. So as long as candidate i's
 * blended proposal equals its raw profile proposal exactly — i.e. `w_i == 1` — the final
 * `height` is guaranteed `<= sample_i.y - ROAD_CLEARANCE` with no clamp needed. The old
 * falloff only reached `w ~ 0.991` at a few metres from the centreline, not exactly 1,
 * which is the entire reason the clamp existed. Giving the falloff a flat core
 * (CORE_RADIUS, below) so it reaches exactly 1 well inside the clamp band removes the
 * residue and makes the clamp dead code. Do not reintroduce a clamp: if this guarantee
 * ever seems to fail, the fix is to restore `w_i == 1` at short range, not to cap the
 * output.
 *
 * PLAIN MINIMUM, NOT SOFT-MIN (fixed defect): this file used
 * to combine candidates with a polynomial soft-min, `softMin(a,b,k) = min(a,b) -
 * h(a,b)^2 * k/4`, folded pairwise across every hit in sequence. That is wrong: soft-min
 * is not associative, so chaining it across N candidates does not approximate a single
 * N-way soft minimum — it compounds the `k/4` penalty at every pairwise step whose two
 * operands land within `k` of each other. Near CARVE_RADIUS, dozens of candidates can all
 * be faded to within a few centimetres of `land` at once (each individually inert, `w ~
 * 0`), and folding soft-min across all of them pulled the aggregate result more than 10 m
 * below `land` — a bias that grows with candidate COUNT, not with the true shape of the
 * minimum, and that vanishes discontinuously the instant the candidate count drops (e.g.
 * hits.length hitting 0 at the CARVE_RADIUS edge). Replacing the fold with log-sum-exp
 * would not fix this either — that form is `x - k*ln(N)`, the same N-dependence in a
 * different shape.
 *
 * The fix is that the fade already did the hard work. Every candidate now approaches
 * `land` as its own weight goes to zero, so a candidate entering or leaving the radius
 * arrives at, and departs at, exactly `land` — not a value near it, exactly it. Seeding
 * the running minimum with `land` itself (so `land` is a permanent, always-present member
 * of the set being minimised) makes a PLAIN `Math.min` continuous across those entries and
 * exits: the arriving/departing member's value equals a member that is already present
 * and stays present, so the minimum cannot move when it appears or disappears. This has no
 * dependence on N and no compounding bias — it is exactly the minimum of the (faded)
 * candidates, nothing subtracted, nothing added.
 *
 * What this costs: the field is no longer C1 where two tiers' faded proposals cross — the
 * gradient can kink there. That is accepted deliberately. A kink where two slopes meet is
 * a valley, which is what real terrain does at a col between two hillsides; the defect
 * this refactor exists to eliminate is a HEIGHT discontinuity — a cliff you can see
 * through — and a plain min over faded candidates has none, provably, with no
 * N-dependence and no bias. Simple and correct beats smooth and wrong.
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

import { RoadHit, RoadIndex } from "../roadIndex";
import { profileHeightAt, ROAD_CLEARANCE, VERGE_WIDTH } from "./roadProfile";

export const CARVE_RADIUS = 90;

/**
 * Steepest ground the carve will let the road stand on, metres down per metre out from the
 * edge of the built road. Ground lower than this beside a carriageway is what "the road is
 * floating" looks like from the car.
 *
 * A plain minimum over every nearby road's lateral profile is a correct CEILING — it keeps
 * the ground under every tier — but it says nothing about how high the ground is allowed to
 * be, so one road sample whose drop happens to point at a neighbouring tier pulls the ground
 * out from under that tier as well. Measured on Salita di Cosola: at s = 1828 the winning
 * proposal came from a sample 74 m away and 28 m LOWER, whose exposed side faces uphill
 * toward this one; it put the ground 84 m below a carriageway that its own stage marks as
 * unexposed. The road there is supported by nothing, and the embankment builder then tried
 * to carry a kilometre of it on viaduct.
 *
 * The support constraint below fixes that without touching the ceiling: near any road, the
 * ground may not sit deeper than a MAX_BANK_SLOPE hillside from that road's own edge. It is
 * the same slope the exposed drop profile itself now uses, so it never fights the intended
 * drop — it only bites where some OTHER tier's profile reached across and dug underneath.
 */
export const MAX_BANK_SLOPE = 1.15;

/**
 * Steepest bank the ground may CLIMB away from a road, metres up per metre out. This is the
 * hard clearance ceiling, relaxed with distance: right at the road it is exactly
 * `y - ROAD_CLEARANCE`, and it opens up quickly enough that a genuine stacked switchback —
 * where two tiers are closer together horizontally than their height difference — resolves
 * in favour of keeping the ground under the LOWER road, which is the only choice a
 * single-valued heightfield has.
 */
const MAX_CUT_SLOPE = 3.0;

/**
 * How far beyond the carriageway edge the hard ceiling stays flat at `y - ROAD_CLEARANCE`,
 * metres — i.e. where the ceiling may not start relaxing upward at all.
 *
 * Without it the ceiling relaxed from the verge outward, and since the support floor is
 * clamped to the ceiling, ground just past the verge could be lifted to slightly ABOVE the
 * road surface: measured on Borbera Sprint, 0.24 m below the road at lat 4.9 where the
 * guarantee is 0.25 m. This is the same band the deleted clearance clamp used to cover —
 * `max(halfWidth) + VERGE_WIDTH = 6.6 m` across every stage — so holding the ceiling flat
 * across it restores the guarantee by construction rather than by tolerance.
 */
const CEIL_FLAT = 6.6;

/**
 * How far the two constraints below relax as a hit's falloff weight drops to zero, metres.
 *
 * Both are combined across hits by min/max, so a hit appearing or disappearing at the
 * CARVE_RADIUS boundary would be a height discontinuity if it happened to be the extremum at
 * that moment. Adding `SLACK * (1 - w)` to the ceiling and subtracting it from the floor
 * makes a departing hit maximally relaxed exactly when it leaves. At w = 0 a hit is 90 m
 * away, so its raw ceiling already sits ~240 m above its own road and its raw floor ~90 m
 * below; another 60 m on top of that puts both far outside anything a stage's relief can
 * reach within one carve radius, which is what makes the departure harmless.
 *
 * Linear in `(1 - w)` rather than the `(1/w - 1)` that first stood here: that form diverges,
 * which makes departure airtight but gives the constraint an unbounded gradient near the
 * radius edge, and the field's Lipschitz bound is a property worth keeping provable.
 */
const CONTINUITY_SLACK = 60;

/**
 * Radius within which a hit's falloff weight is exactly 1, not just close to it. This
 * flat core is what makes the deleted clearance clamp provably unnecessary — see the
 * module doc — so it needs to cover every point the clamp used to cover.
 *
 * The clamp band was `halfWidth + VERGE_WIDTH + CLAMP_MARGIN`. `halfWidth` is not a
 * constant: trackBuilder.ts widens the base 3.6 m by 1.8 m at hairpin apexes, and the
 * observed maximum across all three stages is 5.4 m (borbera-sprint and salita-cosola
 * both reach it; cresta-ebro tops out at 5.2 m). Worst case is therefore
 * `max(halfWidth) + VERGE_WIDTH = 5.4 + 1.2 = 6.6 m` (confirmed by direct query: the
 * worst-case nearest-sample distance at an in-band point is exactly 6.6 m). Against
 * `CORE_RADIUS = 12`, that is a margin of `12 - 6.6 = 5.4 m`, a ratio of 1.82x — not the
 * "better than 2x" this comment used to claim, which was derived from the default 3.6 m
 * `halfWidth` rather than the true observed maximum.
 *
 * The guarantee still holds at 1.82x margin. If `halfWidth` ever grows further, the
 * inequality to re-check is `max(halfWidth) + VERGE_WIDTH < CORE_RADIUS`; the "never
 * returns ground above the road, anywhere on any ribbon" test in terrain-field.test.ts is
 * what would catch it if this margin were ever exceeded.
 */
const CORE_RADIUS = 12;

export interface CarveResult {
  /** Carved ground height at this point. */
  height: number;
  /**
   * Smallest `dist` among the contributing hits (Infinity if there were none). Returned
   * because callers on the hottest path (Task 6's heightAt, once per generated vertex)
   * would otherwise need a second spatial query — index.nearest(x, z) — to get the same
   * answer that this loop already computes for free.
   */
  nearestDist: number;
}

/**
 * @param landAt Surrounding land height as a function of distance to the nearest road
 *   sample. CONTRACT: must be constant for `nearestDist >= CARVE_RADIUS`. `nearestDist`
 *   is computed purely from the CARVE_RADIUS query below — this function never queries
 *   further to find a true nearest distance — so it jumps from just under CARVE_RADIUS to
 *   `Infinity` the instant a point leaves the radius (hits.length drops to 0). A `landAt`
 *   that is still varying at that boundary reintroduces exactly the discontinuity class
 *   Round 1 fixed, just relocated into the caller. Concretely: `landAt` must have reached
 *   its asymptotic value by `nearestDist = CARVE_RADIUS` at the latest (saturating a
 *   margin before it is safer), so that `landAt(CARVE_RADIUS)` and `landAt(Infinity)`
 *   agree.
 *
 * `carveFromHits` below, not this function, is what the height field actually calls in
 * production: heightField.ts's `sampleAt` already runs its own `index.query` (it needs the
 * hit list for the slope probe too, via `reproject`), so it calls `carveFromHits` directly
 * on hits it already has rather than paying for a second, redundant query through here.
 * `carveAt` still exists as the convenient one-call form — do its own query, do the
 * combination, return the result — and is what the test suite uses to exercise the
 * combination logic without needing to build a hit list by hand.
 */
export function carveAt(
  x: number,
  z: number,
  index: RoadIndex,
  landAt: (nearestDist: number) => number
): CarveResult {
  return carveFromHits(index.query(x, z, CARVE_RADIUS), landAt);
}

/**
 * The combination logic itself: fold every hit into a seeded minimum, faded toward
 * `landAt` by distance. This is what production calls (heightField.ts's `sampleAt`, on
 * the hottest path in the renderer — once per generated terrain vertex, plus twice more
 * for the slope probe's offset points), because it already has the CARVE_RADIUS-filtered
 * hit list for (x, z) — computed via `index.query` for the centre point, or via
 * `reproject` for a nearby probe point — and calling this directly avoids paying for a
 * second, redundant spatial query that `carveAt` would otherwise run.
 *
 * Introduced for the height field's slope probe (heightField.ts): probing a couple of
 * metres away from a point that already ran `index.query` would otherwise re-walk the
 * spatial grid from scratch for each offset, when the two points' CARVE_RADIUS
 * neighbourhoods overlap almost entirely. The caller instead re-projects the centre
 * point's already-fetched hits onto each offset point (cheap — no grid walk, just a
 * `hit()` distance recompute per already-known sample; see heightField.ts's `reproject`)
 * and calls this function once per probe point. The combination logic itself (fade,
 * seeded minimum) is unchanged from `carveAt` — only how `hits` gets built differs; the
 * falloff below already clamps any hit whose recomputed distance drifted past
 * CARVE_RADIUS to zero weight, so a stale/unfiltered `hits` array is harmless.
 */
export function carveFromHits(
  hits: RoadHit[],
  landAt: (nearestDist: number) => number
): CarveResult {
  if (hits.length === 0) {
    return { height: landAt(Infinity), nearestDist: Infinity };
  }

  let nearestDist = Infinity;
  for (const h of hits) if (h.dist < nearestDist) nearestDist = h.dist;
  const land = landAt(nearestDist);

  // Seed the running minimum with `land` itself, not `Infinity`. Every candidate below
  // fades toward `land` as its weight goes to zero, so a hit entering or leaving
  // CARVE_RADIUS arrives at / departs at exactly `land` — a value already present in the
  // set being minimised. A plain Math.min over a set containing a permanent `land` member
  // is therefore continuous across those entries and exits, with no compounding and no
  // dependence on how many hits are nearby. See the module doc for why this replaced a
  // pairwise-folded soft-min, which compounded a bias proportional to candidate count.
  let height = land;
  /** Hard clearance ceiling across all hits — see MAX_CUT_SLOPE. */
  let ceiling = Infinity;
  /** Support floor across all hits — see MAX_BANK_SLOPE. */
  let support = -Infinity;

  for (const h of hits) {
    // C1 falloff with a flat core: exactly 1 within CORE_RADIUS, 0 at CARVE_RADIUS.
    // The flat core (rather than a falloff that only approaches 1) is what makes the
    // clearance guarantee below hold without a clamp — see the module doc.
    const t = (CARVE_RADIUS - h.dist) / (CARVE_RADIUS - CORE_RADIUS);
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    const w = c * c * (3 - 2 * c);

    // Blend this hit's raw profile proposal toward the surrounding land by its own
    // falloff weight, rather than admitting it at full strength up to a hard cutoff. At
    // w=1 (dist <= CORE_RADIUS) this is exactly profileHeightAt, which is already
    // guaranteed below the road surface (Task 2); at w=0 it is inert (== land). No
    // separate clearance clamp is needed: a plain minimum never exceeds any of its
    // inputs, so once the nearest tier's candidate is admitted at full strength, the
    // result is bounded by that candidate automatically.
    const proposed = profileHeightAt(h.sample, h.lat);
    const blended = land + (proposed - land) * w;
    if (blended < height) height = blended;

    // Ceiling and support, both measured from the EDGE of the built road rather than from
    // the centreline, and both faded to inert (infinite) at w = 0 so neither can jump when
    // a hit crosses CARVE_RADIUS.
    if (w > 0) {
      // Measured from `dist` (the distance to the sample itself), NOT from `lat`. A sample
      // 90 m further ALONG a straight road has lat ~ 0 while being at the very edge of the
      // query radius; keyed on lat its constraint would enter the min/max at nearly full
      // strength the moment it came into range, which is a height discontinuity of tens of
      // metres. `dist` is what actually goes to zero only when the point is on that sample.
      const dd = Math.max(0, h.dist - h.sample.halfWidth - VERGE_WIDTH);
      const slack = CONTINUITY_SLACK * (1 - w);
      const top = h.sample.y - ROAD_CLEARANCE;
      const c = top + MAX_CUT_SLOPE * Math.max(0, h.dist - h.sample.halfWidth - CEIL_FLAT) + slack;
      if (c < ceiling) ceiling = c;
      const f = top - MAX_BANK_SLOPE * dd - slack;
      if (f > support) support = f;
    }
  }

  // Raise the ground back up to what the nearby road can actually stand on, but never above
  // the clearance ceiling: where two tiers are stacked closer than MAX_CUT_SLOPE allows the
  // constraints genuinely cannot both hold, and the ceiling has to win — a heightfield can
  // only be under the lower road there. On a ribbon (dd = 0, w = 1) the ceiling is exactly
  // `y - ROAD_CLEARANCE`, so the clearance guarantee is now enforced by construction here
  // as well as by the faded minimum above.
  const floor = support < ceiling ? support : ceiling;
  if (height < floor) height = floor;
  if (height > ceiling) height = ceiling;

  return { height, nearestDist };
}
