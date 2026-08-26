/**
 * VAL BORBERA HILLCLIMB — Unified Terrain Height Field
 *
 * ONE continuous function describing the whole landscape. Everything that needs to know
 * where the ground is — the terrain mesh, the trees, the river — asks this and nothing
 * else.
 *
 * The predecessor arrangement had two surfaces: a road-relative corridor ribbon and a
 * world-grid mountain backdrop that stencilled itself away within 120 m of the route.
 * Wherever the corridor narrowed below 120 m the player saw straight through the
 * mountains; wherever it reached its 260 m maximum the two surfaces z-fought. Because
 * there is now exactly one surface, neither failure has a mechanism.
 *
 * HOW heightAt COMBINES THE LAYERS (this differs from the original Task 6 brief — see
 * task-5-report.md and the amendments recorded here, because Task 5's carveAt signature
 * changed under review):
 *
 * `carveAt(x, z, index, landAt)` already does its own spatial query and already fades
 * every candidate toward `landAt(nearestDist)` before combining — it hands back a faded,
 * finished `height`, not a raw carve to be lerped again. So heightAt must NOT call
 * `index.nearest` a second time and must NOT lerp the result a second time; that would
 * both double-fade and double the per-vertex query cost.
 *
 * The remaining wrinkle is `landAt`'s contract: it MUST be constant for
 * `nearestDist >= CARVE_RADIUS` (see the JSDoc on `carveAt`'s `landAt` parameter), because
 * `nearestDist` jumps from just under CARVE_RADIUS straight to Infinity the instant a
 * point leaves the query radius — there is no in-between value to interpolate through.
 * The obvious closure, `base.sample(x, z) + ridgeWeightAt(d) * ridgeTerm`, is NOT constant
 * there in general... except `ridgeWeightAt` is 0 for any distance <= RIDGE_START (180 m),
 * and CARVE_RADIUS is only 90 m — strictly inside the flat zero region. So within
 * everything `carveAt` can ever see, `ridgeWeightAt(nearestDist) === 0` identically and
 * the closure reduces to plain `base.sample(x, z)`, which is trivially constant. The
 * closure passed to `carveAt` below is therefore just `() => base.sample(x, z)` — no
 * ridge term at all — and that is enough to satisfy the contract exactly, not by
 * approximation.
 *
 * That means the ridge relief never reaches the player through `carveAt` at all — it is
 * only added explicitly in the `nearestDist === Infinity` branch below, i.e. strictly
 * beyond CARVE_RADIUS. The seam at exactly `nearestDist == CARVE_RADIUS` is continuous by
 * construction: approaching from inside, carveAt's closure returns `base.sample(x, z)`
 * (ridge weight 0, since CARVE_RADIUS=90 < RIDGE_START=180); approaching from outside, the
 * far-field branch returns `base.sample(x, z) + ridgeWeightAt(90) * (...)`, and
 * `ridgeWeightAt(90) === 0` since 90 < 180, so that term also vanishes — both sides equal
 * `base.sample(x, z)`, exactly, with no gap.
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

import { TrackSpline } from "../TrackSpline";
import { buildRoadIndex, RoadIndex, FieldBounds } from "./roadIndex";
import { buildBaseAltitude } from "./layers/baseAltitude";
import { ridgeReliefAt, ridgeWeightAt } from "./layers/ridgeLayer";
import { carveAt } from "./layers/roadCarveLayer";
import { VALLEY_FLOOR_ALT } from "./layers/roadProfile";

export const FIELD_PADDING = 2500;

/** Mean ridge amplitude added on top of the base altitude in the far field, metres. */
const RIDGE_BASE = 190;
const RIDGE_SCALE = 0.65;

export interface TerrainColor {
  r: number;
  g: number;
  b: number;
}

export interface HeightField {
  heightAt(x: number, z: number): number;
  classifyAt(x: number, z: number): TerrainColor;
  distToRoute(x: number, z: number): number;
  bounds: FieldBounds;
  index: RoadIndex;
}

export function createHeightField(spline: TrackSpline): HeightField {
  const index = buildRoadIndex(spline, 1);
  const base = buildBaseAltitude(spline, FIELD_PADDING);

  const distToRoute = (x: number, z: number): number => index.nearest(x, z).dist;

  const heightAt = (x: number, z: number): number => {
    // Constant closure (see module doc): ridgeWeightAt is 0 everywhere carveAt can see
    // (nearestDist <= CARVE_RADIUS = 90 < RIDGE_START = 180), so this reduces to
    // base.sample(x, z), satisfying carveAt's landAt contract exactly. One spatial query
    // total, performed inside carveAt.
    const r = carveAt(x, z, index, () => base.sample(x, z));

    if (r.nearestDist === Infinity) {
      // Beyond CARVE_RADIUS: no road tier is near enough to carve anything, so the ridge
      // relief — omitted from the closure above by construction — belongs here instead.
      // Continuity at the seam (nearestDist == CARVE_RADIUS == 90): the branch above
      // returns base.sample(x, z) (ridge weight 0 at d=90, since 90 < RIDGE_START=180);
      // this branch returns base.sample(x, z) + ridgeWeightAt(90) * (...), and
      // ridgeWeightAt(90) === 0 too — both sides equal base.sample(x, z) exactly.
      const d = index.nearest(x, z).dist;
      return base.sample(x, z) + ridgeWeightAt(d) * (RIDGE_BASE + ridgeReliefAt(x, z) * RIDGE_SCALE);
    }

    return r.height;
  };

  return {
    bounds: base.bounds,
    index,
    distToRoute,
    heightAt,

    classifyAt(x, z) {
      const near = index.nearest(x, z);
      const y = heightAt(x, z);
      const rel = y - near.sample.y;
      const alt = near.sample.altitude;

      if (rel < -8 && near.dist > near.sample.halfWidth + 80) {
        // Valley floor: pale limestone river gravel
        return { r: 0.80, g: 0.81, b: 0.78 };
      }
      if (rel < -2.5) {
        // Face of the drop: shaded rock and scree
        const f = Math.min(1, -rel / 75);
        return { r: 0.34 - f * 0.08, g: 0.35 - f * 0.05, b: 0.28 - f * 0.05 };
      }
      if (rel > 4.5 && near.dist < 200) {
        // Sandstone/limestone cut on the mountain side
        const cutT = Math.min(1, (rel - 4.5) / 12);
        return { r: 0.48 + cutT * 0.08, g: 0.44 + cutT * 0.06, b: 0.38 + cutT * 0.05 };
      }

      // Smooth continuous vegetation gradient with altitude, using the SURFACE's own
      // altitude in the far field so distant peaks go rocky rather than staying green.
      const effAlt = near.dist < 200 ? alt : Math.max(alt, y);
      const altT1 = Math.max(0, Math.min(1, (effAlt - 600) / 400));
      const altT2 = Math.max(0, Math.min(1, (effAlt - 1000) / 450));

      const lowR = 0.26, lowG = 0.42, lowB = 0.18;
      const midR = 0.36, midG = 0.47, midB = 0.24;
      const highR = 0.54, highG = 0.54, highB = 0.42;

      let r = lowR + (midR - lowR) * altT1;
      let g = lowG + (midG - lowG) * altT1;
      let b = lowB + (midB - lowB) * altT1;

      r += (highR - r) * altT2;
      g += (highG - g) * altT2;
      b += (highB - b) * altT2;

      // Keep the valley floor's own band honest at very low elevations.
      if (y < VALLEY_FLOOR_ALT + 5) {
        r = Math.min(1, r + 0.10);
        g = Math.min(1, g + 0.08);
        b = Math.min(1, b + 0.10);
      }

      return { r, g, b };
    },
  };
}
