/**
 * VAL BORBERA HILLCLIMB — Base Altitude Field
 *
 * A smooth global altitude for the landscape, following the stage's climb. Sampled from a
 * coarse IDW grid rather than computed per query: the previous backdrop builder ran a
 * full O(route) inverse-distance scan for every one of its 6,400 grid vertices, and the
 * unified field is queried far more often than that.
 *
 * TWO GRIDS, ONE PASS (added for the valley layer, see valleyLayer.ts's module doc for the
 * full history): the IDW loop below already visits every route sample for every grid node
 * to build the altitude grid, so it costs nothing extra to accumulate a second quantity in
 * the same loop — a FLOOR grid, the IDW blend of each route sample's own valley floor
 * (`y_i - depth_i * exposed_i`) using the exact same weights. This was originally attempted
 * as a per-query lookup of the single nearest road sample's dropDepth/altitude instead
 * (valleyLayer's first draft). That failed for the same reason the old MountainBackdropBuilder
 * failed and the same reason roadCarveLayer's own history (see its module doc, rounds 1-3)
 * exists: "nearest sample" is not a continuous function of position. Far from the road on a
 * switchback stage, two different legs can be near-equidistant from a point, so the nearest
 * sample flips discretely as the point moves a metre, and each leg can have an arbitrarily
 * different declared dropDepth — producing a real, measured ~40 m vertical terrain jump at a
 * single 1 m step (salita-cosola, s=362, lat=600). An IDW blend baked to a grid and read back
 * bilinearly has no such winner-take-all step: every route sample contributes to every node
 * in proportion to its own IDW weight, exactly like the existing altitude grid, so the floor
 * grid is continuous by construction, with no dependence on which sample is "nearest".
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

import { TrackSpline, SplineSample } from "../../TrackSpline";
import { FieldBounds } from "../roadIndex";
import { VALLEY_FLOOR_ALT, MAX_VISIBLE_DROP } from "./roadProfile";

export interface BaseAltitude {
  /** Smooth global road altitude — unchanged behaviour from before the floor grid. */
  sample(x: number, z: number): number;
  /**
   * Smooth global valley-floor altitude: the IDW blend of every route sample's own floor
   * (its road altitude, pulled down by its declared drop where it is exposed, left alone
   * where it is not). See the module doc for why this is a second grid rather than a
   * per-query nearest-sample lookup.
   */
  floor(x: number, z: number): number;
  bounds: FieldBounds;
}

const GRID = 96;
/** IDW softening radius, metres. Squared, so 40 m. */
const SOFTEN = 1600;

/**
 * One route sample's own floor altitude: its road altitude, pulled down by its declared
 * drop depth if it is exposed on either side, otherwise left at road altitude. Uses the
 * exact same clamp `roadProfile.profileHeightAt` applies to its own drop, so the floor this
 * grid blends toward lines up with the depth the road's own cliff was cut to.
 *
 * Deliberately NOT side-aware: unlike `profileHeightAt`, this does not ask whether the
 * QUERY point is on the exposed or cut side, because "which side" is exactly the second
 * discrete, sign-of-lateral-offset lookup that made valleyLayer's first draft discontinuous
 * at the medial axis between two ribbons (see valleyLayer.ts's module doc). The floor grid
 * pulls down on both sides of an exposed section; the cut side's correct rise is still
 * supplied by `profileHeightAt`'s own cut branch within CARVE_RADIUS and by ridgeLayer
 * beyond that, both unaffected by this file.
 */
function floorAt(s: SplineSample): number {
  if (s.exposure === "none") return s.y;
  const declared = s.dropDepth ?? 40;
  const toValleyFloor = Math.max(20, s.altitude - VALLEY_FLOOR_ALT);
  const depth = Math.min(declared, toValleyFloor, MAX_VISIBLE_DROP);
  return s.y - depth;
}

export function buildBaseAltitude(spline: TrackSpline, padding: number): BaseAltitude {
  const all = spline.getAllSamples();
  const stride = Math.max(1, Math.floor(all.length / 220));
  const route: SplineSample[] = [];
  for (let i = 0; i < all.length; i += stride) route.push(all[i]);

  // Compute exact bounding box from every sample, not just the strided route.
  // IDW is smooth enough over strided points, but bounds must cover the entire route
  // to remain correct regardless of future padding or stride choices.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of all) {
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
  const floorCells = new Float32Array(GRID * GRID);

  // Precompute each route sample's own floor altitude once, not once per grid node.
  const routeFloor = route.map(floorAt);

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = minX + gx * stepX;
      const wz = minZ + gz * stepZ;
      let weightSum = 0;
      let altSum = 0;
      let floorSum = 0;
      for (let i = 0; i < route.length; i++) {
        const s = route[i];
        const dx = wx - s.x;
        const dz = wz - s.z;
        const w = 1.0 / (dx * dx + dz * dz + SOFTEN);
        weightSum += w;
        altSum += s.y * w;
        floorSum += routeFloor[i] * w;
      }
      const idx = gz * GRID + gx;
      cells[idx] = weightSum > 0 ? altSum / weightSum : route[0].y;
      floorCells[idx] = weightSum > 0 ? floorSum / weightSum : routeFloor[0];
    }
  }

  const at = (grid: Float32Array, gx: number, gz: number): number => {
    const cx = gx < 0 ? 0 : gx > GRID - 1 ? GRID - 1 : gx;
    const cz = gz < 0 ? 0 : gz > GRID - 1 ? GRID - 1 : gz;
    return grid[cz * GRID + cx];
  };

  const bilinear = (grid: Float32Array, x: number, z: number): number => {
    const fx = (x - minX) / stepX;
    const fz = (z - minZ) / stepZ;
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    const tx = fx - gx;
    const tz = fz - gz;

    const h00 = at(grid, gx, gz), h10 = at(grid, gx + 1, gz);
    const h01 = at(grid, gx, gz + 1), h11 = at(grid, gx + 1, gz + 1);

    const ctx = tx < 0 ? 0 : tx > 1 ? 1 : tx;
    const ctz = tz < 0 ? 0 : tz > 1 ? 1 : tz;
    const a = h00 + (h10 - h00) * ctx;
    const b = h01 + (h11 - h01) * ctx;
    return a + (b - a) * ctz;
  };

  return {
    bounds: { minX, maxX, minZ, maxZ },
    sample(x, z) {
      return bilinear(cells, x, z);
    },
    floor(x, z) {
      return bilinear(floorCells, x, z);
    },
  };
}
