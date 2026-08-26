/**
 * VAL BORBERA HILLCLIMB — Corridor Terrain, Semi-Green Mountains & Torrente Borbera Riverbed
 * 
 * Strict performance discipline (§13.2 & §8.4):
 * - 360m corridor heightfield around spline only (never generate full 20km valley)
 * - InstancedMesh for trees, boulders, and shrubs (1 draw call per species)
 * - Real Apennine terrain: semi-green olive/chestnut hills, rocky sandstone cuts, chalk-white riverbed
 */

import * as THREE from "three";
import { TrackSpline, SplineSample } from "./TrackSpline";
import { chunkMeshBySpace } from "./batchStatics";
import { detNormalizeAngle } from "../vehicle/deterministicMath";
import { buildDistantMountainBackdrop } from "./MountainBackdropBuilder";
import { buildInstancedVegetation } from "./VegetationScatterBuilder";

let cachedTerrainNoise: THREE.CanvasTexture | null = null;
function getTerrainNoiseTexture(): THREE.CanvasTexture {
  if (cachedTerrainNoise) return cachedTerrainNoise;
  if (typeof document === "undefined") return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
  
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 512, 512);

  const imgData = ctx.getImageData(0, 0, 512, 512);
  const data = imgData.data;
  
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      // purely random static noise for micro-detail (no stripes)
      const noise = (Math.random() - 0.5) * 40;
      const val = Math.max(0, Math.min(255, 128 + noise));
      
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  
  cachedTerrainNoise = texture;
  return texture;
}

export { buildDistantMountainBackdrop, buildInstancedVegetation };

/** Altitude of the Borbera valley floor, metres ASL. Nothing drops below this. */
const VALLEY_FLOOR_ALT = 430;
const MAX_VISIBLE_DROP = 1200;
const VERGE_WIDTH = 1.2;
const DROP_FALLOFF = 0.055;
const CUT_HEIGHT = 6.0;
const CUT_SLOPE = 0.42;
const HILL_FALLOFF = 0.016;
const HILLSIDE_RISE = 85;
const RIDGE_PULL_MIN_HEIGHT = 300;
const RIDGE_PULL_START = 120;
const RIDGE_PULL_SPAN = 260;
const RIDGE_PULL_FRACTION = 0.85;
const OPEN_VALLEY_RISE = 30;
const OPEN_VALLEY_FALLOFF = 0.010;

/**
 * SINGLE SOURCE OF TRUTH for off-road ground height.
 */
export function terrainHeightAt(s: SplineSample, latDist: number): number {
  const hw = s.halfWidth;
  const d = Math.abs(latDist) - hw;

  // On the road ribbon itself (subgrade)
  if (d <= 0) return s.y - 0.20;
  // Gravel verge, sloping smoothly down from asphalt edge
  if (d <= VERGE_WIDTH) return s.y - 0.12 - 0.08 * (d / VERGE_WIDTH);

  const isLeft = latDist < 0;
  const exposed =
    (isLeft && (s.exposure === "left" || s.exposure === "both")) ||
    (!isLeft && (s.exposure === "right" || s.exposure === "both"));

  const dd = Math.max(0, d - VERGE_WIDTH - 0.8);
  const vergeBase = s.y - 0.20;

  if (exposed) {
    const declared = s.dropDepth ?? 40;
    const toValleyFloor = Math.max(20, s.altitude - VALLEY_FLOOR_ALT);
    const depth = Math.min(declared, toValleyFloor, MAX_VISIBLE_DROP);
    const t = 1 - 1 / (1 + dd * DROP_FALLOFF);
    return vergeBase - depth * t;
  }

  if (s.exposure === "none") {
    const open = vergeBase + OPEN_VALLEY_RISE * (1 - 1 / (1 + dd * OPEN_VALLEY_FALLOFF));
    const aboveFloor = s.altitude - VALLEY_FLOOR_ALT;
    if (aboveFloor <= RIDGE_PULL_MIN_HEIGHT) return open;

    const far = Math.max(0, Math.min(1, (dd - RIDGE_PULL_START) / RIDGE_PULL_SPAN));
    const eased = far * far * (3 - 2 * far);
    return open - eased * aboveFloor * RIDGE_PULL_FRACTION;
  }

  const cutSpan = CUT_HEIGHT / CUT_SLOPE;
  const cutProgress = Math.min(1.0, dd / cutSpan);
  const cutEased = cutProgress * cutProgress * (3 - 2 * cutProgress);
  const cut = CUT_HEIGHT * cutEased;
  const beyond = Math.max(0, dd - cutSpan);
  const hill = (HILLSIDE_RISE - CUT_HEIGHT) * (1 - 1 / (1 + beyond * HILL_FALLOFF));
  return vergeBase + cut + Math.max(0, hill);
}

export function orientTrianglesUpward(geo: THREE.BufferGeometry): number {
  const index = geo.index;
  if (!index) return 0;
  const pos = geo.attributes.position;
  const idx = index.array as Uint16Array | Uint32Array;
  const EPS = 1e-6;
  let flipped = 0;

  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const e1x = pos.getX(b) - pos.getX(a);
    const e1z = pos.getZ(b) - pos.getZ(a);
    const e2x = pos.getX(c) - pos.getX(a);
    const e2z = pos.getZ(c) - pos.getZ(a);
    const ny = e1z * e2x - e1x * e2z;

    if (ny < -EPS) {
      idx[t + 1] = c;
      idx[t + 2] = b;
      flipped++;
    }
  }

  if (flipped > 0) index.needsUpdate = true;
  return flipped;
}

type Column =
  | { kind: "edge"; edge: -1.3 | 1.3 }
  | { kind: "ground"; frac: number };

const OUTWARD = [0.012, 0.028, 0.05, 0.082, 0.125, 0.185, 0.265, 0.375, 0.52, 0.74, 1.0];

const COLUMNS: Column[] = [
  ...OUTWARD.slice().reverse().map((frac) => ({ kind: "ground" as const, frac: -frac })),
  { kind: "edge", edge: -1.3 },
  { kind: "edge", edge: 1.3 },
  ...OUTWARD.map((frac) => ({ kind: "ground" as const, frac })),
];

const MAX_CORRIDOR = 260;
const CORRIDOR_CLEARANCE = 0.48;

export class Terrain {
  public mesh: THREE.Group;
  public riverMesh: THREE.Group;
  public backdropMesh: THREE.Mesh;
  public vegetationGroup: THREE.Group;
  private spline: TrackSpline;

  constructor(spline: TrackSpline) {
    this.spline = spline;
    this.vegetationGroup = new THREE.Group();
    this.mesh = chunkMeshBySpace(this.buildCorridorTerrain());
    this.riverMesh = chunkMeshBySpace(this.buildRiverMesh());
    this.backdropMesh = buildDistantMountainBackdrop(this.spline);
    buildInstancedVegetation(this.spline, this.vegetationGroup);
  }

  private buildRiverMesh(): THREE.Mesh {
    // The Borbera river runs exclusively in the valley floor of Stage 1 (Borbera Sprint).
    // Mountain climb stages (Salita di Cosola, Cresta Ebro) climb into high alpine ridges with no river.
    if (this.spline.stage.id !== "borbera-sprint") {
      const emptyGeo = new THREE.BufferGeometry();
      emptyGeo.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      return new THREE.Mesh(emptyGeo);
    }

    const samples = this.spline.getAllSamples();
    if (samples.length < 2) return new THREE.Mesh();

    const RIVER_DIST = 120;
    const RIVER_WIDTH = 14;
    const MIN_RUN = 12;

    const verts: number[] = [];
    const indices: number[] = [];

    const sideOf = (s: SplineSample): -1 | 0 | 1 => {
      if (s.exposure === "left") return -1;
      if (s.exposure === "right") return 1;
      if (s.exposure === "both") return 1;
      return 0;
    };

    let runStart = 0;
    let runSide = sideOf(samples[0]);

    const flushRun = (from: number, to: number, side: -1 | 0 | 1) => {
      if (side === 0) return;
      if (to - from < MIN_RUN) return;

      const base = verts.length / 3;
      for (let i = from; i <= to; i++) {
        const s = samples[i];
        const lat = RIVER_DIST * side;
        const cx = s.x + s.normalX * lat;
        const cz = s.z + s.normalZ * lat;
        // Sit the water on the valley floor the corridor mesh actually generates,
        // rather than at an invented depth below the road.
        const y = terrainHeightAt(s, lat) + 0.35;

        verts.push(
          cx - s.normalX * (RIVER_WIDTH / 2), y, cz - s.normalZ * (RIVER_WIDTH / 2),
          cx + s.normalX * (RIVER_WIDTH / 2), y, cz + s.normalZ * (RIVER_WIDTH / 2)
        );
      }

      const rows = to - from + 1;
      for (let r = 0; r < rows - 1; r++) {
        const a = base + r * 2;
        const b = base + (r + 1) * 2;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    };

    for (let i = 1; i < samples.length; i++) {
      const side = sideOf(samples[i]);
      if (side !== runSide) {
        flushRun(runStart, i - 1, runSide);
        runStart = i;
        runSide = side;
      }
    }
    flushRun(runStart, samples.length - 1, runSide);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    orientTrianglesUpward(geo);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: "#2563eb",
      roughness: 0.15,
      metalness: 0.55,
      transparent: true,
      opacity: 0.82,
    });

    return new THREE.Mesh(geo, mat);
  }

  private buildCorridorTerrain(): THREE.Mesh {
    const all = this.spline.getAllSamples();
    if (all.length < 2) return new THREE.Mesh();

    // Adaptive longitudinal sampling: 3.5m step around curves/hairpins to eliminate chord sag into the road,
    // and 12m step on straights to preserve 60fps framerate & stay within GPU triangle budget (§13.3).
    const core: SplineSample[] = [];
    let lastS = -999;
    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      const headingDelta = (i > 0 && i < all.length - 1)
        ? Math.abs(detNormalizeAngle(all[i + 1].heading - all[i - 1].heading))
        : 0;
      const isCurved = headingDelta > 0.016 || Math.abs(s.bank) > 0.025;
      const minStep = isCurved ? 3.5 : 12.0;

      if (s.s - lastS >= minStep || i === all.length - 1) {
        core.push(s);
        lastS = s.s;
      }
    }

    // Lead-in and run-out. The chase camera sits ~8 m behind the start line, which is
    // outside the stage; with the corridor stopping dead at s=0 the camera looked
    // straight at the raw 600 m-wide edge of the mesh. Extrapolate flat ground along
    // the entry and exit tangents so there is always terrain under and around the car.
    const APRON_LENGTH = 140;
    const APRON_STEP = 20;
    const apron = (end: SplineSample, dir: -1 | 1): SplineSample[] => {
      const out: SplineSample[] = [];
      const tx = Math.sin(end.heading) * dir;
      const tz = Math.cos(end.heading) * dir;
      for (let d = APRON_STEP; d <= APRON_LENGTH; d += APRON_STEP) {
        out.push({
          ...end,
          x: end.x + tx * d,
          z: end.z + tz * d,
          s: end.s + (dir < 0 ? -d : d),
          exposure: "none",
          dropDepth: 0,
        });
      }
      return out;
    };

    const samples: SplineSample[] = [
      ...apron(core[0], -1).reverse(),
      ...core,
      ...apron(core[core.length - 1], 1),
    ];
    const numSamples = samples.length;

    // Asymmetric corridor widths for left and right wings.
    // On stacked switchbacks (34 tornanti), the corridor on the facing side must stop
    // well before reaching the opposing road tier (≤ 40% of the gap), while the opposite
    // side facing the valley may expand fully to MAX_CORRIDOR.
    const corridorLeft = new Float32Array(numSamples);
    const corridorRight = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const hw = s.halfWidth;
      let nearestLeft = Infinity;
      let nearestRight = Infinity;

      for (let k = 0; k < numSamples; k++) {
        if (Math.abs(samples[k].s - s.s) < 22) continue;

        // Opposing switchback tiers always head in opposite or transverse directions.
        // Points on the same road section have similar headings (headingCos > 0.5) and are skipped.
        const headingCos = Math.cos(samples[k].heading - s.heading);
        if (headingCos > 0.5 && Math.abs(samples[k].s - s.s) < 160) continue;

        const dx = samples[k].x - s.x;
        const dz = samples[k].z - s.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= MAX_CORRIDOR * MAX_CORRIDOR * 4) continue;

        // Project relative vector onto the row's tangent vector:
        // If the other point is far ahead or behind us longitudinally, it is not alongside us 
        // and should not constrain our lateral corridor.
        const dotTangent = dx * -s.normalZ + dz * s.normalX;
        if (Math.abs(dotTangent) > 60) continue;

        // Project relative vector onto the row's normal vector:
        // dotNormal < 0 indicates the other road tier is to the left; dotNormal > 0 to the right.
        const dotNormal = dx * s.normalX + dz * s.normalZ;
        const latDist = Math.abs(dotNormal);

        if (dotNormal < 0) {
          if (latDist < nearestLeft) nearestLeft = latDist;
        } else {
          if (latDist < nearestRight) nearestRight = latDist;
        }
      }

      const minLeftMargin = hw + VERGE_WIDTH + 0.3;
      const minRightMargin = hw + VERGE_WIDTH + 0.3;

      const gapL = nearestLeft === Infinity ? MAX_CORRIDOR * 2 : nearestLeft;
      const gapR = nearestRight === Infinity ? MAX_CORRIDOR * 2 : nearestRight;

      // Safe clearance: corridor extends at most 40% of the gap to facing road tier, never exceeding MAX_CORRIDOR
      corridorLeft[i] = Math.max(minLeftMargin, Math.min(MAX_CORRIDOR, gapL * CORRIDOR_CLEARANCE));
      corridorRight[i] = Math.max(minRightMargin, Math.min(MAX_CORRIDOR, gapR * CORRIDOR_CLEARANCE));
    }

    // Rate-limit before smoothing to prevent abrupt steps across rows
    const MAX_WIDTH_DELTA_PER_ROW = 2.5;
    for (let i = 1; i < numSamples; i++) {
      corridorLeft[i] = Math.min(corridorLeft[i], corridorLeft[i - 1] + MAX_WIDTH_DELTA_PER_ROW);
      corridorRight[i] = Math.min(corridorRight[i], corridorRight[i - 1] + MAX_WIDTH_DELTA_PER_ROW);
    }
    for (let i = numSamples - 2; i >= 0; i--) {
      corridorLeft[i] = Math.min(corridorLeft[i], corridorLeft[i + 1] + MAX_WIDTH_DELTA_PER_ROW);
      corridorRight[i] = Math.min(corridorRight[i], corridorRight[i + 1] + MAX_WIDTH_DELTA_PER_ROW);
    }

    // Constrained smoothing: smoothed width must NEVER exceed the clearance constraint of the current row
    const smoothedLeft = new Float32Array(numSamples);
    const smoothedRight = new Float32Array(numSamples);
    const R = 4;
    for (let i = 0; i < numSamples; i++) {
      let sumL = 0, sumR = 0, n = 0;
      for (let k = Math.max(0, i - R); k <= Math.min(numSamples - 1, i + R); k++) {
        sumL += corridorLeft[k];
        sumR += corridorRight[k];
        n++;
      }
      smoothedLeft[i] = Math.min(corridorLeft[i], sumL / n);
      smoothedRight[i] = Math.min(corridorRight[i], sumR / n);
    }

    const numCols = COLUMNS.length;
    const vertexCount = numSamples * numCols;
    const quadCount = (numSamples - 1) * (numCols - 1);
    
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(quadCount * 6);

    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const hw = s.halfWidth;

      for (let j = 0; j < numCols; j++) {
        const vIdx = i * numCols + j;
        const col = COLUMNS[j];
        const isVergeEdge = col.kind === "edge";
        const isLeft = col.kind === "edge" ? col.edge < 0 : col.frac < 0;
        const maxCorridor = isLeft
          ? Math.min(smoothedLeft[i], corridorLeft[i])
          : Math.min(smoothedRight[i], corridorRight[i]);
        const innerMargin = hw + VERGE_WIDTH + 0.15;
        const availableGround = Math.max(0, maxCorridor - innerMargin);

        let latDist: number;
        if (col.kind === "edge") {
          latDist = isLeft ? -innerMargin : innerMargin;
        } else {
          const out = Math.abs(col.frac) * availableGround;
          latDist = (isLeft ? -1 : 1) * (innerMargin + out);
        }

        const py = isVergeEdge ? s.y - 0.22 : terrainHeightAt(s, latDist);

        positions[vIdx * 3] = s.x + s.normalX * latDist;
        positions[vIdx * 3 + 1] = py;
        positions[vIdx * 3 + 2] = s.z + s.normalZ * latDist;

        // UVs for bump mapping (high frequency, no stripes)
        uvs[vIdx * 2] = (s.x + s.normalX * latDist) * 0.5;
        uvs[vIdx * 2 + 1] = (s.z + s.normalZ * latDist) * 0.5;

        // Colour by height BELOW/ABOVE the road and by altitude band (§8.1):
        // chestnut green low down, beech, then open pasture and rock up top.
        const rel = py - s.y;
        const alt = s.altitude;
        const jitter = (((i * 13 + j * 29) % 17) / 17 - 0.5) * 0.05;

        let r: number, g: number, bl: number;
        if (isVergeEdge) {
          r = 0.38; g = 0.39; bl = 0.32;
        } else if (rel < -8 && Math.abs(latDist) > hw + 80) {
          // Valley floor: pale limestone river gravel
          r = 0.80; g = 0.81; bl = 0.78;
        } else if (rel < -2.5) {
          // Face of the drop: shaded rock and scree
          const f = Math.min(1, -rel / 75);
          r = 0.34 - f * 0.08; g = 0.35 - f * 0.05; bl = 0.28 - f * 0.05;
        } else if (rel > 4.5) {
          // Sandstone/limestone cut on mountain side
          const cutT = Math.min(1, (rel - 4.5) / 12);
          r = 0.48 + cutT * 0.08; g = 0.44 + cutT * 0.06; bl = 0.38 + cutT * 0.05;
        } else {
          // Smooth continuous vegetation gradient with altitude
          const altT1 = Math.max(0, Math.min(1, (alt - 600) / 400));
          const altT2 = Math.max(0, Math.min(1, (alt - 1000) / 450));

          // Chestnut green (low) -> Beech (mid) -> Alpine pasture & rock (high)
          const lowR = 0.26, lowG = 0.42, lowB = 0.18;
          const midR = 0.36, midG = 0.47, midB = 0.24;
          const highR = 0.54, highG = 0.54, highB = 0.42;

          r = lowR + (midR - lowR) * altT1;
          g = lowG + (midG - lowG) * altT1;
          bl = lowB + (midB - lowB) * altT1;

          r += (highR - r) * altT2;
          g += (highG - g) * altT2;
          bl += (highB - bl) * altT2;
        }

        colors[vIdx * 3] = r + jitter;
        colors[vIdx * 3 + 1] = g + jitter;
        colors[vIdx * 3 + 2] = bl + jitter;
      }
    }

    const roadGapIdx = OUTWARD.length; // 11: gap between left verge outer and right verge outer

    let idxPtr = 0;
    for (let i = 0; i < numSamples - 1; i++) {
      const row0 = i * numCols;
      const row1 = (i + 1) * numCols;
      for (let j = 0; j < numCols - 1; j++) {
        // Skip the quad that spans across the carriageway gap between left wing and right wing
        if (j === roadGapIdx) {
          continue;
        }

        const a = row0 + j, b = row0 + j + 1, c = row1 + j, d = row1 + j + 1;
        // Counter-clockwise seen from above, so computeVertexNormals() produces UPWARD
        // normals. The original winding was inverted; DoubleSide hid it, because three.js
        // flips the normal for back faces. Culling backfaces made the ground vanish.
        indices[idxPtr++] = a; indices[idxPtr++] = c; indices[idxPtr++] = b;
        indices[idxPtr++] = b; indices[idxPtr++] = c; indices[idxPtr++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices.slice(0, idxPtr), 1));
    orientTrianglesUpward(geometry);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      bumpMap: getTerrainNoiseTexture(),
      bumpScale: 0.8,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
      // FrontSide, not DoubleSide: the underside of a 600 m-wide slab should never be
      // drawable, and rendering it doubled the fill cost for nothing.
      side: THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}



