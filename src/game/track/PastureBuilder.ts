/**
 * VAL BORBERA HILLCLIMB — Pastures, cascine and cattle
 *
 * The middle distance was empty. Between the hamlets there is hillside, trees and nothing
 * else, and the valley reads as scenery rather than as somewhere people live and work. The
 * Val Borbera is grazing country: the shelves above the road carry cattle, and every few
 * hundred metres there is a cascina — a long low barn with a house against one end, a walled
 * yard, and a fenced pasture running off it.
 *
 * That is what this places. Not on the roadside, where it would compete with the driving:
 * these sit 45 to 130 m out, on ground flat enough to graze, which puts them exactly where
 * the eye goes on a straight or coming out of a corner.
 *
 * SITING IS THE WHOLE JOB. A farm on a 40-degree slope, or standing in the same field as a
 * hamlet, or hanging over the drop on the exposed side, is worse than no farm at all. So a
 * site has to clear four tests before anything is built: far enough from the carriageway
 * that nothing reads as roadside furniture, clear of the hamlet footprints the road builder
 * already placed, on ground within a few metres of level across the whole yard, and on the
 * side away from the drop. Sites that fail are simply skipped — a stage with fewer farms is
 * fine; a farm halfway up a cliff is not.
 *
 * Everything is a plain mesh rather than an InstancedMesh, so `batchStaticGroup` merges it
 * with the rest of the roadside furniture: the colour goes into vertex colours and a whole
 * pasture costs no extra draw calls.
 */

import * as THREE from "three";
import { SplineSample } from "./TrackSpline";
import { BuildingFootprint } from "./HamletBuilder";

/** mulberry32 — same generator as the hamlets, for the same reason. */
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

/**
 * Hides, weighted to the pale.
 *
 * The first version used browns, and against a sunlit green hillside at a hundred metres a
 * brown cow is invisible — captured looking straight at a herd, the whole group came to a
 * couple of dark pixels. The Razza Piemontese, which is what actually grazes this valley, is
 * near-white; it reads at range, and it happens to be the correct animal.
 */
const HIDE_COLORS = ["#e8e2d4", "#ded6c4", "#f0ebe0", "#e8e2d4", "#b9ada0", "#6b5a49"];
const RENDER_COLORS = ["#d9c9ac", "#c9b596", "#e3d6bd"];
const ROOF_COLORS = ["#8c5a2b", "#6b7280", "#9a4a12"];
const STONE = "#7d766a";

function box(w: number, h: number, d: number, color: string, flat = false): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: flat })
  );
}

/**
 * One cow: a body, a head and a single block for the legs.
 *
 * Deliberately about thirty-six triangles. These are 45 m away at the very closest and
 * usually well over a hundred, where a cow is a handful of pixels; anything more detailed
 * is triangles spent below the resolution of the screen. What reads at that distance is the
 * silhouette and the light-on-dark patching of the hide, not the shape of the legs.
 */
function makeCow(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const hide = HIDE_COLORS[Math.floor(rnd() * HIDE_COLORS.length)];

  const body = box(0.75, 0.78, 1.85, hide, true);
  body.position.y = 1.05;
  body.castShadow = true;

  const head = box(0.42, 0.42, 0.5, hide, true);
  head.position.set(0, 1.22, 1.12);

  // One block, not four legs. At this range the gap between them is sub-pixel.
  const legs = box(0.62, 0.7, 1.5, "#2a221c", true);
  legs.position.y = 0.35;

  g.add(body, head, legs);
  // Grazing animals face roughly the same way — into the wind, or up the slope — with
  // enough spread that they do not look placed.
  g.rotation.y = rnd() * Math.PI * 2;
  return g;
}

/** A cascina: a long barn with the house against one end, and a low walled yard. */
function makeFarm(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const render = RENDER_COLORS[Math.floor(rnd() * RENDER_COLORS.length)];
  const roof = ROOF_COLORS[Math.floor(rnd() * ROOF_COLORS.length)];

  const barnW = 13 + rnd() * 5;
  const barn = box(barnW, 4.6, 8.2, render);
  barn.position.y = 2.3;
  barn.castShadow = true;
  barn.receiveShadow = true;

  const barnRoof = box(barnW + 0.9, 0.55, 9.1, roof, true);
  barnRoof.position.y = 4.85;
  barnRoof.castShadow = true;

  const house = box(7.2, 7.0, 7.4, render);
  house.position.set(-barnW / 2 - 3.2, 3.5, 0.4);
  house.castShadow = true;

  const houseRoof = box(8.1, 0.5, 8.3, roof, true);
  houseRoof.position.set(-barnW / 2 - 3.2, 7.25, 0.4);
  houseRoof.castShadow = true;

  const door = box(3.4, 3.4, 0.2, "#3d2b1c");
  door.position.set(0, 1.7, -4.2);

  g.add(barn, barnRoof, house, houseRoof, door);

  // Yard wall: four low runs rather than a fence of posts. A post-and-rail fence at this
  // distance is a hundred triangles of nothing; a wall is a readable line for twelve.
  const yard = 11 + rnd() * 3;
  for (const [dx, dz, w, d] of [
    [0, yard, yard * 2, 0.5],
    [-yard, 0, 0.5, yard * 2],
    [yard, 0, 0.5, yard * 2],
  ] as const) {
    const wall = box(w, 1.1, d, STONE, true);
    wall.position.set(dx, 0.55, dz);
    wall.castShadow = true;
    g.add(wall);
  }

  return g;
}

/**
 * Places farms and grazing cattle along a route.
 *
 * `buildings` are the hamlet footprints the road builder has already placed; sites keep
 * clear of them. Returns the footprints it adds, so the vegetation scatter avoids these too.
 */
export function buildPastures(
  samples: SplineSample[],
  group: THREE.Group,
  groundAt: ((x: number, z: number) => number) | undefined,
  buildings: BuildingFootprint[]
): BuildingFootprint[] {
  if (samples.length < 2 || !groundAt) return [];

  const totalLength = samples[samples.length - 1].s;
  const rnd = rngFrom(Math.round(totalLength * 1000) ^ 0x5bf03635);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const added: BuildingFootprint[] = [];

  /** Roughly every 450 m, so a stage gets a handful rather than a row of them. At 350 m
   *  Borbera Sprint took nine, which is both more farms than 3.7 km of valley wants and
   *  3 k triangles against the 6 k of headroom that stage has under its ceiling. */
  /**
   * Distance from a point to the nearest carriageway edge, measured against EVERY sample.
   *
   * Offsetting from one anchor sample is not the same thing and was wrong for both the farms
   * and the cattle: a road that curves away puts a point sampled at 45 m of lateral offset
   * much closer to a different part of the route. It produced a farmyard wall 11 m from the
   * edge and a cow standing on it, neither of which is visible from a screenshot taken
   * somewhere else on the stage — both were caught by the placement tests.
   */
  const roadClearance = (x: number, z: number): number => {
    let best = Infinity;
    for (const smp of samples) {
      const d = Math.hypot(smp.x - x, smp.z - z) - smp.halfWidth;
      if (d < best) best = d;
    }
    return best;
  };

  const SPACING_M = 450;
  /**
   * Half-extent of a farmyard, and the radius its ground has to be level across.
   *
   * Was 26, which let the yard wall reach 22 m from the farm's centre. Two consequences,
   * both caught by the placement tests rather than by eye: a wall ended up 11 m from the
   * carriageway edge, close enough to read as roadside furniture, and on a site that only
   * had to be level to within 9 m the far corners of the wall came off the ground entirely.
   * A smaller yard sits on flatter ground and keeps its edges where they were sited.
   */
  const YARD_CLEAR = 18;

  for (let s = 220; s < totalLength - 120; s += SPACING_M) {
    // The sample nearest this station.
    let anchor = samples[0];
    let best = Infinity;
    for (const smp of samples) {
      const d = Math.abs(smp.s - s);
      if (d < best) {
        best = d;
        anchor = smp;
      }
    }

    const dropSide = anchor.exposure === "left" ? -1 : anchor.exposure === "right" ? 1 : 0;
    const side = dropSide !== 0 ? -dropSide : rnd() < 0.5 ? -1 : 1;
    const tanX = -anchor.normalZ;
    const tanZ = anchor.normalX;

    let placed = false;
    for (let attempt = 0; attempt < 14 && !placed; attempt++) {
      const lat = between(45, 130) * side;
      const along = between(-70, 70);
      const x = anchor.x + anchor.normalX * lat + tanX * along;
      const z = anchor.z + anchor.normalZ * lat + tanZ * along;

      // Clear of the carriageway by the yard's own extent, not just by its centre. A road
      // that curves away can put a site sampled at 45 m of lateral offset much closer to a
      // different part of the route, and the wall reaches out from there.
      if (roadClearance(x, z) < YARD_CLEAR + 22) continue;

      // Clear of anything already standing here.
      if (buildings.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + YARD_CLEAR)) continue;
      if (added.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + YARD_CLEAR + 30)) continue;

      // Flat enough to be a yard, and not perched. A working farm sits on a shelf.
      const y = groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      let lo = y;
      let hi = y;
      for (const [ox, oz] of [
        [YARD_CLEAR, 0],
        [-YARD_CLEAR, 0],
        [0, YARD_CLEAR],
        [0, -YARD_CLEAR],
        [YARD_CLEAR * 0.7, YARD_CLEAR * 0.7],
        [-YARD_CLEAR * 0.7, -YARD_CLEAR * 0.7],
      ] as const) {
        const h = groundAt(x + ox, z + oz);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      // Five metres across a 36 m yard is about 1:7 — a working farmyard in this valley is
      // rarely flatter than that and never much steeper. Loose enough and the yard wall's
      // far corners leave the ground; the placement test measures exactly that.
      if (hi - lo > 5) continue;

      const farm = makeFarm(rnd);
      farm.position.set(x, y - 0.3, z);
      farm.rotation.y = anchor.heading + between(-0.6, 0.6);
      group.add(farm);
      added.push({ x, z, r: YARD_CLEAR });
      placed = true;

      // The herd grazes the pasture BETWEEN the farm and the road, not scattered around the
      // yard. Sited off the farm alone they ended up as far as 190 m out, where a cow is a
      // couple of pixels and the whole herd may as well not exist; sited off the road they
      // fall in the band the driver actually looks at.
      const herd = 5 + Math.floor(rnd() * 5);
      const herdLat = between(34, 78) * side;
      const herdAlong = along + between(-30, 30);
      const hx = anchor.x + anchor.normalX * herdLat + tanX * herdAlong;
      const hz = anchor.z + anchor.normalZ * herdLat + tanZ * herdAlong;
      for (let i = 0; i < herd; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const cx = hx + between(-22, 22);
          const cz = hz + between(-22, 22);
          // Never inside the yard, and never near the carriageway.
          if (Math.hypot(cx - x, cz - z) < YARD_CLEAR + 4) continue;
          if (roadClearance(cx, cz) < 26) continue;
          const cy = groundAt(cx, cz);
          if (!Number.isFinite(cy)) continue;
          // Cattle do not graze a cliff either, and one standing on a 30-degree face is
          // the sort of thing that gets noticed immediately.
          const slope = Math.abs(groundAt(cx + 3, cz) - cy) + Math.abs(groundAt(cx, cz + 3) - cy);
          if (slope > 2.4) continue;
          const cow = makeCow(rnd);
          cow.position.set(cx, cy, cz);
          group.add(cow);
          break;
        }
      }
    }
  }

  return added;
}
