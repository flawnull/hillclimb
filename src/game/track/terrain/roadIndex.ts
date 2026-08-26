/**
 * VAL BORBERA HILLCLIMB — Road Spatial Index
 *
 * Uniform-grid spatial hash over the spline's samples. The height field queries
 * "which road tiers are near this world point" for every vertex it generates, and the
 * old backdrop builder's full O(route) scan per query is far too slow for that.
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

import { TrackSpline, SplineSample } from "../TrackSpline";

export interface RoadHit {
  sample: SplineSample;
  /** Signed lateral offset from this sample's centreline. + is right of travel. */
  lat: number;
  /** 2D distance from the query point to this sample's centreline point. */
  dist: number;
}

export interface FieldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoadIndex {
  query(x: number, z: number, radius: number): RoadHit[];
  nearest(x: number, z: number): RoadHit;
  bounds: FieldBounds;
}

const CELL = 32;

function hit(s: SplineSample, x: number, z: number): RoadHit {
  const dx = x - s.x;
  const dz = z - s.z;
  return {
    sample: s,
    lat: dx * s.normalX + dz * s.normalZ,
    dist: Math.sqrt(dx * dx + dz * dz),
  };
}

export function buildRoadIndex(spline: TrackSpline, stride: number = 1): RoadIndex {
  const all = spline.getAllSamples();
  const samples: SplineSample[] = [];
  for (let i = 0; i < all.length; i += stride) samples.push(all[i]);
  if (samples[samples.length - 1] !== all[all.length - 1]) samples.push(all[all.length - 1]);

  const buckets = new Map<number, SplineSample[]>();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  const key = (gx: number, gz: number): number => gx * 73856093 ^ gz * 19349663;

  for (const s of samples) {
    const gx = Math.floor(s.x / CELL);
    const gz = Math.floor(s.z / CELL);
    const k = key(gx, gz);
    let list = buckets.get(k);
    if (!list) { list = []; buckets.set(k, list); }
    list.push(s);

    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
  }

  const collect = (x: number, z: number, radius: number): SplineSample[] => {
    const out: SplineSample[] = [];
    const g0x = Math.floor((x - radius) / CELL);
    const g1x = Math.floor((x + radius) / CELL);
    const g0z = Math.floor((z - radius) / CELL);
    const g1z = Math.floor((z + radius) / CELL);
    for (let gx = g0x; gx <= g1x; gx++) {
      for (let gz = g0z; gz <= g1z; gz++) {
        const list = buckets.get(key(gx, gz));
        if (!list) continue;
        for (const s of list) {
          // The hash may collide; verify the sample really is in this cell.
          if (Math.floor(s.x / CELL) !== gx || Math.floor(s.z / CELL) !== gz) continue;
          out.push(s);
        }
      }
    }
    return out;
  };

  return {
    bounds: { minX, maxX, minZ, maxZ },

    query(x, z, radius) {
      const out: RoadHit[] = [];
      for (const s of collect(x, z, radius)) {
        const h = hit(s, x, z);
        if (h.dist <= radius) out.push(h);
      }
      return out;
    },

    nearest(x, z) {
      let radius = CELL;
      for (;;) {
        const found = this.query(x, z, radius);
        if (found.length > 0) {
          let best = found[0];
          for (const h of found) if (h.dist < best.dist) best = h;
          return best;
        }
        radius *= 2;
        if (radius > 1e7) return hit(samples[0], x, z);
      }
    },
  };
}
