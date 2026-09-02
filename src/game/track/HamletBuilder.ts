/**
 * VAL BORBERA HILLCLIMB — Apennine Hamlet Builder
 *
 * A borgata of the upper Val Borbera, not a row of houses lining the carriageway.
 *
 * WHAT THIS REPLACES, AND WHY. The previous version lived inline in
 * RoadsideFurnitureBuilder and drew four dwellings per hamlet: one pair either side of the
 * road, each pair staggered along it. Three separate faults made that read as "two types of
 * house standing right next to each other":
 *
 *   1. The trigger fired on every marked sample, and `village()` marks TWO consecutive
 *      samples about two metres apart. Both were visited, so every hamlet was built twice,
 *      two metres offset — and because the seed was `floor(s.s / 7)`, both builds landed in
 *      the same 7 m bucket and produced the SAME houses. Half of every village was a
 *      duplicate of the other half, interpenetrating it.
 *   2. The per-house seed was `floor(s.s/7)*31 + (h > 0 ? 17 : 5) + along*47`, and the
 *      variant was `seed % 5`. The four offsets are 5, 17, 52, 64; modulo 5 those are
 *      0, 2, 2, 4 — so two of the four dwellings ALWAYS shared a variant. Modulo 6 (the wall
 *      colour) they are 5, 5, 4, 4: two identical pairs. The arithmetic guaranteed the
 *      repetition the eye was picking out.
 *   3. Every dwelling stood between 4.8 m and 10.2 m from the centreline. Real hamlets are
 *      not built along the shoulder of a road; the road passes them.
 *
 * WHAT A REAL ONE LOOKS LIKE. The borgate above Cabella — Cosola, Capanne, Vegni, Casoni —
 * are knots of tall, narrow stone houses packed onto a shelf or a spur, two to four storeys,
 * stuccoed in ochre and cream, roofed in local slate as often as in terracotta. They sit
 * back from the provincial road, which was cut later and usually passes below or beside
 * them; a house or two stands at the roadside, and the rest are behind, gathered around a
 * lane at their own angle rather than square to the traffic. Between them are low barns,
 * open-sided haysheds and the odd chapel with a bell gable. Nothing is aligned to anything.
 *
 * So: a cluster centred well off the road, buildings placed by rejection sampling with a
 * minimum separation, each on ground flat enough to build on, each oriented to a shared
 * village axis with its own jitter, drawn from six building types with independent random
 * streams.
 *
 * Determinism: every random draw comes from a mulberry32 stream seeded on the hamlet's own
 * arc length, so a stage looks identical on every client and across rebuilds. This is
 * geometry only — it never touches the simulation — so it does not participate in
 * SIM_VERSION.
 */

import * as THREE from "three";
import { SplineSample } from "./TrackSpline";

/** mulberry32 — small, fast, well-distributed. Successive seeds decorrelate, which the
 *  previous `seed % 5` arithmetic did not. */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a building stands and how much room it takes, so other scatter can avoid it. */
export interface BuildingFootprint {
  x: number;
  z: number;
  /** Radius that comfortably contains the building, metres. */
  r: number;
}

type Kind = "casa" | "casaLarga" | "torre" | "stalla" | "rustico" | "cappella";

/** Wall stucco. Cream and ochre, the colours lime render goes in this valley. */
const WALL_COLORS = ["#e6dac6", "#dcc19b", "#c9a184", "#efe0c4", "#d3b48f", "#c8b79b"];
/** Slate first: at 700-900 m it is the more common roof, and its grey is what stops a
 *  village reading as a uniform orange. */
const ROOF_COLORS = ["#4b5563", "#59616d", "#6b7280", "#b45309", "#9a4a12"];
const SHUTTER_COLORS = ["#14532d", "#1e3a8a", "#451a03", "#166534", "#3f2d1c"];
const STONE = "#6f695f";

/**
 * A gabled roof: a triangular prism with the ridge running along local +z.
 *
 * Every building used to wear the same four-sided cone, which is most of why a village read
 * as one house repeated. Winding is counter-clockwise seen from outside on every face, so
 * the default FrontSide material shows all of it.
 */
function gableRoofGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const pos = new Float32Array([
    -hw, 0, -hd,   hw, 0, -hd,   hw, 0, hd,   -hw, 0, hd,
    0, h, -hd,     0, h, hd,
  ]);
  const idx = [
    0, 4, 1, // front gable
    3, 2, 5, // back gable
    0, 3, 5, 0, 5, 4, // left pitch
    1, 4, 5, 1, 5, 2, // right pitch
    0, 1, 2, 0, 2, 3, // soffit
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

interface Dims {
  w: number;
  d: number;
  storeys: number;
  h: number;
  hipped: boolean;
  pitch: number;
}

function dimensionsFor(kind: Kind, rnd: () => number): Dims {
  const between = (a: number, b: number) => a + rnd() * (b - a);
  switch (kind) {
    case "torre": {
      // Four storeys exist but are the exception; at 2.75 m a floor the tallest comes out
      // around 11 m, which is a tall stone house rather than an apartment block.
      const storeys = rnd() < 0.35 ? 4 : 3;
      return { w: between(4.2, 5.0), d: between(4.2, 5.2), storeys, h: storeys * 2.75 + 0.4, hipped: false, pitch: between(1.5, 2.0) };
    }
    case "casaLarga": {
      return { w: between(7.4, 9.4), d: between(5.8, 7.0), storeys: 2, h: 2 * 2.9 + 0.5, hipped: rnd() < 0.45, pitch: between(1.8, 2.4) };
    }
    case "stalla": {
      return { w: between(7.0, 9.0), d: between(4.8, 6.2), storeys: 1, h: between(3.4, 4.2), hipped: false, pitch: between(1.1, 1.5) };
    }
    case "rustico": {
      return { w: between(3.2, 4.4), d: between(3.0, 3.9), storeys: 1, h: between(2.5, 3.1), hipped: false, pitch: between(0.9, 1.3) };
    }
    case "cappella": {
      return { w: between(4.0, 4.8), d: between(6.5, 8.0), storeys: 1, h: between(4.6, 5.4), hipped: false, pitch: between(1.4, 1.8) };
    }
    default: {
      const storeys = 2 + Math.floor(rnd() * 2);
      return { w: between(5.0, 6.6), d: between(4.8, 6.2), storeys, h: storeys * 2.9 + 0.4, hipped: rnd() < 0.3, pitch: between(1.7, 2.3) };
    }
  }
}

function makeBuilding(kind: Kind, rnd: () => number, wallColor: string, roofColor: string): THREE.Group {
  const g = new THREE.Group();
  const dim = dimensionsFor(kind, rnd);
  const pickFrom = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];

  const shutterColor = pickFrom(SHUTTER_COLORS);

  // Rough stone plinth. Wider than the walls and sunk into the slope, so the building beds
  // into the hillside instead of perching on it — which is how they are actually built here,
  // the downhill side of the plinth doing the work of a retaining wall.
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(dim.w + 0.5, 1.8, dim.d + 0.5),
    new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.96, flatShading: true })
  );
  plinth.position.y = -0.55;
  plinth.castShadow = true;
  plinth.receiveShadow = true;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(dim.w, dim.h, dim.d),
    new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 })
  );
  body.position.y = dim.h / 2 + 0.3;
  body.castShadow = true;
  body.receiveShadow = true;

  const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85, flatShading: true });
  let roof: THREE.Mesh;
  if (dim.hipped) {
    roof = new THREE.Mesh(new THREE.ConeGeometry((dim.w / 2) * 1.42, dim.pitch, 4), roofMat);
    roof.position.y = dim.h + 0.3 + dim.pitch / 2;
    roof.rotation.y = Math.PI / 4;
  } else {
    // Ridge along the depth axis, eaves overhanging a little on both sides.
    roof = new THREE.Mesh(gableRoofGeometry(dim.w + 0.7, dim.d + 0.5, dim.pitch), roofMat);
    roof.position.y = dim.h + 0.3;
  }
  roof.castShadow = true;

  g.add(plinth, body, roof);

  // --- Openings ---------------------------------------------------------------------
  // Windows on the entrance facade only. A barn gets none, a chapel gets one tall one.
  const faceZ = -(dim.d / 2 + 0.05);
  if (kind === "cappella") {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.5, 0.06),
      new THREE.MeshStandardMaterial({ color: "#2b2f36", roughness: 0.35 })
    );
    win.position.set(0, dim.h - 1.3, faceZ);
    // Bell gable: a slab above the ridge with the opening cut as a dark inset.
    const gable = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.7, 0.35),
      new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 })
    );
    gable.position.set(0, dim.h + dim.pitch + 0.5, faceZ + 0.3);
    gable.castShadow = true;
    const bell = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.7, 0.12),
      new THREE.MeshStandardMaterial({ color: "#2b2f36", roughness: 0.4 })
    );
    bell.position.set(0, dim.h + dim.pitch + 0.6, faceZ + 0.15);
    g.add(win, gable, bell);
  } else if (kind !== "stalla" && kind !== "rustico") {
    const winGeo = new THREE.BoxGeometry(0.72, 1.05, 0.06);
    const winMat = new THREE.MeshStandardMaterial({ color: "#f6f5f1", roughness: 0.35 });
    const shutGeo = new THREE.BoxGeometry(0.36, 1.05, 0.07);
    const shutMat = new THREE.MeshStandardMaterial({ color: shutterColor, roughness: 0.75 });

    const columns = dim.w > 7 ? 3 : 2;
    const spacing = (dim.w - 1.8) / (columns - 1);
    for (let c = 0; c < columns; c++) {
      const wx = -(dim.w - 1.8) / 2 + c * spacing;
      for (let row = 0; row < dim.storeys; row++) {
        const wy = 2.2 + row * 2.9;
        if (wy > dim.h - 0.6) continue;
        // Not every opening is a window; a blank patch of wall is what stops a facade
        // reading as a spreadsheet.
        if (rnd() < 0.15) continue;
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(wx, wy, faceZ);
        const sl = new THREE.Mesh(shutGeo, shutMat);
        sl.position.set(wx - 0.44, wy, faceZ + 0.02);
        const sr = new THREE.Mesh(shutGeo, shutMat);
        sr.position.set(wx + 0.44, wy, faceZ + 0.02);
        g.add(win, sl, sr);
      }
    }
  }

  // Door: a barn's is wide and full height, everything else's is a normal doorway.
  const doorW = kind === "stalla" ? 2.6 : 1.05;
  const doorH = kind === "stalla" ? 3.0 : 2.1;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(doorW, doorH, 0.08),
    new THREE.MeshStandardMaterial({ color: "#46301b", roughness: 0.85 })
  );
  door.position.set(0, doorH / 2 + 0.3, faceZ);
  g.add(door);

  if (kind === "casa" || kind === "casaLarga" || kind === "torre") {
    const chimney = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.5, 0.5),
      new THREE.MeshStandardMaterial({ color: "#8d5b4a", roughness: 0.92 })
    );
    chimney.position.set(dim.w / 2 - 0.9, dim.h + dim.pitch * 0.55, dim.d / 2 - 1.0);
    chimney.castShadow = true;
    g.add(chimney);
  }

  return g;
}

/**
 * Places one hamlet near `anchor`.
 *
 * `groundAt` is what keeps the buildings on the hillside rather than at road height; a
 * dwelling twenty-five metres back can easily be ten metres below the carriageway. When it
 * is absent (tests build RoadMesh without a height field) the hamlet falls back to road
 * height, which is only ever right on flat ground — acceptable for a headless test, not for
 * the game.
 */
export function buildHamlet(
  anchor: SplineSample,
  allSamples: SplineSample[],
  group: THREE.Group,
  groundAt?: (x: number, z: number) => number
): BuildingFootprint[] {
  const rnd = rngFrom(Math.round(anchor.s * 1000) ^ 0x9e3779b9);
  const between = (a: number, b: number) => a + rnd() * (b - a);

  const tanX = -anchor.normalZ;
  const tanZ = anchor.normalX;

  // Build away from the drop. Where the road is exposed on one side the village goes on the
  // other; where it is exposed on both, or on neither, either side will do.
  const dropSide = anchor.exposure === "left" ? -1 : anchor.exposure === "right" ? 1 : 0;
  const side = dropSide !== 0 ? -dropSide : rnd() < 0.5 ? -1 : 1;

  // The village axis: everything is roughly parallel to it, nothing exactly. Deliberately
  // NOT the road's heading — these places predate the road.
  const axis = anchor.heading + between(-0.7, 0.7);

  /** Cluster centre, well back from the carriageway. */
  const centreLat = between(26, 46) * side;
  const centreAlong = between(-12, 26);

  const placed: BuildingFootprint[] = [];

  /**
   * Wall and roof colours are dealt from a SHUFFLED palette rather than drawn independently,
   * so a village of five houses cannot come out in two colours. Drawing with replacement it
   * can and did: the first hamlet on Salita di Cosola used two of the six wall colours
   * across five buildings, which reads as the repetition this rewrite exists to remove.
   * Dealing guarantees every colour is used once before any is used twice.
   */
  const dealer = (palette: readonly string[]): (() => string) => {
    const deck = [...palette];
    // Fisher-Yates on the hamlet's own stream, so the shuffle is deterministic too.
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    let cursor = 0;
    return () => deck[cursor++ % deck.length];
  };
  const nextWall = dealer(WALL_COLORS);
  const nextRoof = dealer(ROOF_COLORS);

  const groundOf = (x: number, z: number) => (groundAt ? groundAt(x, z) : anchor.y);

  /**
   * How close the nearest piece of CARRIAGEWAY is, measured against every sample on the
   * stage rather than against the anchor's own lateral offset.
   *
   * Offsetting from the anchor is not enough on a switchback: a house set fifteen metres
   * back from this leg can land squarely on the leg above or below it, which the clearance
   * test catches as prop vertices standing in the driving lane. Checking the whole spline is
   * a linear scan per candidate, paid once at build time.
   */
  const clearanceToRoad = (x: number, z: number): number => {
    let best = Infinity;
    for (const smp of allSamples) {
      const d = Math.hypot(smp.x - x, smp.z - z) - smp.halfWidth;
      if (d < best) best = d;
    }
    return best;
  };

  /**
   * Ground a building can stand on: not far below or above the road (a hamlet clinging to a
   * cliff face is not a hamlet), and flat enough over its own footprint that it does not
   * hang off a bank. Real ones sit on shelves, which is exactly what this selects for.
   */
  const buildable = (x: number, z: number, radius: number, slopeTol: number): number | null => {
    const y = groundOf(x, z);
    if (!Number.isFinite(y)) return null;
    if (y < anchor.y - 26 * slopeTol || y > anchor.y + 26 * slopeTol) return null;
    let lo = y;
    let hi = y;
    for (const [ox, oz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
      const h = groundOf(x + ox, z + oz);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    // Under about 1:4 across the footprint. Steeper than that and it reads as a house
    // half-buried on one side and stilted on the other.
    if (hi - lo > radius * 0.5 * slopeTol) return null;
    return y;
  };

  const tryPlace = (
    kind: Kind,
    latRange: [number, number],
    alongRange: [number, number],
    attempts: number,
    /** Multiplier on how much slope and height difference from the road is tolerated. See
     *  the top-up pass at the end: a steep, tightly-stacked stage has very little ground
     *  that passes the strict test, and a two-building "hamlet" is worse than a village on
     *  a slightly steeper shelf. */
    slopeTol = 1
  ): boolean => {
    const footprint = kind === "rustico" ? 3.0 : kind === "stalla" || kind === "casaLarga" ? 5.2 : 4.2;
    for (let a = 0; a < attempts; a++) {
      const lat = between(latRange[0], latRange[1]) * side;
      const along = between(alongRange[0], alongRange[1]);
      const x = anchor.x + anchor.normalX * lat + tanX * along;
      const z = anchor.z + anchor.normalZ * lat + tanZ * along;

      let clash = false;
      for (const p of placed) {
        if (Math.hypot(p.x - x, p.z - z) < p.r + footprint + 2.2) {
          clash = true;
          break;
        }
      }
      if (clash) continue;

      // Never on, over or overhanging the carriageway — including a different leg of the
      // same stage passing beneath or above this spot.
      if (clearanceToRoad(x, z) < footprint + 3.0) continue;

      const y = buildable(x, z, footprint, slopeTol);
      if (y === null) continue;

      const b = makeBuilding(kind, rnd, nextWall(), nextRoof());
      // Sunk a little: the plinth's job is to disappear into the slope.
      b.position.set(x, y - 0.5, z);
      b.rotation.y = axis + between(-0.28, 0.28);
      group.add(b);
      placed.push({ x, z, r: footprint });
      return true;
    }
    return false;
  };

  // The knot itself, around the cluster centre.
  const dwellings = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < dwellings; i++) {
    const roll = rnd();
    const kind: Kind = roll < 0.5 ? "casa" : roll < 0.72 ? "casaLarga" : roll < 0.88 ? "torre" : "stalla";
    tryPlace(
      kind,
      [Math.abs(centreLat) - 20, Math.abs(centreLat) + 20],
      [centreAlong - 26, centreAlong + 26],
      24
    );
  }

  // Outbuildings scattered at the edge of the knot.
  const sheds = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < sheds; i++) {
    tryPlace(
      "rustico",
      [Math.abs(centreLat) - 20, Math.abs(centreLat) + 20],
      [centreAlong - 28, centreAlong + 28],
      18
    );
  }

  // A chapel, more often than not — every borgata up here has one.
  if (rnd() < 0.65) {
    tryPlace("cappella", [Math.abs(centreLat) - 10, Math.abs(centreLat) + 14], [centreAlong - 24, centreAlong + 24], 20);
  }

  // And one or two buildings the road actually passes, so the village is not a distant
  // island. These are the only ones close to the carriageway.
  const roadside = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < roadside; i++) {
    tryPlace(rnd() < 0.6 ? "casa" : "stalla", [10, 17], [-30, 34], 22);
  }

  // Top-up. On a steep, tightly-stacked stage almost no ground passes the strict buildable
  // test — Salita di Cosola's first village came out with two buildings — and a village of
  // two is not a village. Relax the slope and height tolerances in steps and search a wider
  // ring, rather than accept a stub. The road-clearance rule is NOT relaxed at any step: a
  // house on the carriageway is a defect, a house on a steeper shelf is a hillside village.
  const MIN_BUILDINGS = 5;
  for (const tol of [1.6, 2.4, 3.4]) {
    if (placed.length >= MIN_BUILDINGS) break;
    for (let i = 0; placed.length < MIN_BUILDINGS && i < 10; i++) {
      const roll = rnd();
      const kind: Kind = roll < 0.55 ? "casa" : roll < 0.78 ? "casaLarga" : roll < 0.9 ? "torre" : "rustico";
      tryPlace(
        kind,
        [Math.abs(centreLat) - 24, Math.abs(centreLat) + 26],
        [centreAlong - 40, centreAlong + 40],
        26,
        tol
      );
    }
  }

  return placed;
}
