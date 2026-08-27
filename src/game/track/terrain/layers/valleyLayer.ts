/**
 * VAL BORBERA HILLCLIMB — Valley Floor Layer
 *
 * Gives the road's drop somewhere to drop TO. `roadCarveLayer.carveAt` fades every
 * candidate toward the surrounding LAND height as its falloff weight decays
 * (`land + (proposed - land) * w`), which is exactly what round 1 of that file's history
 * required to kill the discontinuity at CARVE_RADIUS. But `land` there is
 * `baseAltitude.sample(x, z)` — an inverse-distance average of ROAD altitudes only, with
 * no notion of ground below the road. On the exposed side of a drop, that average sits at
 * roughly road height, so the fade cancels the drop profile before it reaches any floor:
 * the ground plunges away from the ribbon and is dragged straight back up to `land` within
 * a few tens of metres, producing a moat (a slot canyon) instead of a valley that stays
 * down.
 *
 * The fix is not to change how carveAt fades — that fade is correct and load-bearing for
 * continuity — but to change what it fades TOWARD: land that is itself already lowered
 * toward a floor, so the fade settles onto a floor instead of climbing back to the
 * ribbon's own altitude.
 *
 * TWO DISCRETE LOOKUPS, BOTH REMOVED (history): the first draft of this file took a
 * `RoadHit` (the winner of `RoadIndex.nearest`) and read `dropDepth`/`altitude`/`exposure`
 * straight off `near.sample`, deciding "exposed side" from the sign of `near.lat`. Both of
 * those are discrete, winner-take-all lookups, and "nearest sample" is not a continuous
 * function of position: far from the road on a switchback stage, two different legs can be
 * near-equidistant from a point, so the nearest sample — and its lat sign, and its own
 * dropDepth — flips discretely as the point moves a single metre. Measured concretely:
 * salita-cosola s=362, lat=600 stepped ~40 m in z per 1 m of world-space z, because the
 * nearest sample switched from a leg with dropDepth=70 to a different leg 90 m away with
 * dropDepth=125. That is the exact discontinuity class this whole terrain-field effort
 * exists to eliminate (see roadCarveLayer.ts's module doc, rounds 1-3, and the old
 * MountainBackdropBuilder this system replaced entirely).
 *
 * The fix is `baseAltitude.ts`'s new `floor(x, z)` grid: the IDW blend of every route
 * sample's own floor altitude, baked to a grid and read back bilinearly — continuous by
 * construction, no sample ever "wins". This file no longer touches `RoadHit`, `dropDepth`,
 * `altitude`, or `exposure` at all; its only inputs are two already-continuous numbers
 * (`base`, `floor`) and `distToRoute`, which is itself continuous everywhere (including at
 * the medial axis between two ribbons) because distance-to-a-point-set is 1-Lipschitz.
 *
 * ACCEPTED CONSEQUENCE: the valley now descends on BOTH sides of an exposed section, not
 * only the drop side. Encoding "which side" would require a per-sample signed lookup, and
 * that lookup is precisely what was discontinuous. This is fine: the cut side's correct
 * rise is still supplied by `profileHeightAt`'s own cut branch within CARVE_RADIUS, and by
 * `ridgeLayer` beyond 180 m, both layered on top of whatever this file leaves underneath —
 * neither depends on this file at all.
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

export const VALLEY_SPAN = 900;

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Un-carved land altitude, blended from `base` (road-altitude IDW) toward `floor`
 * (valley-floor IDW, see `baseAltitude.ts`) as `distToRoute` grows from 0 to `VALLEY_SPAN`.
 *
 * At `distToRoute === 0` this returns `base` exactly (on the ribbon, nothing has settled
 * into a valley yet); at `distToRoute >= VALLEY_SPAN` it returns `floor` exactly. Both
 * `base` and `floor` are already continuous bilinear grid reads, and `smoothstep` is C1, so
 * the result is continuous (and C1) in `distToRoute` — and, transitively, in `x, z`, since
 * `distToRoute` itself is continuous everywhere.
 */
export function valleyLandAt(base: number, floor: number, distToRoute: number): number {
  const t = smoothstep(distToRoute / VALLEY_SPAN);
  return base + (floor - base) * t;
}
