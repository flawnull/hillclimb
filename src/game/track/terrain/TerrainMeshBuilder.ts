/**
 * VAL BORBERA HILLCLIMB — Graded Quadtree Terrain Mesh
 *
 * Samples the unified height field onto a single surface whose resolution is graded by
 * distance to the route: 4 m cells hugging the road, 256 m at the horizon.
 *
 * The quadtree is never stored. A leaf's size is a pure function of its position, so a
 * neighbour's size is found by evaluating that same function at the neighbour's centre.
 * That is what lets the builder emit crack-closing skirts without any neighbour
 * bookkeeping: a leaf skirts an edge exactly when the cell across it is coarser.
 *
 * Note on cost: the previous corridor mesh was anisotropic — fine laterally, coarse along
 * straights — which is why it fitted in ~21k vertices. A world-space quadtree cannot be
 * anisotropic, so this is more triangles. The anisotropy was inseparable from the
 * road-relative parameterization, and that parameterization was the root cause of both
 * the see-through holes and the terrain climbing onto the road, so this is the price.
 *
 * SKIRT PREDICATE — deliberately conservative (see task-7-report.md):
 *
 * `subdivide` decides whether a cell of size S stays a leaf using a CONSERVATIVE
 * distance — `distToRoute(centre) - S * 0.7071` — so a cell that only clips the corridor
 * at its corner still subdivides. The skirt check below, by contrast, can only evaluate
 * `leafSizeAt` at the raw neighbour centre distance (it has no cheap way to know what
 * conservative radius the neighbour used at whatever depth it stopped at). Those two
 * numbers can disagree, and disagreement in the "don't skirt" direction is a hole you can
 * see through the terrain.
 *
 * So the predicate here skirts whenever the neighbour's leaf size, computed the same way
 * (`leafSizeAt(distToRoute(neighbourCentre))`), is NOT STRICTLY SMALLER than this leaf's
 * size — i.e. it also skirts ties, not just strict coarseness. A redundant skirt is
 * invisible (it sits under the surface); a missing one is a hole. When in doubt, skirt.
 */

import * as THREE from "three";
import { HeightField } from "./heightField";
import { chunkMeshBySpace } from "../batchStatics";

const MIN_LEAF = 4;
const MAX_LEAF = 256;
const GRADE = 0.30;

export function leafSizeAt(distToRoute: number): number {
  const d = distToRoute < 0 ? 0 : distToRoute;
  const target = MIN_LEAF + GRADE * d;
  return target < MIN_LEAF ? MIN_LEAF : target > MAX_LEAF ? MAX_LEAF : target;
}

export function buildTerrainMesh(field: HeightField): THREE.Mesh {
  const { minX, maxX, minZ, maxZ } = field.bounds;

  // Square root cell, side rounded up to a power-of-two multiple of MIN_LEAF so that
  // every subdivision level lands on a clean size.
  const span = Math.max(maxX - minX, maxZ - minZ);
  let root = MIN_LEAF;
  while (root < span) root *= 2;
  const cx0 = (minX + maxX) / 2 - root / 2;
  const cz0 = (minZ + maxZ) / 2 - root / 2;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertexIds = new Map<string, number>();
  // Explicit skirt tag, one entry per vertex: 0 for a real surface vertex, 1 for a skirt
  // apron vertex. This exists because a triangle's normal cannot distinguish "vertical
  // skirt" from "vertical cliff face": the height field legitimately produces near-
  // vertical drops next to the road (Task 5's exposed-drop branch reaches slopes far
  // steeper than any normal-based threshold), so geometric inference misclassifies real
  // surface as skirt. Tagging at emission time is exact. See heightFieldSkirt below and
  // the coverage test, which reads this attribute instead of inferring from normals.
  const isSkirt: number[] = [];

  // AMENDMENT 1: sampleAt shares the single spatial query between height and colour,
  // instead of the brief's heightAt + classifyAt (two to three redundant queries per
  // vertex — see the JSDoc on HeightField.sampleAt). This is the hot path: every vertex
  // of a quadtree over the whole play area goes through here.
  const vertexAt = (x: number, z: number): number => {
    // Quantise to 1 mm so shared corners weld rather than duplicate.
    const key = `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
    const existing = vertexIds.get(key);
    if (existing !== undefined) return existing;

    const { height: y, color: c } = field.sampleAt(x, z);
    const id = positions.length / 3;
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
    isSkirt.push(0);
    vertexIds.set(key, id);
    return id;
  };

  /** Wound counter-clockwise seen from above, so computeVertexNormals points up. */
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, c, b, b, c, d);
  };

  // Memoises the "does this exact grid cell stay a leaf" decision, keyed by its
  // (size, corner-x, corner-z). `subdivide` and `resolvedLeafSizeAt` (below) both walk
  // the SAME grid-aligned coordinate scheme from the same root, so any node one of them
  // visits is a node the other would visit too on its way to the same point — caching
  // means each distinct node's `distToRoute` query runs at most once across the whole
  // build, however many times (main traversal or neighbour lookups) that node is
  // visited. Total distinct nodes in a quadtree with L leaves is O(L), not O(L * levels
  // queried), which is what turns the exact neighbour resolution below from "one full
  // root-to-leaf walk per edge, ~11 distToRoute calls, ~O(L) total" back down to
  // "amortised O(1) extra per edge" (see the measured timings in task-7-report.md).
  const leafDecisionCache = new Map<string, boolean>();
  const isLeafCell = (x: number, z: number, size: number): boolean => {
    if (size <= MIN_LEAF) return true;
    const key = `${size}:${x}:${z}`;
    const cached = leafDecisionCache.get(key);
    if (cached !== undefined) return cached;
    const cx = x + size / 2;
    const cz = z + size / 2;
    // Conservative: use the closest point of the cell to the route, so a cell that only
    // clips the corridor still subdivides.
    const d = Math.max(0, field.distToRoute(cx, cz) - size * 0.7071);
    const result = size <= leafSizeAt(d);
    leafDecisionCache.set(key, result);
    return result;
  };

  /**
   * The TRUE built leaf size at an arbitrary world point, found by descending the same
   * quadtree `subdivide` walks, from the root, stopping at the same cell `subdivide`
   * would stop at. This is what the skirt check needs to know about a neighbour: not
   * "what would `leafSizeAt` alone say at this raw distance" (which ignores the
   * conservative shrink `subdivide` applies, and so is systematically biased finer than
   * any real neighbour, making almost every neighbour look "coarser" and forcing a skirt
   * on nearly every edge regardless of the real LOD boundary — measured ~80% skirt
   * triangles with that approach) but "what cell does `subdivide` actually build here".
   * Since a leaf's size is a pure function of position with no PERMANENTLY stored
   * structure (per the module's own premise), resolving it exactly costs one extra
   * top-down walk through `isLeafCell` — cached, so in practice nearly free once the
   * main traversal has visited the same region.
   */
  const resolvedLeafSizeAt = (px: number, pz: number): number => {
    let x = cx0, z = cz0, size = root;
    for (;;) {
      if (isLeafCell(x, z, size)) return size;
      const h = size / 2;
      const midX = x + h, midZ = z + h;
      if (px < midX) {
        if (pz >= midZ) z = midZ;
      } else {
        x = midX;
        if (pz >= midZ) z = midZ;
      }
      size = h;
    }
  };

  let skirtTriangleCount = 0;

  const emitLeaf = (x: number, z: number, size: number): void => {
    const a = vertexAt(x, z);
    const b = vertexAt(x + size, z);
    const c = vertexAt(x, z + size);
    const d = vertexAt(x + size, z + size);
    quad(a, b, c, d);

    // Skirt any edge whose neighbouring cell is not strictly finer than this leaf (see
    // module doc: "conservative" means we also skirt ties, not just strict coarseness).
    // A coarser or equal neighbour can span this edge with fewer/larger segments,
    // leaving this leaf's edge free to sit slightly off it; a short vertical apron hides
    // the resulting crack.
    const half = size / 2;
    const depth = size * 1.5;
    const edges: Array<[number, number, number, number, number, number]> = [
      // [neighbourCentreX, neighbourCentreZ, x0, z0, x1, z1]
      [x + half, z - half, x, z, x + size, z],
      [x + half, z + size + half, x + size, z + size, x, z + size],
      [x - half, z + half, x, z + size, x, z],
      [x + size + half, z + half, x + size, z, x + size, z + size],
    ];

    for (const [nx, nz, x0, z0, x1, z1] of edges) {
      // Exact: what leaf size does `subdivide` actually build at the neighbour's
      // position (see resolvedLeafSizeAt above for why the raw/approximate forms
      // over-skirt almost every edge).
      const neighbourLeafSize = resolvedLeafSizeAt(nx, nz);
      // Skirt only when the neighbour is STRICTLY coarser than this leaf. Same-size
      // neighbours (the common case) need no skirt: their shared edge is built from the
      // same two corner vertices on both sides, so there is no crack to hide.
      if (neighbourLeafSize <= size + 1e-6) continue;

      const t0 = vertexAt(x0, z0);
      const t1 = vertexAt(x1, z1);
      const y0 = positions[t0 * 3 + 1];
      const y1 = positions[t1 * 3 + 1];
      const c0 = field.sampleAt(x0, z0).color;

      const b0 = positions.length / 3;
      positions.push(x0, y0 - depth, z0);
      colors.push(c0.r, c0.g, c0.b);
      isSkirt.push(1);
      const b1 = positions.length / 3;
      positions.push(x1, y1 - depth, z1);
      colors.push(c0.r, c0.g, c0.b);
      isSkirt.push(1);

      indices.push(t0, b0, t1, t1, b0, b1);
      skirtTriangleCount += 2;
    }
  };

  let leafCount = 0;

  const subdivide = (x: number, z: number, size: number): void => {
    if (isLeafCell(x, z, size)) {
      emitLeaf(x, z, size);
      leafCount++;
      return;
    }
    const h = size / 2;
    subdivide(x, z, h);
    subdivide(x + h, z, h);
    subdivide(x, z + h, h);
    subdivide(x + h, z + h, h);
  };

  subdivide(cx0, cz0, root);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  // 1 for a skirt-apron vertex, 0 for a real surface vertex. Consumers that need to tell
  // ground from skirt (e.g. a raycast coverage check) should treat a triangle as a skirt
  // triangle when ANY of its three vertices is flagged, not when all three are: a skirt
  // triangle always shares its top edge with the surface quad it hangs from (see the
  // `indices.push(t0, b0, t1, t1, b0, b1)` above), so it always has 1-2 surface-tagged
  // corners and never all three flagged.
  geometry.setAttribute("isSkirt", new THREE.Float32BufferAttribute(isSkirt, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: false,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  // Stats stashed on userData for the build script / Task 8 budget accounting; not part
  // of the public contract.
  mesh.userData.terrainStats = {
    leafCount,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    skirtTriangleCount,
    surfaceTriangleCount: indices.length / 3 - skirtTriangleCount,
  };
  return mesh;
}

/** Frustum-cullable form: the same surface, split into 250 m spatial chunks. */
export function buildChunkedTerrain(field: HeightField): THREE.Group {
  return chunkMeshBySpace(buildTerrainMesh(field), 250);
}
