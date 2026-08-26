/**
 * VAL BORBERA HILLCLIMB — Terrain System
 *
 * Owns everything the landscape draws: the graded-quadtree ground surface, the Borbera
 * riverbed, and the instanced vegetation. All three are grounded on ONE height field, so
 * they cannot disagree about where the ground is.
 */

import * as THREE from "three";
import { TrackSpline, SplineSample } from "../TrackSpline";
import { chunkMeshBySpace } from "../batchStatics";
import { createHeightField, HeightField } from "./heightField";
import { buildChunkedTerrain } from "./TerrainMeshBuilder";
import { buildInstancedVegetation } from "../VegetationScatterBuilder";

/**
 * Flip any triangle that winds clockwise in the XZ plane (as seen from above) so every
 * triangle in the mesh faces upward. An offset ribbon extruded along a curving spline can
 * locally invert its winding on tight turns; without this the renderer's FrontSide
 * culling makes those triangles see-through from above.
 */
function orientTrianglesUpward(geo: THREE.BufferGeometry): number {
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

export class TerrainSystem {
  public readonly field: HeightField;
  public readonly mesh: THREE.Group;
  public readonly riverMesh: THREE.Group;
  public readonly vegetationGroup: THREE.Group;
  private readonly spline: TrackSpline;

  constructor(spline: TrackSpline) {
    this.spline = spline;
    this.field = createHeightField(spline);
    this.mesh = buildChunkedTerrain(this.field);
    this.riverMesh = chunkMeshBySpace(this.buildRiverMesh(), 250);
    this.vegetationGroup = new THREE.Group();
    buildInstancedVegetation(spline, this.field, this.vegetationGroup);
  }

  private buildRiverMesh(): THREE.Mesh {
    // The Borbera runs only in the valley floor of Stage 1. The climb stages have none.
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

    const flushRun = (from: number, to: number, side: -1 | 0 | 1) => {
      if (side === 0) return;
      if (to - from < MIN_RUN) return;

      const base = verts.length / 3;
      for (let i = from; i <= to; i++) {
        const s = samples[i];
        const lat = RIVER_DIST * side;
        const cx = s.x + s.normalX * lat;
        const cz = s.z + s.normalZ * lat;
        // Sit the water on the surface that is actually drawn, at this world point.
        const y = this.field.heightAt(cx, cz) + 0.35;

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

    let runStart = 0;
    let runSide = sideOf(samples[0]);
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

  public dispose(): void {
    for (const root of [this.mesh, this.riverMesh, this.vegetationGroup]) {
      root.traverse((node) => {
        const m = node as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
  }
}
