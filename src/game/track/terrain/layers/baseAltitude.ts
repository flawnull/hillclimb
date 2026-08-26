/**
 * VAL BORBERA HILLCLIMB — Base Altitude Field
 *
 * A smooth global altitude for the landscape, following the stage's climb. Sampled from a
 * coarse IDW grid rather than computed per query: the previous backdrop builder ran a
 * full O(route) inverse-distance scan for every one of its 6,400 grid vertices, and the
 * unified field is queried far more often than that.
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

import { TrackSpline, SplineSample } from "../../TrackSpline";
import { FieldBounds } from "../roadIndex";

export interface BaseAltitude {
  sample(x: number, z: number): number;
  bounds: FieldBounds;
}

const GRID = 96;
/** IDW softening radius, metres. Squared, so 40 m. */
const SOFTEN = 1600;

export function buildBaseAltitude(spline: TrackSpline, padding: number): BaseAltitude {
  const all = spline.getAllSamples();
  const stride = Math.max(1, Math.floor(all.length / 220));
  const route: SplineSample[] = [];
  for (let i = 0; i < all.length; i += stride) route.push(all[i]);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of route) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
  }
  minX -= padding; maxX += padding;
  minZ -= padding; maxZ += padding;

  const stepX = (maxX - minX) / (GRID - 1);
  const stepZ = (maxZ - minZ) / (GRID - 1);
  const cells = new Float32Array(GRID * GRID);

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = minX + gx * stepX;
      const wz = minZ + gz * stepZ;
      let weightSum = 0;
      let altSum = 0;
      for (const s of route) {
        const dx = wx - s.x;
        const dz = wz - s.z;
        const w = 1.0 / (dx * dx + dz * dz + SOFTEN);
        weightSum += w;
        altSum += s.y * w;
      }
      cells[gz * GRID + gx] = weightSum > 0 ? altSum / weightSum : route[0].y;
    }
  }

  const at = (gx: number, gz: number): number => {
    const cx = gx < 0 ? 0 : gx > GRID - 1 ? GRID - 1 : gx;
    const cz = gz < 0 ? 0 : gz > GRID - 1 ? GRID - 1 : gz;
    return cells[cz * GRID + cx];
  };

  return {
    bounds: { minX, maxX, minZ, maxZ },
    sample(x, z) {
      const fx = (x - minX) / stepX;
      const fz = (z - minZ) / stepZ;
      const gx = Math.floor(fx);
      const gz = Math.floor(fz);
      const tx = fx - gx;
      const tz = fz - gz;

      const h00 = at(gx, gz), h10 = at(gx + 1, gz);
      const h01 = at(gx, gz + 1), h11 = at(gx + 1, gz + 1);

      const a = h00 + (h10 - h00) * (tx < 0 ? 0 : tx > 1 ? 1 : tx);
      const b = h01 + (h11 - h01) * (tx < 0 ? 0 : tx > 1 ? 1 : tx);
      return a + (b - a) * (tz < 0 ? 0 : tz > 1 ? 1 : tz);
    },
  };
}
