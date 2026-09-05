import * as THREE from "three";
import { TrackSpline, SplineSample } from "./TrackSpline";
import { batchStaticGroup, chunkMeshBySpace } from "./batchStatics";
import { createTwoLaneRoadTexture } from "./RoadTextureGenerator";
import { buildRoadsideFurniture } from "./RoadsideFurnitureBuilder";
import { BuildingFootprint } from "./HamletBuilder";

export { createTwoLaneRoadTexture };

export class RoadMesh {
  public mesh: THREE.Group;
  public guardrailGroup: THREE.Group;
  public landmarkGroup: THREE.Group;
  /** Where the hamlet buildings ended up, so the vegetation scatter can keep out of them. */
  public buildingFootprints: BuildingFootprint[];
  private spline: TrackSpline;
  private roadTexture: THREE.CanvasTexture;

  constructor(spline: TrackSpline, groundAt?: (x: number, z: number) => number) {
    this.spline = spline;
    this.guardrailGroup = new THREE.Group();
    this.landmarkGroup = new THREE.Group();
    this.roadTexture = createTwoLaneRoadTexture();
    // Chunked so the frustum culler can reject the 10 km of road behind the car.
    this.mesh = chunkMeshBySpace(this.buildRoadGeometry());
    this.buildingFootprints = buildRoadsideFurniture(
      this.spline.getAllSamples(),
      this.landmarkGroup,
      this.guardrailGroup,
      groundAt
    );

    // Collapse the per-prop meshes into merged per-chunk batches (§13.2). Authoring stays
    // one-prop-at-a-time; drawing does not.
    this.guardrailGroup = batchStaticGroup(this.guardrailGroup);
    this.landmarkGroup = batchStaticGroup(this.landmarkGroup);
  }

  /**
   * Picks which spline samples become road cross-sections (§13.3).
   *
   * The spline emits a sample every ~1.2 m for the physics/Frenet table; the ribbon used
   * every one of them, which on Salita di Cosola is 8,551 cross-sections and 102,600
   * triangles — ~9.5 triangles per metre of a road that is straight for most of its length.
   *
   * A cross-section is emitted when EITHER the heading has turned more than
   * MAX_HEADING_STEP since the last emitted one, or MAX_ARC_STEP of arc length has passed.
   * First and last are always kept, so the ribbon still starts and ends exactly on the
   * spline.
   *
   * The heading test uses ACCUMULATED absolute turn rather than the net difference, so a
   * tight S-bend whose net heading change is ~0 still subdivides.
   *
   * Corner fidelity is unaffected: at a 10.5 m hairpin radius the heading turns
   * ~0.095 rad/m, i.e. 1.5 degrees every 0.28 m — well below the 1.2 m sample step — so
   * every single sample through a hairpin is still emitted and the corners are bit-for-bit
   * the geometry they were before. Only near-straight sections thin out.
   *
   * This touches the MESH only. Collision resolves against the spline in Frenet
   * coordinates, so lap times cannot move.
   */
  private selectSectionIndices(samples: SplineSample[]): number[] {
    /** radians of accumulated turn that forces a new cross-section (~1.5 degrees). */
    const MAX_HEADING_STEP = 1.5 * (Math.PI / 180);
    /** metres of arc length that forces a new cross-section on a straight. */
    const MAX_ARC_STEP = 6.0;

    const last = samples.length - 1;
    const picked: number[] = [0];

    let turnSinceEmit = 0;
    let prevHeading = samples[0].heading;
    let sAtEmit = samples[0].s;

    for (let i = 1; i < last; i++) {
      const h = samples[i].heading;
      // Shortest signed angular difference, so the +/-PI wrap never reads as a full turn.
      let d = h - prevHeading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      prevHeading = h;
      turnSinceEmit += Math.abs(d);

      if (turnSinceEmit >= MAX_HEADING_STEP || samples[i].s - sAtEmit >= MAX_ARC_STEP) {
        picked.push(i);
        turnSinceEmit = 0;
        sAtEmit = samples[i].s;
      }
    }

    if (last > 0) picked.push(last);
    return picked;
  }

  private buildRoadGeometry(): THREE.Mesh {
    const allSamples = this.spline.getAllSamples();
    if (allSamples.length < 2) {
      return new THREE.Mesh();
    }

    const sectionIndices = this.selectSectionIndices(allSamples);
    const startSample = allSamples[0];
    const endSample = allSamples[allSamples.length - 1];

    // Lead-in apron so asphalt cleanly extends behind the start line & camera
    const APRON_STEP = 5.0;
    const APRON_LEN = 30.0;
    const leadIn: SplineSample[] = [];
    for (let d = APRON_LEN; d >= APRON_STEP; d -= APRON_STEP) {
      const tx = Math.sin(startSample.heading) * -1;
      const tz = Math.cos(startSample.heading) * -1;
      leadIn.push({
        ...startSample,
        x: startSample.x + tx * d,
        z: startSample.z + tz * d,
        s: -d,
      });
    }

    const leadOut: SplineSample[] = [];
    for (let d = APRON_STEP; d <= APRON_LEN; d += APRON_STEP) {
      const tx = Math.sin(endSample.heading);
      const tz = Math.cos(endSample.heading);
      leadOut.push({
        ...endSample,
        x: endSample.x + tx * d,
        z: endSample.z + tz * d,
        s: endSample.s + d,
      });
    }

    const samples = [...leadIn, ...sectionIndices.map((i) => allSamples[i]), ...leadOut];
    const numSamples = samples.length;
    if (numSamples < 2) {
      return new THREE.Mesh();
    }

    // 7 vertices per cross section:
    // 0: Left Verge Outer (hw + 1.2m)
    // 1: Left Verge Inner (hw + 0.2m)
    // 2: Left Road Edge (hw)
    // 3: Centerline (0)
    // 4: Right Road Edge (hw)
    // 5: Right Verge Inner (hw + 0.2m)
    // 6: Right Verge Outer (hw + 1.2m)
    const vertsPerSection = 7;
    const vertexCount = numSamples * vertsPerSection;
    const quadCount = (numSamples - 1) * (vertsPerSection - 1);
    const indexCount = quadCount * 6;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);

    const vergeWidth = 1.4;

    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const hw = s.halfWidth;
      const nx = s.normalX;
      const nz = s.normalZ;

      // Up vector influenced by banking
      const sinB = Math.sin(s.bank);
      const cosB = Math.cos(s.bank);
      const upX = -nx * sinB;
      const upY = cosB;
      const upZ = -nz * sinB;

      // Offsets along normal
      const offsets = [
        -(hw + vergeWidth),  // 0: Left verge outer
        -(hw + 0.20),        // 1: Left verge inner
        -hw,                 // 2: Left road edge
        0.0,                 // 3: Centerline
        hw,                  // 4: Right road edge
        hw + 0.20,           // 5: Right verge inner
        hw + vergeWidth,     // 6: Right verge outer
      ];

      // Heights relative to road plane (cambered road with verge shoulder slope)
      const yOffsets = [
        -0.16, // verge drop
        -0.02,
        0.0,
        0.025, // crown at center
        0.0,
        -0.02,
        -0.16, // verge drop
      ];

      // Lateral UV mapping (0..1)
      const uCoords = [0.0, 0.08, 0.11, 0.5, 0.89, 0.92, 1.0];

      for (let j = 0; j < vertsPerSection; j++) {
        const vIdx = i * vertsPerSection + j;
        const off = offsets[j];
        const yOff = yOffsets[j];

        positions[vIdx * 3] = s.x + nx * off + upX * yOff;
        positions[vIdx * 3 + 1] = s.y + upY * yOff + 0.08;
        positions[vIdx * 3 + 2] = s.z + nz * off + upZ * yOff;

        normals[vIdx * 3] = upX;
        normals[vIdx * 3 + 1] = upY;
        normals[vIdx * 3 + 2] = upZ;

        // UVs: V coordinates repeat every 8.5 meters
        uvs[vIdx * 2] = uCoords[j];
        uvs[vIdx * 2 + 1] = s.s * 0.118;

        // Vertex tint (subtle lighting variation)
        const tint = s.surface === "worn" ? 0.94 : 1.0;
        colors[vIdx * 3] = tint;
        colors[vIdx * 3 + 1] = tint;
        colors[vIdx * 3 + 2] = tint;
      }
    }

    // Build Indices
    let idxPtr = 0;
    for (let i = 0; i < numSamples - 1; i++) {
      const row0 = i * vertsPerSection;
      const row1 = (i + 1) * vertsPerSection;

      for (let j = 0; j < vertsPerSection - 1; j++) {
        const a = row0 + j;
        const b = row0 + j + 1;
        const c = row1 + j;
        const d = row1 + j + 1;

        indices[idxPtr++] = a;
        indices[idxPtr++] = c;
        indices[idxPtr++] = b;

        indices[idxPtr++] = b;
        indices[idxPtr++] = c;
        indices[idxPtr++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      roughness: 0.82,
      metalness: 0.08,
      // THE DECK IS A SINGLE SHEET, SO IT MUST BE DRAWN FROM BOTH SIDES.
      //
      // The ribbon above is one surface seven vertices wide with no thickness and no
      // underside — there is no soffit, only a top face wound to face up. At three.js's
      // default `FrontSide` that face is culled the moment it is seen from below, and since
      // nothing else occupies that space the sky shows through: looking up at a switchback
      // above you gave guardrails and kerb markers hanging in mid-air over an empty gap
      // where the carriageway should be. Measured before this change by raycasting the deck
      // from both directions on both stages: visible from above at 120/120 and 98/98 probe
      // points, from below at 0.
      //
      // `DoubleSide` rather than an extruded soffit deliberately. A modelled underside would
      // roughly double the ribbon, and the ribbon is the largest single mesh in the stage —
      // both stages currently sit within about 6,000 triangles of their scene-budget
      // ceilings, so there is no room for it and the road is nowhere thick enough for the
      // edge to read as anything but a line anyway. three.js flips the normal for back faces
      // in the shader, so the underside lights correctly rather than as a black sheet.
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2.0,
      polygonOffsetUnits: -4.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    return mesh;
  }
}
