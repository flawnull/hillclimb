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
import { buildChunkedTerrain, buildChunkedTerrainAsync } from "./TerrainMeshBuilder";
import { buildInstancedVegetation } from "../VegetationScatterBuilder";
import { BuildingFootprint } from "../HamletBuilder";

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

  /**
   * Builds the terrain a slice at a time, handing control back to the caller in between.
   *
   * Terrain generation is essentially the whole of a stage's load time — 2.7 s for Borbera
   * Sprint and 3.6 s for Salita di Cosola, against 15-25 ms for vegetation — and being
   * synchronous it stops the browser painting for the duration. Nothing else here is worth
   * slicing; everything but the surface is a rounding error.
   */
  static async createAsync(
    spline: TrackSpline,
    field: HeightField,
    buildings: BuildingFootprint[],
    yieldTo: () => Promise<void>,
    onProgress?: (fraction: number) => void
  ): Promise<TerrainSystem> {
    const mesh = await buildChunkedTerrainAsync(field, yieldTo, onProgress);
    return new TerrainSystem(spline, field, buildings, mesh);
  }

  constructor(
    spline: TrackSpline,
    field?: HeightField,
    buildings: BuildingFootprint[] = [],
    /** A surface already built by `createAsync`. Omitted, the constructor builds its own. */
    prebuiltMesh?: THREE.Group
  ) {
    this.spline = spline;
    // Accepts a field the caller already built, so the renderer can ground roadside buildings
    // on the same terrain without paying to construct it twice.
    this.field = field ?? createHeightField(spline);
    this.mesh = prebuiltMesh ?? buildChunkedTerrain(this.field);
    this.riverMesh = chunkMeshBySpace(this.buildRiverMesh(), 250);
    this.vegetationGroup = new THREE.Group();
    buildInstancedVegetation(spline, this.field, this.vegetationGroup, buildings);
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

    /**
     * Below this the verge effectively meets the ground and no structure is warranted.
     *
     * 0.6 m was too eager: on gently rolling ground the verge sits a little above the terrain
     * almost everywhere, so a wall was drawn along practically the whole route — a continuous
     * grey band flanking the road that read as a thick ugly kerb rather than as the occasional
     * piece of engineering it should be. A road only looks supported where support is
     * plausible; everywhere else the verge should simply meet the grass. Raised again after
     * seeing it in the valley: at two metres of exposure the wall still drew as a broad grey
     * band flanking the road across gently rolling ground, where nothing needs holding up.
     */
    const MIN_EXPOSED = 3.5;
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
    /** Distance between piers along a viaduct span, metres. Sparse on purpose: a pier every
     *  few metres reads as scaffolding rather than as a viaduct. */
    const PIER_SPACING_M = 34;

    /**
     * Structure shorter than this is a stub, and stubs are what the eye picks out.
     *
     * Classifying each node independently meant the exposure crossing MIN_EXPOSED on rolling
     * ground started and stopped the wall repeatedly: measured on Borbera Sprint, half the
     * runs were under 40 m and the shortest was 8 m. On screen that is not a retaining wall,
     * it is a row of detached slabs standing in the grass beside the road. Runs below this
     * length are dropped, and short gaps between runs are closed, so what remains is either a
     * piece of structure long enough to read as one or nothing at all.
     */
    const MIN_RUN_M = 26;
    /** A dip this short does not warrant breaking a wall in two. */
    const MAX_GAP_M = 22;
    /** A wall this tall is kept whatever its run length — see the demotion pass below. */
    const TALL_WALL = 8;

    const nodeSpacing = (this.spline.totalLength / Math.max(1, samples.length - 1)) * STEP;

    const verts: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const piers: { x: number; z: number; top: number; bottom: number }[] = [];

    /**
     * Pushes one vertex colour for the wall tone.
     *
     * `k` darkens toward the foot of a wall — masonry is in its own shadow lower down. On
     * top of that, a sawtooth in world height lays in horizontal courses about a metre
     * apart and a slow lateral wave varies the stone, so a face that is geometrically a
     * flat plane does not read as one. Deterministic in world position, so it is stable
     * across rebuilds and identical on every client.
     */
    const shade = (k: number, x: number, y: number, z: number): void => {
      const grain = Math.sin(x * 0.61 + z * 0.43) * 0.5 + 0.5;
      const f = k * (0.88 + grain * 0.12);
      // Weathered concrete, not fresh render. The old tone (0.604, 0.569, 0.529) was lighter
      // than the sunlit grass around it, so a retaining wall or a pier read as a blank white
      // sheet pasted over the hillside — the brightest thing in the frame, which is the last
      // thing a piece of background engineering should be. Darker and slightly cooler puts it
      // behind the landscape instead of in front of it.
      colors.push(0.44 * f, 0.435 * f, 0.42 * f);
    };

    /**
     * Rows a wall face is split into vertically, and the source of its coursing.
     *
     * Vertex colours only vary AT vertices, so a two-row strip (top edge, bottom edge) has
     * nowhere to put any detail — it interpolates straight through, and a 16 m retaining
     * wall filling the screen beside the road is one flat plane. Splitting the face into
     * rows gives somewhere to put it.
     *
     * The coursing is keyed on the ROW INDEX, not on world height. Keying it on height was
     * the obvious thing and did nothing: rows on a 16 m wall are 2 m apart, so a sawtooth
     * with a metre-scale wavelength is sampled far below its own Nyquist rate and aliases
     * into noise-free mush. Row parity is immune to that by construction, and scales with
     * the wall — courses stay proportional whether the wall is 4 m or 16 m.
     */
    const WALL_ROWS = 8;

    /** 0 = road meets the ground, 1 = retaining wall, 2 = viaduct deck on piers. */
    type Kind = 0 | 1 | 2;
    interface Node {
      x: number;
      z: number;
      top: number;
      groundY: number;
      kind: Kind;
    }

    for (const side of [-1, 1] as const) {
      // --- Pass 1: classify every node on its own ------------------------------------
      const nodes: Node[] = [];
      for (let i = 0; i < samples.length; i += STEP) {
        const smp = samples[i];
        // Outer edge of the verge — where the built road actually ends.
        const lat = (smp.halfWidth + 1.2) * side;
        const x = smp.x + smp.normalX * lat;
        const z = smp.z + smp.normalZ * lat;

        const top = smp.y - 0.28;
        const groundY = this.field.heightAt(x, z);
        const exposed = top - groundY;

        // Beyond the wall's reach the road is not on an embankment at all — it is on a
        // viaduct. This is the stacked-switchback case: a single-valued heightfield cannot
        // be beneath the upper leg AND clear of the lower one, so the terrain correctly
        // follows the lower road and the upper road is carried by structure instead.
        const kind: Kind = exposed < MIN_EXPOSED ? 0 : exposed > MAX_WALL ? 2 : 1;
        nodes.push({ x, z, top, groundY, kind });
      }

      // --- Pass 2: close short gaps, then drop short runs -----------------------------
      const runs = (): { from: number; to: number; kind: Kind }[] => {
        const out: { from: number; to: number; kind: Kind }[] = [];
        for (let i = 0; i < nodes.length; ) {
          let j = i;
          while (j + 1 < nodes.length && nodes[j + 1].kind === nodes[i].kind) j++;
          out.push({ from: i, to: j, kind: nodes[i].kind });
          i = j + 1;
        }
        return out;
      };

      for (const r of runs()) {
        const lengthM = (r.to - r.from + 1) * nodeSpacing;
        const before = r.from > 0 ? nodes[r.from - 1].kind : 0;
        const after = r.to + 1 < nodes.length ? nodes[r.to + 1].kind : 0;
        if (r.kind === 0 && lengthM < MAX_GAP_M && before !== 0 && after !== 0) {
          // A short patch of ground between two pieces of structure: bridge it rather than
          // leaving a notch. A wall reads as continuous; a viaduct only where both sides are.
          const fill: Kind = before === 2 && after === 2 ? 2 : 1;
          for (let i = r.from; i <= r.to; i++) nodes[i].kind = fill;
        }
      }

      for (const r of runs()) {
        if (r.kind === 0) continue;
        // A short VIADUCT run is never dropped. The stub argument applies to a retaining
        // wall — a 10 m piece of masonry standing alone in the grass looks like a detached
        // slab, and the bank it would have held is only a bank. It does not apply here:
        // above MAX_WALL the carriageway is genuinely in mid-air, and removing its deck and
        // piers leaves the road hanging with nothing under it, which is the defect the whole
        // structure pass exists to prevent. Measured on Salita di Cosola, dropping these left
        // 15 verge nodes unsupported, the worst 18.6 m above the ground.
        if (r.kind === 2) continue;
        const lengthM = (r.to - r.from + 1) * nodeSpacing;
        if (lengthM >= MIN_RUN_M) continue;

        // A short run that is also DEEP is not a stub to be dropped — the road there is
        // genuinely well above the ground — but it must not be kept as a wall either.
        // A wall run tapers into the hillside at each end, and over a couple of nodes that
        // taper IS the whole run: the result is a big flat triangle of masonry hanging on
        // the slope, wide at the road and pointed at the bottom, which is exactly the
        // cardboard wedge visible on the hillside above the fourth tornante of Salita di
        // Cosola. What a road actually does over a short deep gap is bridge it, so this
        // becomes a viaduct: a thin deck fascia on piers, which is both honest and small.
        let deepest = 0;
        for (let i = r.from; i <= r.to; i++) {
          const d = nodes[i].top - nodes[i].groundY;
          if (d > deepest) deepest = d;
        }
        if (deepest > TALL_WALL) {
          for (let i = r.from; i <= r.to; i++) nodes[i].kind = 2;
          continue;
        }
        const before = r.from > 0 ? nodes[r.from - 1].kind : 0;
        const after = r.to + 1 < nodes.length ? nodes[r.to + 1].kind : 0;
        // A stub between two walls is a wall; a stub standing on its own is nothing.
        const demoted: Kind = before === 1 || after === 1 ? 1 : 0;
        for (let i = r.from; i <= r.to; i++) nodes[i].kind = demoted;
      }

      // --- Pass 3: emit ----------------------------------------------------------------
      for (const r of runs()) {
        if (r.kind === 0) continue;

        // A wall tapers into the ground at each end rather than stopping at a vertical face,
        // by extending one node past the run with zero height. The viaduct deck does not: it
        // abuts the embankment or the hillside, which is what a real one does.
        const strip: { x: number; z: number; top: number; bottom: number }[] = [];
        const push = (n: Node, bottom: number) => strip.push({ x: n.x, z: n.z, top: n.top, bottom });

        if (r.kind === 1 && r.from > 0) push(nodes[r.from - 1], nodes[r.from - 1].top);
        for (let i = r.from; i <= r.to; i++) {
          const n = nodes[i];
          push(n, r.kind === 2 ? n.top - DECK_FASCIA : Math.max(n.groundY, n.top - MAX_WALL));
        }
        if (r.kind === 1 && r.to + 1 < nodes.length) push(nodes[r.to + 1], nodes[r.to + 1].top);

        const base = verts.length / 3;
        for (const p of strip) {
          for (let row = 0; row <= WALL_ROWS; row++) {
            const f = row / WALL_ROWS;
            const y = p.top + (p.bottom - p.top) * f;
            verts.push(p.x, y, p.z);
            // Darker at the foot — a wall lit by one directional light and painted in a
            // single flat tone reads as cut cardboard however well it is placed — with
            // alternate rows stepped, which is what makes the courses visible.
            shade((1 - f * 0.45) * (row % 2 === 0 ? 1 : 0.84), p.x, y, p.z);
          }
        }
        const stride = WALL_ROWS + 1;
        for (let k = 0; k < strip.length - 1; k++) {
          for (let row = 0; row < WALL_ROWS; row++) {
            const a = base + k * stride + row;
            const b = base + (k + 1) * stride + row;
            // Wound so the wall faces outward from the road on this side.
            if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
            else indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }

        if (r.kind !== 2) continue;

        // Abutments: where a span meets the hillside, close it down to the ground.
        //
        // A pier is skipped wherever one would spear the carriageway passing beneath, which
        // is right — real viaducts span those bays — but a SHORT span above a lower leg can
        // end up with no pier anywhere along it, and then the deck hangs in the air with
        // nothing touching the earth at all. A real bridge springs from the slope at each
        // end. Only drawn where the ground at that end is close enough to reach; a span
        // whose ends are also hundreds of metres up is genuinely a bridge and gets nothing.
        const ABUTMENT_MAX = 14;
        for (const end of [r.from, r.to]) {
          const n = nodes[end];
          const drop = n.top - DECK_FASCIA - n.groundY;
          if (drop <= 0 || drop > ABUTMENT_MAX) continue;
          const inward = end === r.from ? Math.min(r.to, end + 1) : Math.max(r.from, end - 1);
          const m = nodes[inward];
          if (m === n) continue;
          const b = verts.length / 3;
          for (const [a, bottomY] of [
            [n, n.groundY],
            [m, Math.max(m.groundY, m.top - DECK_FASCIA - ABUTMENT_MAX)],
          ] as const) {
            verts.push(a.x, a.top - DECK_FASCIA, a.z);
            shade(0.9, a.x, a.top - DECK_FASCIA, a.z);
            verts.push(a.x, bottomY, a.z);
            shade(0.6, a.x, bottomY, a.z);
          }
          if (side > 0) indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
          else indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }

        // Piers are placed by distance ALONG THIS SPAN, not on a global modulus of the
        // sample index. A modulus left short spans with a fascia band and no columns under
        // it — deck edge hanging in the air with nothing holding it up, which is exactly
        // what the structure exists to avoid showing.
        let sinceLast = Infinity;
        for (let i = r.from; i <= r.to; i++) {
          const n = nodes[i];
          if (sinceLast < PIER_SPACING_M) {
            sinceLast += nodeSpacing;
            continue;
          }
          const deckUnderside = n.top - DECK_FASCIA;
          // A pier must land on the ground, and must not pass through a road on its way
          // down. Where a switchback's lower leg runs beneath this span, a column dropped
          // from the deck would spear straight through that carriageway. Real viaducts
          // simply span those bays without a pier, so this one is skipped rather than
          // shortened — a pier stopping in mid-air above the lower road looks worse than
          // no pier at all. The spacing counter is NOT reset on a skip, so the next
          // unblocked node takes the pier instead of waiting another full span.
          const blocked = this.field.index
            .query(n.x, n.z, 40)
            .some(
              (h) =>
                Math.abs(h.lat) <= h.sample.halfWidth + 2.0 &&
                h.sample.y < deckUnderside - 1.0 &&
                h.sample.y > n.groundY + 1.0
            );
          if (blocked) continue;
          piers.push({ x: n.x, z: n.z, top: deckUnderside, bottom: n.groundY });
          sinceLast = nodeSpacing;
        }
      }
    }

    // Piers: a square column from the underside of the deck down to the ground.
    //
    // No length cap. Capping at 45 m meant that anywhere the ground was further below than
    // that, the column simply stopped in the air — piers that visibly failed to touch the
    // earth, which is exactly the thing a viaduct exists to avoid. A pier either reaches the
    // ground or is not emitted at all (see the blocking check above).
    for (const p of piers) {
      // Chunky enough to read as a concrete pier at speed rather than as a wire, and TAPERED:
      // a bridge pier is wider at the base than at the head, and a plain extruded rectangle
      // is the shape that reads as a blank slab. The taper alone gives the silhouette a
      // direction, which is most of what separates "column" from "sheet" at a glance.
      const halfTop = 0.80;
      const halfBottom = 1.25;
      const bottom = p.bottom;
      const base = verts.length / 3;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        verts.push(p.x + sx * halfTop, p.top, p.z + sz * halfTop);
        shade(1.0, p.x + sx * halfTop, p.top, p.z + sz * halfTop);
        verts.push(p.x + sx * halfBottom, bottom, p.z + sz * halfBottom);
        shade(0.5, p.x + sx * halfBottom, bottom, p.z + sz * halfBottom);
      }
      for (let f = 0; f < 4; f++) {
        const a = base + f * 2;
        const b = base + ((f + 1) % 4) * 2;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      // Pale weathered stone, modulated per vertex (see `shade`). A dark wall reads as a
      // hole in the hillside rather than as masonry, which is the opposite of the problem
      // being solved; a perfectly flat one reads as cardboard.
      vertexColors: true,
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
