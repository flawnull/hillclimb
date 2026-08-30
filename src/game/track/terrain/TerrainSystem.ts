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
  /** Retaining walls carrying the road wherever the terrain falls away beneath it. */
  public readonly embankmentMesh: THREE.Group;
  private readonly spline: TrackSpline;

  constructor(spline: TrackSpline) {
    this.spline = spline;
    this.field = createHeightField(spline);
    this.mesh = buildChunkedTerrain(this.field);
    this.riverMesh = chunkMeshBySpace(this.buildRiverMesh(), 250);
    this.vegetationGroup = new THREE.Group();
    buildInstancedVegetation(spline, this.field, this.vegetationGroup);
    this.embankmentMesh = chunkMeshBySpace(this.buildEmbankment(), 250);
  }

  /**
   * Retaining walls beneath the carriageway.
   *
   * The terrain is a heightfield — one height per (x, z) — and a switchback that doubles back
   * over itself cannot be supported by one. Where the upper leg passes over ground that also
   * belongs to the lower leg, the surface can only take a single height: at the upper road's
   * level it buries the lower road, at the lower road's level the upper road floats in the
   * air along with its guardrails. No amount of reweighting the carve fixes this, because it
   * is a limit of the representation rather than a tuning error.
   *
   * Real mountain roads answer this by carrying their own support: the carriageway sits on a
   * retaining wall or embankment built up from the slope. That is what this generates — a
   * skirt dropping from each outer verge edge down to wherever the terrain actually is. It is
   * geometry attached to the ROAD, so the heightfield stays single-valued and legal, and the
   * road is supported no matter what the ground beneath is doing.
   */
  private buildEmbankment(): THREE.Mesh {
    const samples = this.spline.getAllSamples();
    if (samples.length < 2) return new THREE.Mesh();

    /** Below this the verge already meets the ground; a wall would be invisible clutter. */
    const MIN_EXPOSED = 0.6;
    /**
     * Walls deeper than this are a cliff face, not a structure — let the drop read as a drop.
     *
     * 26 m was far too tall: on an exposed section where the ground falls hundreds of metres,
     * the wall became a slab the height of a building filling the view. A retaining wall on a
     * mountain road is metres, not tens of metres. Kept generous enough that most exposed
     * stretches are carried by an embankment — which reads as ground — leaving the viaduct
     * below for the genuine stacked-switchback spans it is meant for.
     */
    const MAX_WALL = 16;
    /** Longitudinal step. The wall only has to follow the road's curve, not its every sample. */
    const STEP = 4;

    /** Depth of the deck edge shown beneath the carriageway on a viaduct span, metres. */
    const DECK_FASCIA = 1.1;
    /** Emit a pier every this many kept samples. Sparse on purpose: a pier every few metres
     *  reads as scaffolding rather than as a viaduct. */
    const PIER_EVERY = 9;

    const verts: number[] = [];
    const indices: number[] = [];
    const piers: { x: number; z: number; top: number; bottom: number }[] = [];

    for (const side of [-1, 1] as const) {
      let strip: { x: number; z: number; top: number; bottom: number }[] = [];

      const flush = () => {
        if (strip.length >= 2) {
          const base = verts.length / 3;
          for (const p of strip) {
            verts.push(p.x, p.top, p.z);
            verts.push(p.x, p.bottom, p.z);
          }
          for (let r = 0; r < strip.length - 1; r++) {
            const a = base + r * 2;
            const b = base + (r + 1) * 2;
            // Wound so the wall faces outward from the road on this side.
            if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
            else indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        strip = [];
      };

      for (let i = 0; i < samples.length; i += STEP) {
        const smp = samples[i];
        // Outer edge of the verge — where the built road actually ends.
        const lat = (smp.halfWidth + 1.2) * side;
        const x = smp.x + smp.normalX * lat;
        const z = smp.z + smp.normalZ * lat;

        const roadEdgeY = smp.y - 0.28;
        const groundY = this.field.heightAt(x, z);
        const exposed = roadEdgeY - groundY;

        if (exposed < MIN_EXPOSED) {
          // Road meets the ground here; end the current wall rather than bridging a gap.
          flush();
          continue;
        }

        // Beyond the wall's reach the road is not on an embankment at all — it is on a
        // viaduct. This is the stacked-switchback case: a single-valued heightfield cannot be
        // beneath the upper leg AND clear of the lower one, so the terrain correctly follows
        // the lower road and the upper road is carried by structure instead. A fascia below
        // the deck plus piers down to the ground is what a real mountain road does here, and
        // it is the only thing that can span a gap of hundreds of metres.
        if (exposed > MAX_WALL) {
          strip.push({ x, z, top: roadEdgeY, bottom: roadEdgeY - DECK_FASCIA });
          if (i % (STEP * PIER_EVERY) === 0) {
            // A pier must land on the ground, and must not pass through a road on its way
            // down. Where a switchback's lower leg runs beneath this span, a column dropped
            // from the deck would spear straight through that carriageway. Real viaducts
            // simply span those bays without a pier, so this one is skipped rather than
            // shortened — a pier stopping in mid-air above the lower road looks worse than
            // no pier at all.
            const deckUnderside = roadEdgeY - DECK_FASCIA;
            const blocked = this.field.index
              .query(x, z, 40)
              .some(
                (h) =>
                  Math.abs(h.lat) <= h.sample.halfWidth + 2.0 &&
                  h.sample.y < deckUnderside - 1.0 &&
                  h.sample.y > groundY + 1.0
              );
            if (!blocked) {
              piers.push({ x, z, top: deckUnderside, bottom: groundY });
            }
          }
          continue;
        }

        strip.push({
          x,
          z,
          top: roadEdgeY,
          bottom: Math.max(groundY, roadEdgeY - MAX_WALL),
        });
      }
      flush();
    }

    // Piers: a square column from the underside of the deck down to the ground.
    //
    // No length cap. Capping at 45 m meant that anywhere the ground was further below than
    // that, the column simply stopped in the air — piers that visibly failed to touch the
    // earth, which is exactly the thing a viaduct exists to avoid. A pier either reaches the
    // ground or is not emitted at all (see the blocking check above).
    for (const p of piers) {
      // Chunky enough to read as a concrete pier at speed rather than as a wire.
      const half = 0.95;
      const bottom = p.bottom;
      const base = verts.length / 3;
      for (const [dx, dz] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
        verts.push(p.x + dx, p.top, p.z + dz);
        verts.push(p.x + dx, bottom, p.z + dz);
      }
      for (let f = 0; f < 4; f++) {
        const a = base + f * 2;
        const b = base + ((f + 1) % 4) * 2;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      // Pale weathered stone. A dark wall reads as a hole in the hillside rather than as
      // masonry, which is the opposite of the problem being solved.
      color: "#9a9187",
      roughness: 0.95,
      metalness: 0.0,
      // Seen from both sides: a wall on the far side of a hairpin is viewed from behind.
      side: THREE.DoubleSide,
    });

    return new THREE.Mesh(geo, mat);
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

    /** Depth of the deck edge shown beneath the carriageway on a viaduct span, metres. */
    const DECK_FASCIA = 1.1;
    /** Emit a pier every this many kept samples. Sparse on purpose: a pier every few metres
     *  reads as scaffolding rather than as a viaduct. */
    const PIER_EVERY = 9;

    const verts: number[] = [];
    const indices: number[] = [];
    const piers: { x: number; z: number; top: number; bottom: number }[] = [];

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

    // Piers: a square column from the underside of the deck down to the ground.
    //
    // No length cap. Capping at 45 m meant that anywhere the ground was further below than
    // that, the column simply stopped in the air — piers that visibly failed to touch the
    // earth, which is exactly the thing a viaduct exists to avoid. A pier either reaches the
    // ground or is not emitted at all (see the blocking check above).
    for (const p of piers) {
      // Chunky enough to read as a concrete pier at speed rather than as a wire.
      const half = 0.95;
      const bottom = p.bottom;
      const base = verts.length / 3;
      for (const [dx, dz] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
        verts.push(p.x + dx, p.top, p.z + dz);
        verts.push(p.x + dx, bottom, p.z + dz);
      }
      for (let f = 0; f < 4; f++) {
        const a = base + f * 2;
        const b = base + ((f + 1) % 4) * 2;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }

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
    for (const root of [this.mesh, this.riverMesh, this.vegetationGroup, this.embankmentMesh]) {
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
