/**
 * VAL BORBERA HILLCLIMB — Static Geometry Batching (§13.2, §13.3)
 *
 * Roadside furniture is authored one prop at a time — guardrail posts, beams,
 * reflectors, kerbs, cippi, chevrons, house walls and roofs. That is the right way to
 * WRITE it and the wrong way to DRAW it: Salita di Cosola produced 7,644 individual
 * meshes, each one an object the renderer must matrix-update, frustum-test and issue a
 * draw call for, against a budget of 120 draw calls.
 *
 * This collapses them into merged meshes, one per (spatial chunk x material). Chunking
 * rather than merging the whole stage into one mesh is deliberate: a single 10 km mesh
 * can never be frustum-culled, so every triangle in the stage would be submitted every
 * frame. At 250 m chunks only the handful of chunks actually in view are drawn, which is
 * what keeps VISIBLE triangles inside budget even though the stage total stays large.
 *
 * The props are static for the lifetime of a stage, so baking their world transforms
 * into the vertices costs nothing.
 */

import * as THREE from "three";

/** Edge length of a batching chunk, metres. */
const DEFAULT_CHUNK_SIZE = 250;

/** Below this many meshes a bucket is not worth merging. */
const MIN_BUCKET_SIZE = 2;

interface Candidate {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrixWorld: THREE.Matrix4;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
}

/**
 * Attributes a merged geometry will carry. Every geometry in a bucket must have exactly
 * this set, or the concatenation would misalign.
 */
/**
 * Identity of a material by CONTENT, not by object.
 *
 * Bucketing on `material.uuid` alone barely helped: the prop authoring code constructs a
 * fresh `new THREE.MeshStandardMaterial({...})` per prop, so a thousand identical grey
 * guardrail posts carried a thousand distinct material objects and never merged. Two
 * materials that would rasterise identically must land in the same bucket.
 */
function materialSignature(m: THREE.Material): string {
  const anyMat = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
  const parts = [
    m.type,
    anyMat.color ? anyMat.color.getHexString() : "-",
    anyMat.map ? anyMat.map.uuid : "-",
    anyMat.emissive ? anyMat.emissive.getHexString() : "-",
    anyMat.roughness !== undefined ? anyMat.roughness.toFixed(3) : "-",
    anyMat.metalness !== undefined ? anyMat.metalness.toFixed(3) : "-",
    m.transparent ? "T" : "O",
    m.opacity.toFixed(3),
    String(m.side),
    m.depthWrite ? "dw" : "-",
    (m as THREE.MeshStandardMaterial).flatShading ? "flat" : "-",
    String(m.blending),
  ];
  return parts.join("|");
}

/** One canonical material instance per signature, so merged batches share state. */
const canonicalMaterials = new Map<string, THREE.Material>();

function canonicalMaterial(m: THREE.Material): { key: string; material: THREE.Material } {
  const key = materialSignature(m);
  let mat = canonicalMaterials.get(key);
  if (!mat) {
    mat = m;
    canonicalMaterials.set(key, mat);
  }
  return { key, material: mat };
}

function attributeSignature(geo: THREE.BufferGeometry): string {
  return Object.keys(geo.attributes).sort().join(",");
}

function mergeBucket(bucket: Candidate[]): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];

  for (const c of bucket) {
    // Non-indexed keeps the concatenation trivial and correct; it costs vertices, not
    // triangles, and triangles are what the frame budget is measured in.
    const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    g.applyMatrix4(c.matrixWorld);
    parts.push(g);
  }

  const names = Object.keys(parts[0].attributes);
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;

  const merged = new THREE.BufferGeometry();

  for (const name of names) {
    const itemSize = parts[0].attributes[name].itemSize;
    const out = new Float32Array(total * itemSize);
    let offset = 0;
    for (const p of parts) {
      const attr = p.attributes[name];
      const src = attr.array as ArrayLike<number>;
      for (let i = 0; i < attr.count * itemSize; i++) out[offset + i] = src[i];
      offset += attr.count * itemSize;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  }

  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Returns a new Group containing merged equivalents of everything in `source`.
 * The source group is left untouched; callers normally discard it.
 */
export function batchStaticGroup(source: THREE.Group, chunkSize: number = DEFAULT_CHUNK_SIZE): THREE.Group {
  source.updateMatrixWorld(true);

  const buckets = new Map<string, Candidate[]>();
  const passthrough: THREE.Mesh[] = [];

  source.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    // InstancedMesh is already one draw call; leave it alone.
    if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    // Multi-material meshes use geometry groups, which merging would break.
    if (Array.isArray(mesh.material)) return;

    const p = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const cx = Math.floor(p.x / chunkSize);
    const cz = Math.floor(p.z / chunkSize);
    const { key: matKey, material } = canonicalMaterial(mesh.material);
    const key = `${cx}|${cz}|${matKey}|${attributeSignature(mesh.geometry)}`;

    const entry: Candidate = {
      geometry: mesh.geometry,
      material,
      matrixWorld: mesh.matrixWorld.clone(),
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      renderOrder: mesh.renderOrder,
    };

    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  });

  const out = new THREE.Group();
  out.name = source.name ? `${source.name}__batched` : "batched";

  for (const bucket of buckets.values()) {
    if (bucket.length < MIN_BUCKET_SIZE) {
      const c = bucket[0];
      const g = c.geometry.clone();
      g.applyMatrix4(c.matrixWorld);
      const m = new THREE.Mesh(g, c.material);
      m.castShadow = c.castShadow;
      m.receiveShadow = c.receiveShadow;
      m.renderOrder = bucket[0].renderOrder || 0;
      out.add(m);
      continue;
    }

    const merged = mergeBucket(bucket);
    if (!merged) {
      for (const c of bucket) passthrough.push(new THREE.Mesh(c.geometry, c.material));
      continue;
    }

    const mesh = new THREE.Mesh(merged, bucket[0].material);
    // If any prop in the bucket cast a shadow, the merged batch must too.
    mesh.castShadow = bucket.some((c) => c.castShadow);
    mesh.receiveShadow = bucket.some((c) => c.receiveShadow);
    mesh.renderOrder = bucket[0].renderOrder || 0;
    out.add(mesh);
  }

  for (const m of passthrough) out.add(m);
  return out;
}

/** Draw-call and triangle census for a subtree. Used by the perf test. */
export function countRenderables(root: THREE.Object3D): { meshes: number; instanced: number; triangles: number } {
  let meshes = 0;
  let instanced = 0;
  let triangles = 0;
  root.traverse((node) => {
    const m = node as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) instanced++;
    else meshes++;
    const g = m.geometry;
    if (!g) return;
    if (g.index) triangles += g.index.count / 3;
    else if (g.attributes.position) triangles += g.attributes.position.count / 3;
  });
  return { meshes, instanced, triangles: Math.round(triangles) };
}

/**
 * Splits one large mesh into a Group of spatially-bucketed chunk meshes.
 *
 * The road ribbon and the corridor terrain are each authored as a single strip spanning
 * the whole stage. On Salita di Cosola that is one 102,600-triangle mesh and one 45,188
 * -triangle mesh, each with a bounding sphere radius of ~1.4 km — so the frustum test can
 * never reject either, and every triangle in the stage is submitted every frame no matter
 * where the car is. Measured: 549k triangles per frame against a 250k budget.
 *
 * Bucketing triangles by the XZ cell of their centroid gives the culler something it can
 * actually reject. Geometry and triangle count are unchanged; only the grouping differs.
 *
 * Runs once at stage load.
 */
export function chunkMeshBySpace(mesh: THREE.Mesh, cellSize = 180): THREE.Group {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos) return new THREE.Group().add(mesh);

  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const names = Object.keys(geo.attributes);

  // Bucket triangle ids by cell.
  const cells = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    const cxm = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
    const czm = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
    const key = `${Math.floor(cxm / cellSize)}|${Math.floor(czm / cellSize)}`;

    const list = cells.get(key);
    if (list) list.push(t);
    else cells.set(key, [t]);
  }

  // A single cell means chunking bought nothing; keep the original mesh.
  if (cells.size <= 1) {
    const g = new THREE.Group();
    g.add(mesh);
    return g;
  }

  const group = new THREE.Group();
  group.name = mesh.name ? `${mesh.name}__chunked` : "chunked";

  for (const tris of cells.values()) {
    const out = new THREE.BufferGeometry();

    for (const name of names) {
      const src = geo.attributes[name];
      const itemSize = src.itemSize;
      const arr = new Float32Array(tris.length * 3 * itemSize);
      let w = 0;
      for (const t of tris) {
        for (let c = 0; c < 3; c++) {
          const vi = index ? index.getX(t * 3 + c) : t * 3 + c;
          for (let k = 0; k < itemSize; k++) {
            arr[w++] = (src.array as ArrayLike<number>)[vi * itemSize + k];
          }
        }
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
    }

    out.computeBoundingSphere();
    const chunk = new THREE.Mesh(out, mesh.material);
    chunk.castShadow = mesh.castShadow;
    chunk.receiveShadow = mesh.receiveShadow;
    chunk.renderOrder = mesh.renderOrder;
    group.add(chunk);
  }

  geo.dispose();
  return group;
}
