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
 * the closure reduces to plain `base.sample(x, z)`, which is trivially constant. The ridge
 * term is therefore left out of the closure entirely — no approximation needed.
 *
 * What the closure DOES include is the valley layer (valleyLayer.ts): `landAt` is
 * `() => valleyLandAt(base.sample(x, z), base.floor(x, z), near.dist)`, where
 * `near = index.nearest(x, z)` is computed once, up front, and captured by the closure —
 * it does not vary with the `nearestDist` argument carveAt itself passes in, so it is
 * constant in that argument trivially, by construction, regardless of what valleyLandAt
 * computes. (`near.dist` is a genuinely different distance from carveAt's own internal
 * `nearestDist` — the winning sample under `index.nearest` need not be the same one that
 * ends up nearest among carveAt's CARVE_RADIUS-limited hits — but the contract only
 * requires the closure be insensitive to the argument it is called with, which this is.)
 * `base.floor(x, z)` is a second IDW grid baked in `baseAltitude.ts` alongside the altitude
 * grid — the blend of every route sample's own valley floor — read back bilinearly, so
 * it is continuous the same way `base.sample` already is. (An earlier version of
 * `valleyLandAt` took a `RoadHit` and read `dropDepth`/`exposure` off the single nearest
 * road sample instead; that "nearest sample" pick is not continuous far from the road on a
 * switchback stage — see valleyLayer.ts's module doc for the measured ~40 m/m discontinuity
 * that forced the redesign to two grids.) This is why the drop profile no longer gets faded
 * back up to bare road-altitude land: on the exposed side, `base.floor(x, z)` sits below
 * `base.sample(x, z)`, so the floor the fade settles onto is an actual valley floor rather
 * than the ribbon's own altitude.
 *
 * That means the ridge relief never reaches the player through `carveAt` at all — it is
 * only added explicitly in the `nearestDist === Infinity` branch below, i.e. strictly
 * beyond CARVE_RADIUS. The seam at exactly `nearestDist == CARVE_RADIUS` is continuous by
 * construction: approaching from inside, carveAt's closure returns
 * `valleyLandAt(base.sample(x, z), base.floor(x, z), near.dist)`; approaching from outside,
 * the far-field branch must add the ridge relief on top of that SAME valley-adjusted land,
 * i.e. `valleyLandAt(...) + ridgeWeightAt(near.dist) * (...)`, and `ridgeWeightAt(90) === 0`
 * since 90 < RIDGE_START=180, so that term vanishes there too — both sides equal
 * `valleyLandAt(base.sample(x, z), base.floor(x, z), near.dist)`, exactly, with no gap.
 * Adding the ridge term to raw `base.sample(x, z)` instead (as the pre-valley-layer version
 * of this file did) would reintroduce a seam wherever the valley adjustment is nonzero at
 * `nearestDist == CARVE_RADIUS` (any point within VALLEY_SPAN = 900 m of the road, i.e.
 * everywhere carveAt can ever see).
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

import { TrackSpline } from "../TrackSpline";
import { buildRoadIndex, RoadIndex, FieldBounds } from "./roadIndex";
import { buildBaseAltitude } from "./layers/baseAltitude";
import { ridgeReliefAt, ridgeWeightAt } from "./layers/ridgeLayer";
import { carveAt } from "./layers/roadCarveLayer";
import { VALLEY_FLOOR_ALT } from "./layers/roadProfile";
import { valleyLandAt } from "./layers/valleyLayer";

export const FIELD_PADDING = 2500;

/** Mean ridge amplitude added on top of the base altitude in the far field, metres. */
const RIDGE_BASE = 190;
const RIDGE_SCALE = 0.65;

export interface TerrainColor {
  r: number;
  g: number;
  b: number;
}

export interface TerrainSample {
  height: number;
  color: TerrainColor;
}

export interface HeightField {
  heightAt(x: number, z: number): number;
  classifyAt(x: number, z: number): TerrainColor;
  /**
   * Height and colour for one point, sharing the single spatial query between them. The
   * mesh builder needs both at every vertex (Task 7 samples this field at every vertex of
   * a graded quadtree over the whole play area — the hot path); calling heightAt and
   * classifyAt separately for the same point costs two to three redundant spatial
   * queries (see the review finding that added this method, and the comment in
   * createHeightField below for the exact accounting).
   */
  sampleAt(x: number, z: number): TerrainSample;
  distToRoute(x: number, z: number): number;
  bounds: FieldBounds;
  index: RoadIndex;
}

export function createHeightField(spline: TrackSpline): HeightField {
  const index = buildRoadIndex(spline, 1);
  const base = buildBaseAltitude(spline, FIELD_PADDING);

  const distToRoute = (x: number, z: number): number => index.nearest(x, z).dist;

  /**
   * classifyAt's colour bands are keyed to the WINNING nearest road sample's own fields
   * (`near.sample.y`, `near.sample.halfWidth`, `near.sample.altitude`) and its exact
   * distance — not just carveAt's numeric `nearestDist`. Feeds off the same `near` and
   * `y` sampleAt already has in hand; behaviour is unchanged from the pre-refactor
   * classifyAt, just extracted so sampleAt can share it.
   */
  const colorFor = (near: ReturnType<RoadIndex["nearest"]>, y: number): TerrainColor => {
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
  };

  /**
   * Combined entry point: one carveAt call (one spatial query) plus, always, one
   * index.nearest call — down from what used to be up to three separate queries when a
   * caller needed both the height and the colour of the same point (heightAt's own
   * carveAt query, classifyAt's own index.nearest for `near`, and heightAt's SECOND
   * index.nearest in the far-field branch when classifyAt called heightAt internally).
   *
   * Why `index.nearest` still runs unconditionally rather than only "when the far field
   * genuinely needs one": CarveResult (roadCarveLayer.ts) exposes only the numeric
   * `nearestDist`, not the winning RoadHit object, precisely so carveAt itself stays to
   * one query with no extra allocation on its own hot path. classifyAt's colour bands
   * need that object's fields (`near.sample.y`, `.halfWidth`, `.altitude`, `near.dist`),
   * which cannot be recovered from a bare number — so getting them costs one
   * index.nearest call, exactly the one classifyAt always made on its own before this
   * refactor. What changes is that this ONE lookup now also supplies the far-field
   * branch's ridge-weight distance, instead of that branch making its own second,
   * redundant call — and a caller that only wants sampleAt().height still triggers it,
   * a small, deliberate cost accepted so heightAt/classifyAt can be simple wrappers with
   * IDENTICAL behaviour to before (per the review finding's explicit request).
   */
  const sampleAt = (x: number, z: number): TerrainSample => {
    // `near` computed up front (this was already computed unconditionally below, for
    // classifyAt's colour bands — just reordered so the valley closure can capture it too,
    // with no extra spatial query: still exactly one `index.nearest` plus one `carveAt`
    // query per point, as before).
    const near = index.nearest(x, z);

    // Constant closure (see module doc above): ignores the `nearestDist` argument carveAt
    // passes in entirely, so it is trivially constant in that argument regardless of what
    // valleyLandAt computes — satisfying carveAt's landAt contract by construction. This is
    // what gives the road's drop somewhere to drop TO: base.floor(x, z) is already below
    // base.sample(x, z) wherever the surrounding route is exposed, so carveAt's fade
    // settles onto an actual valley floor instead of climbing back to bare road-altitude
    // land. Both base.sample and base.floor are continuous bilinear grid reads and near.dist
    // is continuous everywhere (distance-to-a-point-set is 1-Lipschitz), so this closure has
    // no discrete lookup left in it anywhere.
    const r = carveAt(x, z, index, () => valleyLandAt(base.sample(x, z), base.floor(x, z), near.dist));

    let height: number;
    if (r.nearestDist === Infinity) {
      // Beyond CARVE_RADIUS: no road tier is near enough to carve anything, so the ridge
      // relief — omitted from the closure above by construction — belongs here instead,
      // added on top of the SAME valley-adjusted land the closure above would have
      // produced (not raw base.sample), so the seam at nearestDist == CARVE_RADIUS stays
      // continuous even where the valley adjustment is nonzero. `near.dist` (fetched above,
      // not a second lookup) is exactly the distance this branch needs. Continuity at the
      // seam (nearestDist == CARVE_RADIUS == 90): the branch above returns
      // valleyLandAt(base.sample(x, z), base.floor(x, z), near.dist) (ridge weight 0 at
      // d=90, since 90 < RIDGE_START=180); this branch returns
      // valleyLandAt(...) + ridgeWeightAt(90) * (...), and ridgeWeightAt(90) === 0 too —
      // both sides equal valleyLandAt(...) exactly.
      height =
        valleyLandAt(base.sample(x, z), base.floor(x, z), near.dist) +
        ridgeWeightAt(near.dist) * (RIDGE_BASE + ridgeReliefAt(x, z) * RIDGE_SCALE);
    } else {
      height = r.height;
    }

    return { height, color: colorFor(near, height) };
  };

  return {
    bounds: base.bounds,
    index,
    distToRoute,
    sampleAt,
    heightAt: (x, z) => sampleAt(x, z).height,
    classifyAt: (x, z) => sampleAt(x, z).color,
  };
}
