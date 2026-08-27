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
   * Un-coloured ground height at an arbitrary point, reusing a caller-supplied
   * `nearDist` instead of doing a fresh `index.nearest` call. This exists ONLY so the
   * slope probe below (4 extra evaluations, offset by a couple of metres from the real
   * point) can share the query budget with the main sample instead of quadrupling the
   * spatial-query count: `near.dist` barely changes over a 2 m step, and `valleyLandAt`'s
   * only use of distToRoute is a smoothstep ramp over VALLEY_SPAN = 900 m, so reusing the
   * centre point's `nearDist` for a probe 2 m away is well within its own continuity
   * tolerance. This mirrors sampleAt's own height logic exactly, parameterised on
   * `nearDist` instead of recomputing it.
   */
  const heightRaw = (x: number, z: number, nearDist: number): number => {
    const r = carveAt(x, z, index, () => valleyLandAt(base.sample(x, z), base.floor(x, z), nearDist));
    if (r.nearestDist === Infinity) {
      return (
        valleyLandAt(base.sample(x, z), base.floor(x, z), nearDist) +
        ridgeWeightAt(nearDist) * (RIDGE_BASE + ridgeReliefAt(x, z) * RIDGE_SCALE)
      );
    }
    return r.height;
  };

  /**
   * Local slope (gradient magnitude, m/m) at (x, z), by central finite difference over a
   * 2 m half-step in both world axes. Four extra height evaluations via `heightRaw`
   * (which reuses `nearDist` rather than re-querying `index.nearest` — see its doc) — no
   * additional `index.nearest` calls beyond the one `sampleAt` already makes per point.
   */
  const slopeAt = (x: number, z: number, nearDist: number): number => {
    const e = 2;
    const hx1 = heightRaw(x + e, z, nearDist);
    const hx2 = heightRaw(x - e, z, nearDist);
    const hz1 = heightRaw(x, z + e, nearDist);
    const hz2 = heightRaw(x, z - e, nearDist);
    const dhdx = (hx1 - hx2) / (2 * e);
    const dhdz = (hz1 - hz2) / (2 * e);
    return Math.sqrt(dhdx * dhdx + dhdz * dhdz);
  };

  function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * classifyAt's colour bands. Re-keyed off ABSOLUTE ALTITUDE and LOCAL SLOPE rather than
   * height-relative-to-road (see module history / the bug this replaced): once the valley
   * layer let terrain drop hundreds of metres away from the route, "rel < -8 far from the
   * road" matched almost the entire landscape and painted it pale limestone. Only the
   * near-road CUT band is still legitimately road-relative — it depicts the cut face beside
   * the road itself, which by definition only exists near the road. Every band blends in
   * smoothly (smoothstep-weighted lerps) rather than switching on a hard `if`, so no band
   * boundary shows as a visible seam across the terrain.
   */
  const colorFor = (
    near: ReturnType<RoadIndex["nearest"]>,
    y: number,
    slope: number
  ): TerrainColor => {
    const rel = y - near.sample.y;

    // --- Base layer: smooth continuous vegetation gradient with the SURFACE's own
    // altitude (not the road's), so distant peaks and valleys read by what they actually
    // are, not by proximity to a road sample.
    const altT1 = smoothstep(600, 1000, y);
    const altT2 = smoothstep(1000, 1450, y);

    const lowR = 0.26, lowG = 0.42, lowB = 0.18;
    const midR = 0.36, midG = 0.47, midB = 0.24;
    const highR = 0.54, highG = 0.54, highB = 0.42;

    let r = lerp(lowR, midR, altT1);
    let g = lerp(lowG, midG, altT1);
    let b = lerp(lowB, midB, altT1);

    r = lerp(r, highR, altT2);
    g = lerp(g, highG, altT2);
    b = lerp(b, highB, altT2);

    // --- Cut band: sandstone/limestone cut face on the mountain side of the road. Still
    // road-relative by design (the feature it depicts only exists next to the road), gated
    // both on how far above the road surface the point sits and on distance to the road,
    // both blended in over a range rather than switched at a hard threshold.
    const cutRise = smoothstep(2.5, 7.0, rel);
    const cutNear = 1 - smoothstep(160, 200, near.dist);
    const cutWeight = cutRise * cutNear;
    const cutT = smoothstep(4.5, 16.5, rel);
    const cutR = 0.48 + cutT * 0.08, cutG = 0.44 + cutT * 0.06, cutB = 0.38 + cutT * 0.05;
    r = lerp(r, cutR, cutWeight);
    g = lerp(g, cutG, cutWeight);
    b = lerp(b, cutB, cutWeight);

    // --- Rock/scree band: keyed on LOCAL SLOPE, not altitude or road-relative height.
    // Steep ground is bare rock wherever it occurs — a cliff beside the valley floor is as
    // rocky as one near the summit. Blended over a range around ~1.2 m/m so there is no
    // visible edge where the ground crosses the threshold.
    const rockWeight = smoothstep(0.8, 1.5, slope);
    const rf = Math.min(1, rockWeight);
    const rockR = 0.34 - rf * 0.08, rockG = 0.35 - rf * 0.05, rockB = 0.28 - rf * 0.05;
    r = lerp(r, rockR, rockWeight);
    g = lerp(g, rockG, rockWeight);
    b = lerp(b, rockB, rockWeight);

    // --- Valley floor band: pale limestone river gravel, keyed on ABSOLUTE ALTITUDE —
    // only within roughly 60 m above VALLEY_FLOOR_ALT, i.e. genuinely near the Borbera
    // riverbed, not "anywhere lower than the road". Suppressed on steep faces (rockWeight)
    // since a cliff down to the valley floor is rock, not flat gravel.
    const floorWeight = (1 - smoothstep(VALLEY_FLOOR_ALT, VALLEY_FLOOR_ALT + 60, y)) * (1 - rockWeight);
    const floorR = 0.80, floorG = 0.81, floorB = 0.78;
    r = lerp(r, floorR, floorWeight);
    g = lerp(g, floorG, floorWeight);
    b = lerp(b, floorB, floorWeight);

    return {
      r: Math.max(0, Math.min(1, r)),
      g: Math.max(0, Math.min(1, g)),
      b: Math.max(0, Math.min(1, b)),
    };
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

    const slope = slopeAt(x, z, near.dist);
    return { height, color: colorFor(near, height, slope) };
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
