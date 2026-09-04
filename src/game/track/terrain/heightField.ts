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
 * HOW heightAt COMBINES THE LAYERS:
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
import { buildRoadIndex, hit, RoadHit, RoadIndex, FieldBounds } from "./roadIndex";
import { buildBaseAltitude } from "./layers/baseAltitude";
import { ridgeReliefAt, ridgeWeightAt } from "./layers/ridgeLayer";
import { CARVE_RADIUS, carveFromHits } from "./layers/roadCarveLayer";
import { VALLEY_FLOOR_ALT } from "./layers/roadProfile";
import { valleyLandAt } from "./layers/valleyLayer";

/** Step used by the slope probe's forward finite difference, metres. See `sampleAt`. */
const SLOPE_STEP = 4;

export const FIELD_PADDING = 2500;

/** Mean ridge amplitude added on top of the base altitude in the far field, metres. */
// 260 m, not 190. With the ridged folds alone the far field topped out at 1112 m, low
// enough that the peaks stayed green whatever the colour band did: bare
// rock does not start until well above that on hills of this size, so the massif has to
// stand higher before any colour rule can honestly call it rock. The ramp is spread over
// 800 m rather than 620 (ridgeLayer.ts) to absorb the extra height, so the slope out of
// the valley is unchanged and this does not become a crater rim around the road.
const RIDGE_BASE = 260;
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
   * Un-coloured ground height at an arbitrary point, given the CARVE_RADIUS-filtered hit
   * list for THAT point (`hits`) and a caller-supplied `nearDist` instead of a fresh
   * `index.nearest` call. Parameterising on both lets the slope probe below reuse a
   * single shared candidate fetch across the centre point and its offset probes (see
   * `sampleAt`) instead of paying a full spatial query per point: `near.dist` barely
   * changes over a few-metre step, and `valleyLandAt`'s only use of distToRoute is a
   * smoothstep ramp over VALLEY_SPAN = 900 m, so reusing the centre point's `nearDist`
   * for a probe a few metres away is well within its own continuity tolerance.
   */
  const heightFromHits = (x: number, z: number, hits: RoadHit[], nearDist: number): number => {
    const r = carveFromHits(hits, () => valleyLandAt(base.sample(x, z), base.floor(x, z), nearDist));
    if (r.nearestDist === Infinity) {
      return (
        valleyLandAt(base.sample(x, z), base.floor(x, z), nearDist) +
        ridgeWeightAt(nearDist) * (RIDGE_BASE + ridgeReliefAt(x, z) * RIDGE_SCALE)
      );
    }
    return r.height;
  };

  /**
   * Re-projects an already-fetched hit list onto a nearby point, by recomputing each
   * hit's `sample`'s `dist`/`lat` against the NEW (x, z) instead of running a fresh
   * `index.query`. Used only for the slope probe's offset points (see `sampleAt`): the
   * expensive part of `index.query` is the grid-bucket walk that finds which road
   * samples are even in the neighbourhood, not the `hit()` distance calc on each one —
   * and a point 4 m away from a centre that already ran that walk has essentially the
   * same neighbourhood. `carveFromHits`'s own falloff already clamps to 0 for any hit
   * whose recomputed `dist` has drifted past CARVE_RADIUS (`t < 0 -> c = 0`), so no
   * re-filtering is needed here — a slightly stale candidate set just contributes
   * nothing once it's actually out of range, exactly as a fresh query's absence of that
   * candidate would. The only inexactness this trades away is candidates that would have
   * newly ENTERED CARVE_RADIUS at the offset point but weren't within it at the centre —
   * a boundary case affecting only the auxiliary slope estimate (never the displayed
   * height/colour at the offset point itself, which nothing here computes), and one the
   * wide rock-band smoothstep (colorFor above) doesn't need precise.
   */
  const reproject = (x: number, z: number, hits: RoadHit[]): RoadHit[] => {
    const out: RoadHit[] = new Array(hits.length);
    for (let i = 0; i < hits.length; i++) out[i] = hit(hits[i].sample, x, z);
    return out;
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
    slope: number,
    worldX: number,
    worldZ: number
  ): TerrainColor => {
    const rel = y - near.sample.y;

    // --- Base layer: smooth continuous vegetation gradient with the SURFACE's own
    // altitude (not the road's), so distant peaks and valleys read by what they actually
    // are, not by proximity to a road sample.
    const altT1 = smoothstep(600, 1000, y);
    // The bare-rock band. Two things decide it, and it needs both.
    //
    // ALTITUDE, 720-1000 m. The old 1000-1450 was aspirational: measured over the actual
    // terrain mesh, the skyline tops out at 1099 m on Borbera and 1143 m on Salita, so the
    // band's upper half was dead and its lower half caught a handful of summit vertices —
    // which is why the peaks stayed green however the relief was shaped.
    //
    // DISTANCE TO THE ROUTE, 500-1000 m. Lowering the altitude band far enough to actually
    // colour the skyline brings it to within 85 m of the top of Salita's road, which would
    // start turning the ground beside the driver grey on a 735 m pass — where in reality
    // there is forest and pasture, not rock. The gate confines the band to the far field,
    // which is precisely what it is for: the bare tops are what you see across the valley,
    // not what you drive past. It is a function of the point's own distance to the route,
    // so a given patch of ground keeps one colour however the car moves.
    const altT2 = smoothstep(720, 1000, y) * smoothstep(500, 1000, near.dist);

    const lowR = 0.26, lowG = 0.42, lowB = 0.18;
    const midR = 0.36, midG = 0.47, midB = 0.24;
    // High ground is ROCK, not pale grass. The old tone was a khaki that read as dry
    // pasture, which was harmless while nothing ever reached the altitude it applied at —
    // the far field topped out around 1030 m against a band that started at 1000. It is
    // now the colour of the skyline itself, so it is the grey of Apennine limestone.
    const highR = 0.53, highG = 0.52, highB = 0.50;

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

    // --- Macro variation ---------------------------------------------------------------
    // Every band above is a single flat tone spread over hundreds of metres, which is what
    // makes the ground read as painted cardboard however much relief it has: real hillsides
    // are patchy with grass, scrub, bare earth and shadowed hollows. Two overlapping
    // low-frequency waves (roughly 60 m and 23 m) shift the tone by a few percent, biased
    // green-to-brown rather than just light-to-dark so it reads as varied ground cover
    // rather than uneven lighting. Deterministic in world position, so it is stable across
    // rebuilds and identical on every client.
    const patch =
      Math.sin(worldX * 0.0165 + worldZ * 0.0091) * 0.5 +
      Math.sin(worldX * 0.0427 - worldZ * 0.0338 + 2.1) * 0.3;
    const tint = patch * 0.055;
    r += tint * 1.15;
    g += tint * 0.85;
    b += tint * 0.5;

    // --- Bedding planes on steep faces ---------------------------------------------------
    //
    // The terrain's UVs are a planar (x, z) projection — `uvs.push(x * 0.5, z * 0.5)` in
    // TerrainMeshBuilder. That is right for ground you look down on and collapses on ground
    // you look ACROSS: every vertex of a near-vertical face gets almost the same UV, so the
    // albedo texture smears into a single flat wash. A 16 m cut beside the road, which is
    // what a switchback stacked above another leg looks like from the car, renders as a
    // blank pale plane filling the screen. That is the "the textures are flat cardboard"
    // report, and no amount of retuning the texture fixes it: the coordinates carry no
    // detail there to begin with.
    //
    // The macro variation above cannot help either. Its two waves are keyed on x and z with
    // wavelengths of 150-380 m, and on a vertical face neither coordinate moves far enough
    // to matter. ALTITUDE does move there, and at a short wavelength, so a term keyed on y
    // is exactly the missing axis — weighted by local slope so it appears as strata on a cut
    // face and not as contour banding across a meadow.
    const strata = Math.sin(y * 0.42 + worldX * 0.05 + worldZ * 0.031) * 0.5 + 0.5;
    const strataWeight = smoothstep(0.55, 1.30, slope) * 0.16;
    const strataTint = (strata - 0.5) * strataWeight;
    r += strataTint * 1.0;
    g += strataTint * 0.9;
    b += strataTint * 0.72;

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

    // The one real spatial query per point, exactly as before this fix: `index.query`
    // does the expensive grid-bucket walk once, for the centre point. The slope probe's
    // two offset points below reuse THESE hits via `reproject` instead of each running
    // their own `index.query` — see `reproject`'s doc for why that is a safe, cheap
    // substitute for a fresh query a few metres away.
    const centreHits = index.query(x, z, CARVE_RADIUS);

    // Constant closure (see module doc above): ignores the `nearestDist` argument carveAt
    // passes in entirely, so it is trivially constant in that argument regardless of what
    // valleyLandAt computes — satisfying carveAt's landAt contract by construction. This is
    // what gives the road's drop somewhere to drop TO: base.floor(x, z) is already below
    // base.sample(x, z) wherever the surrounding route is exposed, so carveAt's fade
    // settles onto an actual valley floor instead of climbing back to bare road-altitude
    // land. Both base.sample and base.floor are continuous bilinear grid reads and near.dist
    // is continuous everywhere (distance-to-a-point-set is 1-Lipschitz), so this closure has
    // no discrete lookup left in it anywhere.
    const r = carveFromHits(
      centreHits,
      () => valleyLandAt(base.sample(x, z), base.floor(x, z), near.dist)
    );

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

    // Local slope (gradient magnitude, m/m) by FORWARD finite difference over SLOPE_STEP
    // in both world axes, against the already-known centre height. This used to be a
    // central difference (x±2, z±2, four extra spatial queries); it is now forward-only
    // (x+SLOPE_STEP, z+SLOPE_STEP against `height`, two `heightFromHits` calls, each
    // reusing `centreHits` via `reproject` instead of running its own `index.query` — see
    // `reproject`'s doc). The step is 4 m rather than the old 2 m half-step so the
    // one-sided estimate keeps roughly the same baseline length a central estimate had (a
    // forward difference at the old 2 m step would be noisier over locally-varying terrain
    // like the carved road edge). The rock/scree band only consumes this through a wide
    // smoothstep (0.8..1.5 m/m, colorFor above), so the truncation-error difference
    // between a central and a forward estimate at this step does not show up as a visible
    // change in the band — it only needs to distinguish "steep" from "shallow", not
    // measure slope precisely.
    const hx1 = heightFromHits(x + SLOPE_STEP, z, reproject(x + SLOPE_STEP, z, centreHits), near.dist);
    const hz1 = heightFromHits(x, z + SLOPE_STEP, reproject(x, z + SLOPE_STEP, centreHits), near.dist);
    const dhdx = (hx1 - height) / SLOPE_STEP;
    const dhdz = (hz1 - height) / SLOPE_STEP;
    const slope = Math.sqrt(dhdx * dhdx + dhdz * dhdz);

    return { height, color: colorFor(near, height, slope, x, z) };
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
