/**
 * VAL BORBERA HILLCLIMB — Mountain Backdrop Heightfield Builder
 * Generates the far-field 80x80 heightfield mountain backdrop with IDW elevation blending,
 * Apennine harmonic relief synthesis, and continuous ecological color gradients.
 */

import * as THREE from "three";
import { TrackSpline, SplineSample } from "./TrackSpline";
import { terrainHeightAt } from "./Terrain";

function orientTrianglesUpward(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos || !idx) return;

  const arr = idx.array as Uint32Array | Uint16Array;
  const count = arr.length;

  for (let i = 0; i < count; i += 3) {
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + 2];

    const ax = pos.getX(a), az = pos.getZ(a);
    const bx = pos.getX(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cz = pos.getZ(c);

    // 2D cross product in XZ plane (Y is up)
    const e1x = bx - ax;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2z = cz - az;

    const crossY = e1z * e2x - e1x * e2z;
    if (crossY < 0) {
      arr[i + 1] = c;
      arr[i + 2] = b;
    }
  }
}

export function buildDistantMountainBackdrop(spline: TrackSpline): THREE.Mesh {
  const all = spline.getAllSamples();
  if (all.length < 2) return new THREE.Mesh();

  // Coarse polyline of the route, for distance queries
  const routeStride = Math.max(1, Math.floor(all.length / 220));
  const route: SplineSample[] = [];
  for (let i = 0; i < all.length; i += routeStride) route.push(all[i]);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let floor = Infinity;
  for (const s of route) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
    if (s.y < floor) floor = s.y;
  }

  const PADDING = 1800;
  minX -= PADDING; maxX += PADDING;
  minZ -= PADDING; maxZ += PADDING;

  const gridSize = 80;
  const vertexCount = gridSize * gridSize;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array((gridSize - 1) * (gridSize - 1) * 6);

  const stepX = (maxX - minX) / (gridSize - 1);
  const stepZ = (maxZ - minZ) / (gridSize - 1);

  const queryRouteMetrics = (
    wx: number,
    wz: number
  ): { dist: number; smoothAlt: number; nearest: SplineSample; signedLat: number } => {
    let minDistSq = Infinity;
    let nearestIdx = 0;
    let weightSum = 0;
    let altSum = 0;

    for (let i = 0; i < route.length; i++) {
      const dx = wx - route[i].x;
      const dz = wz - route[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDistSq) {
        minDistSq = d2;
        nearestIdx = i;
      }

      // Soft IDW kernel
      const w = 1.0 / (d2 + 1600); // 40m softening radius
      weightSum += w;
      altSum += route[i].y * w;
    }

    const nearest = route[nearestIdx];
    const dx = wx - nearest.x;
    const dz = wz - nearest.z;
    const signedLat = dx * nearest.normalX + dz * nearest.normalZ;

    return {
      dist: Math.sqrt(minDistSq),
      smoothAlt: weightSum > 0 ? altSum / weightSum : floor,
      nearest,
      signedLat,
    };
  };

  const RIDGE_START = 180;   // m from nearest route point
  const RIDGE_FULL = 800;    // m where ridges reach full height

  const distances = new Float32Array(gridSize * gridSize);

  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const vIdx = gz * gridSize + gx;
      const wx = minX + gx * stepX;
      const wz = minZ + gz * stepZ;

      const { dist, smoothAlt, nearest, signedLat } = queryRouteMetrics(wx, wz);
      distances[vIdx] = dist;
      const tRaw = (dist - RIDGE_START) / (RIDGE_FULL - RIDGE_START);
      const t = Math.max(0, Math.min(1, tRaw));
      const blend = t * t * (3 - 2 * t); // Smoothstep

      // Organic multi-scale Apennine mountain relief
      const relief =
        Math.sin(wx * 0.0018 + 0.9) * 160 +
        Math.cos(wz * 0.0015 + 1.2) * 140 +
        Math.sin((wx + wz) * 0.0035 + 0.4) * 80 +
        Math.cos((wx - wz) * 0.0028) * 50;

      const clampedLat = Math.max(-400, Math.min(400, signedLat));
      const base = terrainHeightAt(nearest, clampedLat);
      const wy = base - (1.0 - blend) * 0.35 + blend * (190 + relief * 0.65);

      positions[vIdx * 3] = wx;
      positions[vIdx * 3 + 1] = wy;
      positions[vIdx * 3 + 2] = wz;

      // Smooth continuous altitude and relief color blending
      const elevationDelta = wy - smoothAlt;
      const peakT = Math.max(0, Math.min(1, (elevationDelta - 70) / 120));
      const midT = Math.max(0, Math.min(1, (elevationDelta - 20) / 70));

      const valleyR = 0.24, valleyG = 0.36, valleyB = 0.18;
      const midR = 0.30, midG = 0.40, midB = 0.22;
      const peakR = 0.54, peakG = 0.55, peakB = 0.52;

      let r = valleyR + (midR - valleyR) * midT;
      let g = valleyG + (midG - valleyG) * midT;
      let b = valleyB + (midB - valleyB) * midT;

      r += (peakR - r) * peakT;
      g += (peakG - g) * peakT;
      b += (peakB - b) * peakT;

      colors[vIdx * 3] = r;
      colors[vIdx * 3 + 1] = g;
      colors[vIdx * 3 + 2] = b;
    }
  }

  let idxPtr = 0;
  for (let gz = 0; gz < gridSize - 1; gz++) {
    const row0 = gz * gridSize;
    const row1 = (gz + 1) * gridSize;
    for (let gx = 0; gx < gridSize - 1; gx++) {
      const a = row0 + gx, b = row0 + gx + 1, c = row1 + gx, d = row1 + gx + 1;
      // Never emit coarse backdrop triangles near the road corridor (within 120m)
      if (distances[a] < 120 || distances[b] < 120 || distances[c] < 120 || distances[d] < 120) {
        continue;
      }
      indices[idxPtr++] = a; indices[idxPtr++] = c; indices[idxPtr++] = b;
      indices[idxPtr++] = b; indices[idxPtr++] = c; indices[idxPtr++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices.slice(0, idxPtr), 1));
  orientTrianglesUpward(geo);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0.0,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
