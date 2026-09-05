/**
 * VAL BORBERA HILLCLIMB — Vegetation & Scenery Scatter Builder
 * Generates instanced multi-species trees (Italian Stone Pines, Cypresses, Olive Trees, Chestnuts, Boulders)
 * with authentic per-part vertex colors and spline-grounded placement.
 */

import * as THREE from "three";
import { TrackSpline } from "./TrackSpline";
import { HeightField } from "./terrain/heightField";
import { BuildingFootprint } from "./HamletBuilder";

/**
 * Independent random streams per scattered object.
 *
 * Every attribute of a tree used to be read off ONE value:
 *
 *   const rand = fract(sin(i * 12.9898 + k * 78.233) * 43758.5453);
 *   const side = rand > 0.5 ? 1 : -1;
 *   const dist = halfWidth + 3.6 + rand * maxTreeDist + k * 6;
 *   ... scale, rotation, species and rock-vs-tree all from the same `rand`
 *
 * Side and distance therefore could not disagree. Measured on Borbera Sprint: left-hand
 * trees stood 7.5-33.5 m from the road and right-hand trees 23.9-54.3 m — two ranges that
 * barely overlap, so one verge was a close hedge and the other distant scatter. Species is
 * chosen by a threshold on the same number, so it inherited the same split: 281 cypresses on
 * the left and NONE on the right, 74 boulders on the right and none on the left. Scale
 * followed distance, and rotation followed species.
 *
 * mulberry32 seeded on the station and index instead: eight draws that are actually
 * independent, still deterministic, still identical on every client.
 */
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

const colorGeo = (geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry => {
  const col = new THREE.Color(hex);
  const posCount = geo.attributes.position.count;
  const colors = new Float32Array(posCount * 3);
  for (let i = 0; i < posCount; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
};

const mergeGeometries = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.array.length;
    if (g.index) totalIndices += g.index.array.length;
  }

  const combinedPos = new Float32Array(totalVerts);
  const combinedCol = new Float32Array(totalVerts);
  const combinedIdx = new Uint32Array(totalIndices);

  let posOffset = 0;
  let idxOffset = 0;
  let vertCount = 0;

  for (const g of geos) {
    const pos = g.attributes.position.array as Float32Array;
    combinedPos.set(pos, posOffset);

    const col = g.attributes.color?.array as Float32Array;
    if (col) {
      combinedCol.set(col, posOffset);
    }

    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) {
        combinedIdx[idxOffset + i] = idx[i] + vertCount;
      }
      idxOffset += idx.length;
    }

    vertCount += pos.length / 3;
    posOffset += pos.length;
  }

  const combinedGeo = new THREE.BufferGeometry();
  combinedGeo.setAttribute("position", new THREE.BufferAttribute(combinedPos, 3));
  combinedGeo.setAttribute("color", new THREE.BufferAttribute(combinedCol, 3));
  if (totalIndices > 0) {
    combinedGeo.setIndex(new THREE.BufferAttribute(combinedIdx, 1));
  }
  combinedGeo.computeVertexNormals();
  return combinedGeo;
};

export function buildInstancedVegetation(
  spline: TrackSpline,
  field: HeightField,
  vegetationGroup: THREE.Group,
  /** Hamlet buildings to keep clear of. Trees were scattered with no knowledge of them, so
   *  they grew through walls and roofs. Optional: callers without hamlets pass nothing. */
  buildings: BuildingFootprint[] = []
): void {
  const samples = spline.getAllSamples();
  const count = Math.min(450, Math.floor(samples.length * 1.1));

  // 1. Italian Stone Pine
  const pineTrunk = colorGeo(new THREE.CylinderGeometry(0.20, 0.36, 5.2, 8), "#4a2c11");
  pineTrunk.translate(0, 2.6, 0);
  const pineTier1 = colorGeo(new THREE.ConeGeometry(3.8, 1.6, 12), "#1b431b");
  pineTier1.translate(0, 5.4, 0);
  const pineTier2 = colorGeo(new THREE.ConeGeometry(2.6, 1.4, 10), "#235323");
  pineTier2.translate(0, 6.2, 0);
  const pineGeo = mergeGeometries([pineTrunk, pineTier1, pineTier2]);
  const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.FrontSide, transparent: false, depthWrite: true });

  // 2. Ligurian Cypress
  const cypTrunk = colorGeo(new THREE.CylinderGeometry(0.18, 0.26, 1.8, 8), "#3d2b1f");
  cypTrunk.translate(0, 0.9, 0);
  const cypCone = colorGeo(new THREE.ConeGeometry(1.2, 6.8, 10), "#143314");
  cypCone.translate(0, 4.8, 0);
  const cypGeo = mergeGeometries([cypTrunk, cypCone]);
  const cypMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.80, side: THREE.FrontSide, transparent: false, depthWrite: true });

  // 3. Ligurian Olive Trees
  const oliveTrunk = colorGeo(new THREE.CylinderGeometry(0.26, 0.42, 2.6, 8), "#5c4a38");
  oliveTrunk.translate(0, 1.3, 0);
  const oliveLobe1 = colorGeo(new THREE.SphereGeometry(2.0, 8, 8), "#556b2f");
  oliveLobe1.translate(0, 3.2, 0);
  const oliveLobe2 = colorGeo(new THREE.SphereGeometry(1.6, 8, 8), "#6b8e23");
  oliveLobe2.translate(0.6, 3.6, 0.3);
  const oliveGeo = mergeGeometries([oliveTrunk, oliveLobe1, oliveLobe2]);
  const oliveMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.FrontSide, transparent: false, depthWrite: true });

  // 4. Mountain Chestnut & Beech Woods
  const chestnutTrunk = colorGeo(new THREE.CylinderGeometry(0.32, 0.50, 3.8, 8), "#3b2314");
  chestnutTrunk.translate(0, 1.9, 0);
  const chestnutLobe1 = colorGeo(new THREE.SphereGeometry(3.0, 9, 9), "#2d5a27");
  chestnutLobe1.translate(0, 4.4, 0);
  const chestnutLobe2 = colorGeo(new THREE.SphereGeometry(2.2, 8, 8), "#387030");
  chestnutLobe2.translate(-0.8, 5.0, 0.6);
  const chestnutGeo = mergeGeometries([chestnutTrunk, chestnutLobe1, chestnutLobe2]);
  const chestnutMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.80, side: THREE.FrontSide, transparent: false, depthWrite: true });

  // 5. Limestone Boulders
  const rockGeo = new THREE.DodecahedronGeometry(2.2, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#94a3b8", roughness: 0.92, flatShading: true });

  // 6. Background scrub — a single trunk-less low-poly blob (an icosahedron, 20 faces) for
  // the mid-distance fields and hillsides beyond where the roadside trees above reach (they
  // stop at ~60-76 m out; see the `maxTreeDist` cutoff below). Past that the terrain was bare
  // green with nothing breaking it up. This only needs to read as scattered brush at a glance
  // from the road, not survive close inspection, so it skips the trunk/tiered-canopy pieces
  // the real species above spend triangles on.
  const scrubGeo = new THREE.IcosahedronGeometry(1.7, 0);
  const scrubMat = new THREE.MeshStandardMaterial({ color: "#3f6b2f", roughness: 0.9, flatShading: true });

  const dummy = new THREE.Object3D();

  /**
   * Placements are COLLECTED first and only turned into meshes at the end, bucketed by
   * position — see the chunking note at the bottom of this function.
   */
  interface Placement {
    species: string;
    matrix: THREE.Matrix4;
    x: number;
    z: number;
  }
  const placements: Placement[] = [];
  const emit = (species: string, x: number, z: number): void => {
    placements.push({ species, matrix: dummy.matrix.clone(), x, z });
  };

  // Retained only to keep the per-species population caps the old code enforced through
  // `idx < count`, which is what stops one species swamping the whole stage.
  const emitted: Record<string, number> = {
    "veg-pine": 0,
    "veg-cypress": 0,
    "veg-olive": 0,
    "veg-chestnut": 0,
    "veg-rock": 0,
    "veg-scrub": 0,
  };
  // Separate, much lower caps than the roadside species: this is background texture spread
  // over a far wider band, not a hedge that needs individually convincing trees. The far
  // band gets its own budget on top so that filling the near band can never starve it —
  // they cover different ground and one is not a substitute for the other.
  const scrubCount = Math.min(280, Math.floor(samples.length * 0.5));
  const farScrubCount = Math.min(300, Math.floor(samples.length * 0.55));

  for (let i = 2; i < samples.length - 2; i += 3) {
    const s = samples[i];
    const alt = s.altitude;
    const numTreesAtStation = (i % 5 === 0) ? 2 : 1;

    for (let k = 0; k < numTreesAtStation; k++) {
      const rnd = rngFrom(i * 2654435761 + k * 40503);
      const side = rnd() < 0.5 ? -1 : 1;
      const isRiverSide =
        (side < 0 && (s.exposure === "left" || s.exposure === "both")) ||
        (side > 0 && (s.exposure === "right" || s.exposure === "both"));

      const maxTreeDist = isRiverSide ? 42.0 : 34.0;
      const dist = s.halfWidth + 3.6 + rnd() * maxTreeDist + k * 6.0;
      // Jitter drawn separately per axis. Both offsets used to be the SAME number, so the
      // displacement was always along the x = z diagonal.
      const posX = s.x + s.normalX * dist * side + (rnd() - 0.5) * 3.0;
      const pz = s.z + s.normalZ * dist * side + (rnd() - 0.5) * 3.0;

      const proj = spline.projectFrenet(posX, pz);
      if (Math.abs(proj.t) <= proj.sample.halfWidth + 2.8 || Math.abs(proj.t) > 60.0) {
        continue;
      }

      // Not through somebody's house.
      let insideBuilding = false;
      for (const b of buildings) {
        if (Math.hypot(b.x - posX, b.z - pz) < b.r + 3.0) {
          insideBuilding = true;
          break;
        }
      }
      if (insideBuilding) continue;

      // Ground at the tree's ACTUAL world position. The previous code grounded against a
      // road-relative height, which on a sweeper could resolve to a different station
      // entirely and left trees floating by up to 135 m.
      const posY = field.heightAt(posX, pz) - 0.35;

      const scale = 0.85 + rnd() * 0.45;
      const stretch = 0.95 + rnd() * 0.15;
      const spin = rnd() * Math.PI * 2;
      const speciesRoll = rnd();
      const rockRoll = rnd();

      dummy.position.set(posX, posY, pz);
      dummy.scale.set(scale, scale * stretch, scale);
      dummy.rotation.y = spin;
      dummy.updateMatrix();

      if (isRiverSide && rockRoll > 0.72 && emitted["veg-rock"] < count) {
        dummy.position.y = posY + 0.35;
        dummy.scale.set(1.2 + speciesRoll * 0.6, 0.7 + speciesRoll * 0.4, 1.2 + speciesRoll * 0.6);
        dummy.updateMatrix();
        emitted["veg-rock"]++;
        emit("veg-rock", posX, pz);
      } else if (alt < 620) {
        if (speciesRoll > 0.4 && emitted["veg-olive"] < count) {
          emitted["veg-olive"]++;
          emit("veg-olive", posX, pz);
        } else if (emitted["veg-cypress"] < count) {
          emitted["veg-cypress"]++;
          emit("veg-cypress", posX, pz);
        }
      } else if (alt >= 620 && alt < 980) {
        if (speciesRoll > 0.35 && emitted["veg-pine"] < count) {
          emitted["veg-pine"]++;
          emit("veg-pine", posX, pz);
        } else if (emitted["veg-chestnut"] < count) {
          emitted["veg-chestnut"]++;
          emit("veg-chestnut", posX, pz);
        }
      } else if (emitted["veg-chestnut"] < count) {
        emitted["veg-chestnut"]++;
        emit("veg-chestnut", posX, pz);
      }
    }

    // Background scrub, in two bands. One roll each per station (not per-k — this is sparse
    // filler, not a hedge), placed well beyond the roadside trees' ~60-76 m reach. Own rng
    // stream so it never perturbs the roadside placements above regardless of station index.
    //
    // The NEAR band alone left everything past ~225 m bare, and the hillsides a player
    // actually looks at across a valley are further out than that: they arrived as one flat
    // green mass with a fringe of planting along the road and nothing beyond it. The FAR
    // band reaches 600 m with fewer, much larger clumps — at that range an individual bush
    // is sub-pixel and worthless, while a copse-sized blob is what reads as woodland on a
    // far slope. Bigger and rarer is strictly better value per triangle out there.
    const scrubRnd = rngFrom(i * 2654435761 + 99991);

    const placeScrub = (dist: number, jitter: number, minScale: number, scaleRange: number): void => {
      const side = scrubRnd() < 0.5 ? -1 : 1;
      const posX = s.x + s.normalX * dist * side + (scrubRnd() - 0.5) * jitter;
      const pz = s.z + s.normalZ * dist * side + (scrubRnd() - 0.5) * jitter;

      // Reject anything that actually lands on or near ANY part of the road (these offsets
      // are large enough that on a switchback stage they can land close to a different leg
      // of the route entirely, not just this station's own corridor).
      const proj = spline.projectFrenet(posX, pz);
      if (Math.abs(proj.t) <= proj.sample.halfWidth + 4.0) return;

      for (const b of buildings) {
        if (Math.hypot(b.x - posX, b.z - pz) < b.r + 3.0) return;
      }

      const posY = field.heightAt(posX, pz) - 0.2;
      const scale = minScale + scrubRnd() * scaleRange;
      dummy.position.set(posX, posY, pz);
      dummy.scale.set(scale, scale * (0.6 + scrubRnd() * 0.35), scale);
      dummy.rotation.y = scrubRnd() * Math.PI * 2;
      dummy.updateMatrix();
      emitted["veg-scrub"]++;
      emit("veg-scrub", posX, pz);
    };

    if (scrubRnd() < 0.18 && emitted["veg-scrub"] < scrubCount) {
      placeScrub(65.0 + scrubRnd() * 160.0, 30.0, 1.3, 1.7); // 65-225 m
    }
    if (scrubRnd() < 0.30 && emitted["veg-scrub"] < scrubCount + farScrubCount) {
      placeScrub(230.0 + scrubRnd() * 370.0, 90.0, 3.2, 4.0); // 230-600 m, copse-sized
    }
  }

  // --- Spatial chunking -----------------------------------------------------------------
  //
  // One InstancedMesh per species covering the whole stage is one draw call, which reads as
  // efficient and is the reason it was written that way. It is not: an InstancedMesh is
  // frustum-culled as a single object against a bounding sphere that spans the entire
  // route, so it is either drawn in full or not at all. Every tree on the stage was
  // rasterised every frame — in the main pass AND again in the directional light's shadow
  // pass, which redraws every caster from the sun's point of view whether or not it is
  // anywhere near the 120 m shadow box.
  //
  // Measured in a headless sweep of the camera through 360 degrees at one point on Borbera
  // Sprint: 397k triangles submitted per frame regardless of heading, of which the
  // vegetation was the largest single share, and the same sweep cost 29.1 s with shadows
  // against 5.9 s without. Nothing about that changed when the camera turned to face empty
  // hillside, which is the shape of "it gets laggy when you turn": the cost is paid in
  // every direction, so the frame budget is already spent before the direction with the
  // most geometry in it comes round.
  //
  // Bucketing the instances into CHUNK_M cells and emitting one InstancedMesh per
  // (species, cell) gives the culler something it can actually reject. Geometry and
  // material are shared across cells, so this costs no extra memory and only as many extra
  // draw calls as there are cells genuinely on screen.
  const CHUNK_M = 240;

  /**
   * Background scrub buckets on a much coarser grid than the roadside species.
   *
   * Chunking exists to give the frustum culler something to reject, and 240 m is right for
   * planting that hugs the road: those cells are dense, so each draw call carries real work.
   * Scrub is the opposite — it is spread thinly across a band up to 600 m to either side, so
   * on a 240 m grid the outer cells hold one or two clumps each and every one of them still
   * costs a draw call. Widening the band that way took the vegetation group from 84 separate
   * instanced draws to 110 for barely three thousand extra triangles, which is the wrong
   * trade in exactly the direction the chunking note below warns about.
   *
   * At 720 m the same clumps collapse into far fewer, fuller draws. Culling gets coarser, but
   * a scrub clump is twenty triangles: drawing a few that are off screen is much cheaper than
   * issuing the calls to avoid them — the same reasoning that put TERRAIN_CHUNK_M at 800.
   */
  const SCRUB_CHUNK_M = 720;

  const perSpecies: Record<string, { geo: THREE.BufferGeometry; mat: THREE.Material }> = {
    "veg-pine": { geo: pineGeo, mat: pineMat },
    "veg-cypress": { geo: cypGeo, mat: cypMat },
    "veg-olive": { geo: oliveGeo, mat: oliveMat },
    "veg-chestnut": { geo: chestnutGeo, mat: chestnutMat },
    "veg-rock": { geo: rockGeo, mat: rockMat },
    "veg-scrub": { geo: scrubGeo, mat: scrubMat },
  };

  const buckets = new Map<string, Placement[]>();
  for (const pl of placements) {
    const cell = pl.species === "veg-scrub" ? SCRUB_CHUNK_M : CHUNK_M;
    const key = `${pl.species}|${Math.floor(pl.x / cell)}|${Math.floor(pl.z / cell)}`;
    const list = buckets.get(key);
    if (list) list.push(pl);
    else buckets.set(key, [pl]);
  }

  for (const [key, list] of buckets) {
    const species = key.slice(0, key.indexOf("|"));
    const { geo, mat } = perSpecies[species];
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i].matrix);
    mesh.instanceMatrix.needsUpdate = true;
    // Named by species, not by cell: tests and any future per-species logic group on this,
    // and which cell an instance landed in is an implementation detail of the culler.
    mesh.name = species;
    // Background filler doesn't need to cast shadows: it's far enough out that a missing
    // shadow is invisible, and skipping it halves the shadow-pass draw calls this adds.
    mesh.castShadow = species !== "veg-rock" && species !== "veg-scrub";
    // Instance matrices are baked at build time and never move, so the bounding volume the
    // culler needs can be computed once. Without this three.js falls back to the geometry's
    // own sphere, which ignores the instance offsets entirely and would cull cells wrongly.
    mesh.computeBoundingSphere();
    vegetationGroup.add(mesh);
  }
}
