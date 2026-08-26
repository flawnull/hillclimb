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
 * FADING TOWARD THE LAND, NOT A CONSTANT (fixed defect, see task-5-report.md round 1): the
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
 * NO HARD CLEARANCE CLAMP (fixed defect, see task-5-report.md round 2): an earlier version
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
 * PLAIN MINIMUM, NOT SOFT-MIN (fixed defect, see task-5-report.md round 3): this file used
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

import { RoadIndex } from "../roadIndex";
import { profileHeightAt } from "./roadProfile";

export const CARVE_RADIUS = 90;

/**
 * Radius within which a hit's falloff weight is exactly 1, not just close to it. The
 * clamp band (halfWidth + VERGE_WIDTH + 0.5, ~5.3 m laterally) plus sample spacing along
 * the spline (~2 m) puts the nearest sample to any in-band point within ~5.4 m; 12 m
 * gives better than 2x margin. This flat core is what makes the clamp above provably
 * unnecessary — see the module doc.
 */
const CORE_RADIUS = 12;

export interface CarveResult {
  /** Carved ground height at this point. */
  height: number;
  /** How much this point belongs to the road, 0..1. C1 in distance. */
  weight: number;
  /**
   * Smallest `dist` among the contributing hits (Infinity if there were none). Returned
   * because callers on the hottest path (Task 6's heightAt, once per generated vertex)
   * would otherwise need a second spatial query — index.nearest(x, z) — to get the same
   * answer that this loop already computes for free.
   */
  nearestDist: number;
}

export function carveAt(
  x: number,
  z: number,
  index: RoadIndex,
  landAt: (nearestDist: number) => number
): CarveResult {
  const hits = index.query(x, z, CARVE_RADIUS);
  if (hits.length === 0) {
    return { height: landAt(Infinity), weight: 0, nearestDist: Infinity };
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
  let weight = 0;

  for (const h of hits) {
    // C1 falloff with a flat core: exactly 1 within CORE_RADIUS, 0 at CARVE_RADIUS.
    // The flat core (rather than a falloff that only approaches 1) is what makes the
    // clearance guarantee below hold without a clamp — see the module doc.
    const t = (CARVE_RADIUS - h.dist) / (CARVE_RADIUS - CORE_RADIUS);
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    const w = c * c * (3 - 2 * c);
    if (w > weight) weight = w;

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
  }

  return { height, weight, nearestDist };
}
