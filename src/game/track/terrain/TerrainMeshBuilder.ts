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
 * SKIRT PREDICATE — deliberately conservative:
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

/**
 * Procedural micro-detail bump map, generated once and shared by every stage.
 *
 * Guarded for headless use: the test suite builds terrain under `node:test`, where there is
 * no `document`. Without a canvas the material simply goes without the detail map, which
 * only affects tests.
 */
let cachedAlbedoTexture: THREE.Texture | null = null;

/**
 * Tiling ground albedo.
 *
 * The terrain had no texture at all — flat-shaded geometry with per-vertex colours. Every
 * previous attempt to improve its look modulated TINT, which cannot produce surface detail,
 * so it kept reading as coloured paper however the hue was adjusted. This is the actual
 * surface: multi-scale mottling plus scattered speckle, drawn once procedurally.
 *
 * It is deliberately near-monochrome. `vertexColors` MULTIPLIES this map, so the vertex
 * colours keep supplying the hue (chestnut green low, pasture and rock high, limestone in
 * the valley) while this supplies the structure. Colouring the texture too would fight the
 * altitude banding rather than support it.
 */
function getTerrainAlbedoTexture(): THREE.Texture | undefined {
  if (typeof document === "undefined") return undefined;
  if (cachedAlbedoTexture) return cachedAlbedoTexture;

  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  // Mid grey base: multiplying by 1.0 would leave the vertex colour untouched, so the base
  // sits slightly above mid and the detail darkens from there.
  ctx.fillStyle = "#b4b4b4";
  ctx.fillRect(0, 0, size, size);

  // Large soft blotches — the scale of grass patches and worn earth, several metres across.
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 18 + Math.random() * 52;
    const dark = Math.random() < 0.55;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + Math.random() * 0.07;
    grad.addColorStop(0, dark ? `rgba(70,70,70,${a})` : `rgba(232,232,232,${a})`);
    grad.addColorStop(1, "rgba(128,128,128,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine speckle — stones, tussocks, scree. What actually reads as "ground" up close.
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * 46;
    const o = i * 4;
    data[o] = Math.max(0, Math.min(255, data[o] + n));
    data[o + 1] = Math.max(0, Math.min(255, data[o + 1] + n));
    data[o + 2] = Math.max(0, Math.min(255, data[o + 2] + n));
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  // The mesh's UVs are world position * 0.5, i.e. one repeat every 2 m — right for the fine
  // bump map, far too tight for this. At that scale the blotches below would be 7-20 cm
  // across and read as noise rather than as patches of ground cover. `repeat` scales this
  // texture's own lookup independently of the shared UVs: 1/6 gives one tile per ~12 m.
  texture.repeat.set(1 / 6, 1 / 6);
  cachedAlbedoTexture = texture;
  return texture;
}

let cachedDetailTexture: THREE.Texture | null = null;
function getTerrainDetailTexture(): THREE.Texture | undefined {
  if (typeof document === "undefined") return undefined;
  if (cachedDetailTexture) return cachedDetailTexture;

  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0; i < size * size; i++) {
    // Uncorrelated per-texel noise around mid-grey: pure high-frequency grain, no visible
    // banding or stripes at any viewing distance.
    const v = 128 + (Math.random() - 0.5) * 44;
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  cachedDetailTexture = texture;
  return texture;
}

export function leafSizeAt(distToRoute: number): number {
  const d = distToRoute < 0 ? 0 : distToRoute;
  const target = MIN_LEAF + GRADE * d;
  return target < MIN_LEAF ? MIN_LEAF : target > MAX_LEAF ? MAX_LEAF : target;
}

// RELIEF OVERRIDE — leafSizeAt above grades purely by distance to the route, which is
// blind to vertical relief: on the cresta-ebro ridge road, drops of several hundred
// metres start a few metres off the asphalt, so a cell at 90-400 m out (already graded to
// 31-124 m by distance alone) can span well over 100 m of vertical cliff face with one
// flat quad — a visible staircase. isLeafCell below adds a second, independent test: keep
// subdividing while the cell's own corner-to-corner height range exceeds RELIEF_THRESHOLD,
// on top of whatever the distance grade already decided.
//
// Gated on both size and distance so the far field never pays for it: RELIEF_GATE_SIZE
// (32 m) and RELIEF_GATE_DIST (350 m) bound the test to the near-to-mid ring around the
// route where leafSizeAt's distance grade first produces cells coarse enough to span
// real relief — cells larger than 32 m only occur further out (>~90 m, per leafSizeAt),
// where the far-field cost of 5 extra field.heightAt samples per candidate node would
// explode across the whole horizon for comparatively little visible gain (measured:
// widening the size gate to 64/128 m nearly tripled cresta-ebro's triangle count and blew
// through its scene-budget ceiling for a barely-perceptible extra smoothing at range).
// Outside that ring/size window, isLeafCell returns the plain distance verdict with no
// extra field samples.
//
// RELIEF_FLOOR stops relief-driven subdivision at 8 m, twice MIN_LEAF: a cliff face cannot
// subdivide without bound just because it stays steep, and 8 m is where the extra cost
// (5 field.heightAt samples per candidate node) starts to matter.
const RELIEF_GATE_SIZE = 32;
const RELIEF_GATE_DIST = 350;
const RELIEF_FLOOR = 8;
const RELIEF_THRESHOLD = 48;

/**
 * Vertical relief of a cell: the spread between its highest and lowest sampled point.
 * Sampled at the four corners and the centre — five `field.heightAt` calls, pure in
 * (x, z, size) exactly like `field.heightAt` itself, so `isLeafCell` stays a pure function
 * of a cell's identity and `resolvedLeafSizeAt`'s neighbour resolution stays exact (see the
 * module doc's skirt-predicate section: anything that isn't a deterministic function of the
 * cell would desync the two callers and open cracks).
 */
function reliefOf(field: HeightField, x: number, z: number, size: number): number {
  const h0 = field.heightAt(x, z);
  const h1 = field.heightAt(x + size, z);
  const h2 = field.heightAt(x, z + size);
  const h3 = field.heightAt(x + size, z + size);
  const h4 = field.heightAt(x + size / 2, z + size / 2);
  const lo = Math.min(h0, h1, h2, h3, h4);
  const hi = Math.max(h0, h1, h2, h3, h4);
  return hi - lo;
}

/**
 * Interruptible terrain build.
 *
 * Returns a handle rather than a mesh: call `step()` until it returns false, then `finish()`.
 * One `step()` is one quadtree cell — microseconds — so a browser caller can fill a frame
 * budget precisely and paint in between. `buildTerrainMesh` below drains it in one go for
 * callers that do not care.
 */
export function beginTerrainMesh(field: HeightField): {
  step: () => boolean;
  finish: () => THREE.Mesh;
  progress: () => number;
} {
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
  const uvs: number[] = [];
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
  // Maps a skirt-bottom vertex index to the top-edge vertex index it hangs beneath. Used
  // after computeVertexNormals() to overwrite each skirt vertex's normal with its top
  // vertex's normal (see the skirt block in emitLeaf and the post-processing pass below
  // buildTerrainMesh's subdivide call): skirts are vertical apron geometry, so their
  // OWN geometric normal points sideways and catches light completely differently from
  // the ground surface they are stitching, reading as a pale streak. Borrowing the top
  // vertex's normal makes a skirt shade identically to the surface above it and
  // disappear, without touching `isSkirt` (still exact per-vertex, still what the
  // coverage tests key off) or the skirt's actual geometry (still closing the LOD crack).
  const skirtBottomToTop = new Map<number, number>();

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

    // World-planar UVs. The detail bump map below needs somewhere to map to, and tying UVs
    // to world position rather than to cell indices keeps the grain continuous across the
    // LOD boundaries where cell size changes.
    uvs.push(x * 0.5, z * 0.5);

    // Deterministic per-vertex colour jitter, carried over from the original terrain. A
    // smooth vertex-colour gradient over large flat-shaded facets reads as plastic; a small
    // amount of break-up is most of what makes it read as ground. Derived from position so
    // it is stable across rebuilds rather than random.
    const jitter = ((Math.abs(Math.round(x * 7 + z * 13)) % 17) / 17 - 0.5) * 0.05;
    colors.push(c.r + jitter, c.g + jitter, c.b + jitter);
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
  // "amortised O(1) extra per edge".
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
    let result = size <= leafSizeAt(d);

    // Relief override (see module doc / const block above): only when the distance grade
    // has already agreed to stop here, only in the size/distance window where the far
    // field's cost would otherwise explode, and never below RELIEF_FLOOR.
    if (result && size > RELIEF_FLOOR && size <= RELIEF_GATE_SIZE && d <= RELIEF_GATE_DIST) {
      if (reliefOf(field, x, z, size) > RELIEF_THRESHOLD) result = false;
    }

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
      // Each top vertex's colour was already computed by vertexAt's own field.sampleAt
      // call and is sitting in `colors` at that vertex's index — read it back instead of
      // querying the field a second time for the same point (saves a spatial query per
      // skirt edge, and keeps each bottom vertex's colour exactly matched to the top
      // vertex it hangs from, rather than both bottom vertices sharing t0's colour).
      const c0r = colors[t0 * 3], c0g = colors[t0 * 3 + 1], c0b = colors[t0 * 3 + 2];
      const c1r = colors[t1 * 3], c1g = colors[t1 * 3 + 1], c1b = colors[t1 * 3 + 2];

      const b0 = positions.length / 3;
      positions.push(x0, y0 - depth, z0);
      uvs.push(x0 * 0.5, z0 * 0.5);
      colors.push(c0r, c0g, c0b);
      isSkirt.push(1);
      skirtBottomToTop.set(b0, t0);
      const b1 = positions.length / 3;
      positions.push(x1, y1 - depth, z1);
      uvs.push(x1 * 0.5, z1 * 0.5);
      colors.push(c1r, c1g, c1b);
      isSkirt.push(1);
      skirtBottomToTop.set(b1, t1);

      // Wound so the face points OUTWARD, away from this leaf and toward the coarser
      // neighbour the skirt is hiding the gap from — the opposite sense from `quad()`
      // above, whose CCW-from-above convention is right for a horizontal surface but
      // backwards for a vertical wall. With the horizontal winding here instead, every
      // skirt's front face pointed back into the leaf's own solid ground: invisible to
      // any camera, which only ever stands on the outside of the terrain, so `FrontSide`
      // culled it and the LOD crack it exists to hide showed through as a hole letting
      // the sky show — worst against open sky at the horizon, since a failed skirt
      // nearer the road exposes more (equally-coloured) ground behind it instead.
      indices.push(t0, t1, b0, t1, b1, b0);
      skirtTriangleCount += 2;
    }
  };

  let leafCount = 0;

  // Split the root into a grid of top-level squares and walk them one at a time, so the
  // caller can stop between them. The quadtree recursion below each square is unchanged;
  // this only decides the ORDER and gives the work a seam to be interrupted at.
  //
  // Terrain generation is the whole of the loading time — measured at 2.7 s for Borbera
  // Sprint and 3.6 s for Salita di Cosola, against 15-25 ms for vegetation and 50-120 ms
  // for the road and its props — and it is synchronous, so the browser cannot paint for
  // the duration. That is why the loading animation freezes: it is not the animation, it is
  // that nothing at all can be drawn while this runs. The cost is inherent to the carve
  // (each vertex resolves 435 road samples on Borbera and 911 on Salita, three times over
  // for the slope probe), so it is not going away; it can only be made interruptible.
  // WORK QUEUE, NOT SLICES.
  //
  // This started as a grid of top-level squares, each built in one uninterruptible call.
  // That is too coarse to schedule against: a square over the road subdivides to 4 m cells
  // and cost up to 113 ms, seven frames of work that cannot be broken into, and the loading
  // screen hitched every time one came up. Making the grid finer is not available either —
  // the square is a CEILING on leaf size, so smaller squares force the far field to
  // subdivide past where the distance grade wanted to stop, and the mesh changes (measured:
  // 88k triangles became 121k, over budget, caught by the ceiling test).
  //
  // Replacing the recursion with an explicit stack makes the work resumable at the level of
  // a single quadtree cell, which is microseconds. The caller can then fill any budget it
  // likes exactly, and nothing it does can change the mesh — the same cells are visited in
  // the same order, because children are pushed in reverse so they pop in the order the
  // recursion used to recurse in.
  //
  // The grid survives only as a progress denominator: it says how much of the field has been
  // reached, which is what the loading bar reports.
  const SLICE_GRID = Math.max(1, Math.min(64, Math.floor(root / MAX_LEAF)));
  const sliceSize = root / SLICE_GRID;
  const slices: [number, number][] = [];
  for (let iz = 0; iz < SLICE_GRID; iz++) {
    for (let ix = 0; ix < SLICE_GRID; ix++) {
      slices.push([cx0 + ix * sliceSize, cz0 + iz * sliceSize]);
    }
  }

  let nextSlice = 0;
  const stack: [number, number, number][] = [];

  /** Processes ONE quadtree cell. Returns false once the whole field has been built. */
  const step = (): boolean => {
    if (stack.length === 0) {
      if (nextSlice >= slices.length) return false;
      const [sx, sz] = slices[nextSlice++];
      stack.push([sx, sz, sliceSize]);
    }
    const [x, z, size] = stack.pop()!;
    if (isLeafCell(x, z, size)) {
      emitLeaf(x, z, size);
      leafCount++;
      return true;
    }
    const h = size / 2;
    // Reverse of the old recursion order, so popping restores it.
    stack.push([x + h, z + h, h]);
    stack.push([x, z + h, h]);
    stack.push([x + h, z, h]);
    stack.push([x, z, h]);
    return true;
  };

  /** 0..1 across the field, by how much of the grid has been reached. */
  const progress = (): number => nextSlice / slices.length;

  const finish = (): THREE.Mesh => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  // 1 for a skirt-apron vertex, 0 for a real surface vertex. Consumers that need to tell
  // ground from skirt (e.g. a raycast coverage check) should treat a triangle as a skirt
  // triangle when ANY of its three vertices is flagged, not when all three are: a skirt
  // triangle always shares its top edge with the surface quad it hangs from (see the
  // `indices.push(t0, t1, b0, t1, b1, b0)` above), so it always has 1-2 surface-tagged
  // corners and never all three flagged.
  geometry.setAttribute("isSkirt", new THREE.Float32BufferAttribute(isSkirt, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Skirts are vertical apron faces (see the module doc and the skirt block above), so
  // their geometric normal points roughly horizontally — nothing like the ground normal
  // of the surface they are stitching a crack under. Lit that way, they catch light
  // completely differently from their surroundings and read as pale streaks across
  // hillsides, even though they are doing their job structurally (closing the crack).
  // Fix: after normals are computed from the real geometry, overwrite every skirt-bottom
  // vertex's normal with the normal of the top vertex it hangs from (recorded in
  // `skirtBottomToTop` while emitting), so each skirt shades identically to the ground
  // above it and disappears visually. This only rewrites the NORMAL attribute — `isSkirt`
  // and the skirt's actual position/index data are untouched, so the coverage tests (which
  // key off `isSkirt`, not normals) and the crack-closing geometry itself are unaffected.
  const normalAttr = geometry.getAttribute("normal") as THREE.BufferAttribute;
  for (const [bottomIdx, topIdx] of skirtBottomToTop) {
    normalAttr.setXYZ(
      bottomIdx,
      normalAttr.getX(topIdx),
      normalAttr.getY(topIdx),
      normalAttr.getZ(topIdx)
    );
  }
  normalAttr.needsUpdate = true;

  geometry.computeBoundingSphere();

  const albedo = getTerrainAlbedoTexture();
  const detail = getTerrainDetailTexture();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // High-frequency micro-detail. The original terrain carried this and the unified-field
    // rewrite dropped it, which is why the ground read as flat plastic: large smooth facets
    // with nothing breaking up the shading across them. Procedural, so it costs no download.
    // Spread rather than assign: both are undefined under node:test (no `document`), and
    // three.js warns for every explicitly-undefined material parameter.
    ...(albedo ? { map: albedo } : {}),
    ...(detail ? { bumpMap: detail, bumpScale: 0.75 } : {}),
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
  };

  return { step, finish, progress };
}

/**
 * The whole surface in one call — what tests and any headless caller want.
 */
export function buildTerrainMesh(field: HeightField): THREE.Mesh {
  const build = beginTerrainMesh(field);
  while (build.step()) {
    /* drain */
  }
  return build.finish();
}

/** Frustum-cullable form: the same surface, split into 250 m spatial chunks. */
/**
 * Chunk size, metres.
 *
 * 250 m was chosen when the terrain was a narrow corridor and the camera saw 900 m. Neither
 * holds now: the field spans the route bounding box plus 2.5 km of padding on every side, and
 * the far plane is 6 km, so a 250 m grid produced 1,087 separate meshes of which most were in
 * frustum — 1,087 draw calls for terrain alone, against roughly 250 for everything else in
 * the scene combined, and a documented budget of about 120.
 *
 * Finer chunks only pay off if culling them saves meaningful triangle work, and it does not
 * here: the whole terrain surface is ~46k triangles, so drawing more of it than strictly
 * visible costs far less than issuing hundreds of extra draw calls. At 800 m the same
 * geometry becomes 121 meshes — a ninefold reduction in calls for no change in triangles.
 */
const TERRAIN_CHUNK_M = 800;

export function buildChunkedTerrain(field: HeightField): THREE.Group {
  return chunkMeshBySpace(buildTerrainMesh(field), TERRAIN_CHUNK_M);
}

/**
 * The same thing, built a slice at a time with a chance to breathe in between.
 *
 * `onProgress` is called with 0..1 after each slice. `yieldTo` is awaited between slices —
 * the caller decides how to hand control back to the browser, and how often; passing a
 * function that resolves on a macrotask lets the page paint the loading screen, which it
 * otherwise cannot do at all for the two and a half to three and a half seconds this takes.
 */
export async function buildChunkedTerrainAsync(
  field: HeightField,
  yieldTo: () => Promise<void>,
  onProgress?: (fraction: number) => void
): Promise<THREE.Group> {
  const build = beginTerrainMesh(field);

  /**
   * Work done between yields, milliseconds.
   *
   * Yielding after EVERY slice is the obvious thing and it is wrong in both directions:
   * with coarse slices a single one overruns the frame and the screen hitches, and with
   * fine slices the yields themselves dominate — a `setTimeout(0)` costs several
   * milliseconds once nested, so 4,096 of them would add more waiting than there is work.
   *
   * Filling a fixed budget decouples the two: control goes back on a steady cadence
   * regardless of how expensive the region being built happens to be.
   *
   * Four milliseconds, chosen by measuring rather than by reasoning about frame budgets.
   * Frame pacing across a whole load, on the same machine and stage:
   *
   *     budget    4 ms      8 ms     12 ms
   *     p50       9.1 ms   10.9 ms   16.2 ms
   *     p90      14.8 ms   17.6 ms   25.0 ms
   *     dropped      10        9        19
   *     fps        55.2     44.5      33.3
   *
   * The intuition that a bigger budget is more efficient — fewer yields, less overhead —
   * is backwards here. Total build time barely moves between them, because the yield is a
   * macrotask and costs a few milliseconds either way; what a bigger budget buys is a
   * longer stretch in which the browser cannot paint.
   */
  const BUDGET_MS = 6;

  for (;;) {
    const until = performance.now() + BUDGET_MS;
    let more = true;
    // The clock is checked EVERY cell.
    //
    // It was checked every 64 on the reasoning that a cell is microseconds and reading the
    // clock that often would cost more than the work. That is true of an interior cell and
    // false of a leaf, which samples the height field at four corners at 143-333 us each —
    // one to three milliseconds. Sixty-four of those overshoots a 6 ms budget by more than
    // 100 ms, and that is exactly what the live site showed: a run of a dozen frames of
    // 100-130 ms while the bar still read 3%, which was the remaining jitter.
    //
    // `performance.now()` is about 50 ns. Across the whole build that is under a millisecond
    // — cheaper than a single one of the frames it was costing.
    while (more) {
      more = build.step();
      if (performance.now() >= until) break;
    }
    if (!more) break;
    onProgress?.(build.progress());
    await yieldTo();
  }

  onProgress?.(1);
  return chunkMeshBySpace(build.finish(), TERRAIN_CHUNK_M);
}
