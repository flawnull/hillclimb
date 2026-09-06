/**
 * VAL BORBERA HILLCLIMB — 3D Car Mesh Builder
 * Procedurally generates high-detail chassis, bodywork, glass, lighting, aerodynamic wings,
 * wheels, brake calipers, slotted discs, and perk glow effects for all 4 vehicle classes.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CarDef } from "../vehicle/cars";

export interface CarMeshResult {
  carGroup: THREE.Group;
  /**
   * Everything that leans on the suspension. The WHEELS ARE NOT IN HERE, deliberately: brake
   * dive and cornering roll belong to the body, and applying them to the whole car drives the
   * outer wheel through the road. See GameRenderer's per-frame attitude update.
   */
  chassisGroup: THREE.Group;
  chassisMesh: THREE.Mesh;
  glassMesh: THREE.Mesh;
  wheelGroups: THREE.Group[];
  brakeLightMeshes: THREE.Mesh[];
  reverseLightMeshes: THREE.Mesh[];
  headlightGlowMeshes: THREE.Mesh[];
  /** Additive halos behind the tail lamps. Opacity is driven by the braking state. */
  brakeGlowMeshes: THREE.Mesh[];
  /** Lamps, housing and plate mounted on the tail. Every one must sit within the bodywork —
   *  see tests/car-model.test.ts. */
  tailPanelMeshes: THREE.Mesh[];
  /** Lamps and grille mounted on the nose, under the same rule. */
  nosePanelMeshes: THREE.Mesh[];
  brakeDiscs: THREE.Mesh[];
  exhaustFlame: THREE.Mesh | null;
  perkGlowMesh: THREE.Mesh | null;
  spoilerGroup: THREE.Group | null;
}

interface Pt2 {
  x: number;
  y: number;
}
interface Pt3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Width of the chamfer taken off the shoulder and roof-rail corners of the body section.
 *
 * The body is lofted through six-point sections, so the shoulder line and roof rail were
 * single hard creases between two large, flat-shaded faces. A hard crease has no face of its
 * own, so it can never catch a highlight — the two panels either side just meet at a step in
 * brightness. Replacing each corner with a narrow strip gives the light something to sit on,
 * which is what reads as a rolled body edge.
 */
const BEVEL_M = 0.038;

/** Ring point indices produced by `halfRing`, from the floor centreline up to the roof centre. */
const R_FLOOR_CENTRE = 0;
const R_SILL = 1;
const R_BELT_LOWER = 2;
const R_BELT_UPPER = 3;
const R_TOP_OUTER = 4;
const R_TOP_INNER = 5;
const R_ROOF_CENTRE = 6;

/** Segment index i spans ring points i..i+1. */
const SEG_UPPER_FLANK = R_BELT_UPPER; // 3 — where the side glass goes
const SEG_ROOF = R_TOP_INNER; // 5 — where the screens go

export class CarMeshBuilder {
  private static radialGlowTexture: THREE.Texture | null = null;
  private static groundShadowTexture: THREE.Texture | null = null;
  private static plateTexture: THREE.Texture | null = null;
  private static environmentTexture: THREE.Texture | null = null;

  /**
   * A 2D canvas, or null when there is no DOM.
   *
   * The generated textures are pure decoration; the geometry is the part worth testing, and
   * the test runner has no canvas. Returning null here (and a flat 1x1 texture from the
   * getters) is what lets `buildCarModel` run head&shy;less at all.
   */
  private static canvas2d(width: number, height: number): CanvasRenderingContext2D | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext("2d");
  }

  private static flatTexture(r: number, g: number, b: number, a: number): THREE.Texture {
    const tex = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  }

  public static getRadialGlowTexture(): THREE.Texture {
    if (CarMeshBuilder.radialGlowTexture) return CarMeshBuilder.radialGlowTexture;

    const size = 128;
    const ctx = CarMeshBuilder.canvas2d(size, size);
    if (!ctx) return (CarMeshBuilder.radialGlowTexture = CarMeshBuilder.flatTexture(255, 255, 255, 255));

    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
    grad.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    CarMeshBuilder.radialGlowTexture = tex;
    return tex;
  }

  public static getGroundShadowTexture(): THREE.Texture {
    if (CarMeshBuilder.groundShadowTexture) return CarMeshBuilder.groundShadowTexture;

    const size = 128;
    const ctx = CarMeshBuilder.canvas2d(size, size);
    if (!ctx) return (CarMeshBuilder.groundShadowTexture = CarMeshBuilder.flatTexture(0, 0, 0, 128));

    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size * 0.48);
    grad.addColorStop(0.0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.45)");
    grad.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    CarMeshBuilder.groundShadowTexture = tex;
    return tex;
  }

  /**
   * Italian-style rear plate: dark border, blue EU band, black characters on white.
   *
   * "GE" is the Genova provincial code the Val Borbera sits under. Generated rather than
   * shipped as an image so the model needs no art asset.
   */
  public static getPlateTexture(): THREE.Texture {
    if (CarMeshBuilder.plateTexture) return CarMeshBuilder.plateTexture;

    const w = 256;
    const h = 68;
    const ctx = CarMeshBuilder.canvas2d(w, h);
    if (!ctx) return (CarMeshBuilder.plateTexture = CarMeshBuilder.flatTexture(240, 240, 240, 255));

    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(3, 3, w - 6, h - 6);

    // EU bands at both ends, as on an Italian plate.
    ctx.fillStyle = "#1b3fa0";
    ctx.fillRect(3, 3, 26, h - 6);
    ctx.fillRect(w - 29, 3, 26, h - 6);
    ctx.fillStyle = "#f6d64a";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("I", 16, h * 0.66);
    ctx.fillText("GE", w - 16, h * 0.66);

    ctx.fillStyle = "#0b0b0d";
    ctx.font = "bold 40px 'Arial Narrow', Arial, sans-serif";
    ctx.fillText("VB 108 BR", w / 2, h / 2 + 2);

    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    CarMeshBuilder.plateTexture = tex;
    return tex;
  }

  /**
   * A tiny equirectangular sky/ground gradient used as the reflection source for the paint,
   * chrome and glass.
   *
   * Clearcoat, metalness and low roughness all describe how a surface REFLECTS ITS
   * SURROUNDINGS. With no environment there is nothing to reflect, so those parameters buy
   * almost nothing: the old body material asked for `metalness: 0.65`, which under punctual
   * lights alone mostly just subtracts diffuse and leaves the paint reading dark and flat —
   * the "flat diffuse blue" look. A 64x32 gradient is enough to fix that, because the only
   * thing the car needs to reflect is a sky, a horizon and some ground.
   *
   * It is assigned per-material rather than as `scene.environment` deliberately: the terrain
   * and the ~43k triangles of vegetation are also standard materials, and they would each pay
   * an extra cube lookup per fragment for a reflection nobody would notice on grass.
   */
  public static getEnvironmentTexture(): THREE.Texture {
    if (CarMeshBuilder.environmentTexture) return CarMeshBuilder.environmentTexture;

    const w = 64;
    const h = 32;
    const ctx = CarMeshBuilder.canvas2d(w, h);
    if (!ctx) {
      const tex = CarMeshBuilder.flatTexture(140, 165, 190, 255);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return (CarMeshBuilder.environmentTexture = tex);
    }

    // Sky above, the scene's own haze colour at the horizon, hillside below.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, "#b9d6ee");
    grad.addColorStop(0.42, "#8fb0cc");
    grad.addColorStop(0.5, "#7891a8");
    grad.addColorStop(0.58, "#5d6a5c");
    grad.addColorStop(1.0, "#3c4438");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // A soft warm sun, so low-roughness surfaces get a moving highlight to roll across
    // rather than a uniform wash. Broad on purpose: this texture is sampled without a PMREM
    // pre-blur, so anything small would read as a hard dot on the paint.
    const sun = ctx.createRadialGradient(w * 0.72, h * 0.2, 0, w * 0.72, h * 0.2, w * 0.22);
    sun.addColorStop(0.0, "rgba(255,247,224,0.95)");
    sun.addColorStop(1.0, "rgba(255,247,224,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    CarMeshBuilder.environmentTexture = tex;
    return tex;
  }

  /**
   * Bakes a set of transformed parts into ONE geometry, carrying each part's colour per
   * vertex so a single material can draw them all.
   *
   * A draw call is not free, and a wheel was eleven to thirteen of them — tyre, tread, dish,
   * lip, hub, cap, disc, caliper and a spoke each. Times four wheels that was around half of
   * the car's 96 meshes, and the car is on screen in every frame of the game. Merging costs
   * nothing at runtime: the parts are rigid relative to each other and spin as a unit, so
   * baking their transforms in loses nothing.
   */
  private static mergeColoured(
    parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: THREE.Color }[]
  ): THREE.BufferGeometry {
    const prepared = parts.map(({ geometry, matrix, color }) => {
      const g = geometry.clone().applyMatrix4(matrix);
      const count = g.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return g;
    });
    // Material colours are already in the renderer's working space, so they can go straight
    // into a vertex attribute; converting again would double the transform.
    const merged = mergeGeometries(prepared, false)!;
    for (const g of prepared) g.dispose();
    return merged;
  }

  public static orientFacesOutward(geo: THREE.BufferGeometry): void {
    const pos = geo.attributes.position.array as ArrayLike<number>;
    const index = geo.index;
    if (!index) return;
    const idx = index.array as Uint16Array | Uint32Array;

    const vertCount = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < vertCount; i++) {
      cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2];
    }
    cx /= vertCount; cy /= vertCount; cz /= vertCount;

    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const px = pos[c * 3], py = pos[c * 3 + 1], pz = pos[c * 3 + 2];

      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = px - ax, e2y = py - ay, e2z = pz - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      const mx = (ax + bx + px) / 3 - cx;
      const my = (ay + by + py) / 3 - cy;
      const mz = (az + bz + pz) / 3 - cz;

      if (nx * mx + ny * my + nz * mz < 0) {
        idx[t + 1] = c;
        idx[t + 2] = b;
      }
    }
    index.needsUpdate = true;
  }

  public static buildCarModel(car: CarDef, colorIndex: number = 0): CarMeshResult {
    const carGroup = new THREE.Group();
    const wheelGroups: THREE.Group[] = [];
    const brakeLightMeshes: THREE.Mesh[] = [];
    const reverseLightMeshes: THREE.Mesh[] = [];
    const headlightGlowMeshes: THREE.Mesh[] = [];
    const brakeGlowMeshes: THREE.Mesh[] = [];
    const brakeDiscs: THREE.Mesh[] = [];
    const tailPanelMeshes: THREE.Mesh[] = [];
    const nosePanelMeshes: THREE.Mesh[] = [];

    const colorway = car.colorways[colorIndex] || car.colorways[0];
    const bodyStyle = colorway.bodyStyle || "coupe";

    const chassisGroup = new THREE.Group();
    const wheelRadius = bodyStyle === "box_utility" ? 0.30 : bodyStyle === "rally_hatch" ? 0.31 : 0.32;
    const wheelWidth = bodyStyle === "sport_mid" ? 0.25 : bodyStyle === "box_utility" ? 0.20 : 0.23;
    chassisGroup.position.set(0, wheelRadius * 0.75, 0);

    const envMap = CarMeshBuilder.getEnvironmentTexture();

    // 1. Physical Materials
    //
    // Automotive paint is a DIELECTRIC basecoat under a clear lacquer, not a metal. The old
    // `metalness: 0.65` tinted the specular reflection by the paint colour and removed most
    // of the diffuse term, which with no environment to reflect just made every car darker
    // and flatter than its colourway. The metallic flake is worth a little, not two thirds.
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: colorway.primary,
      metalness: 0.16,
      roughness: 0.26,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMap,
      envMapIntensity: 0.95,
    });

    const secondaryMat = new THREE.MeshPhysicalMaterial({
      color: colorway.secondary || "#0f172a",
      metalness: 0.2,
      roughness: 0.34,
      clearcoat: 0.85,
      clearcoatRoughness: 0.08,
      envMap,
      envMapIntensity: 0.8,
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: "#0f172a",
      roughness: 0.75,
      metalness: 0.2,
    });

    /** Shut lines and light housings: matte, near-black, and never reflective. */
    const seamMat = new THREE.MeshStandardMaterial({
      color: "#0a0c10",
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      metalness: 0.95,
      roughness: 0.08,
      envMap,
      envMapIntensity: 1.35,
    });

    // Glass is reflection, not transmission.
    //
    // The old material asked for `transmission: 0.45`, which is not a cheap parameter: three
    // renders the whole opaque scene into a separate transmission render target so refracting
    // surfaces have something to sample. That is an extra full pass per frame to look through
    // a window at a car interior this model does not have. Tinted, sharply reflective glass
    // over a dark cabin reads the same from outside and costs a normal blended draw.
    // THE INTERIOR LOOKED EXPOSED BECAUSE THE GLASS WAS TOO BRIGHT, NOT TOO CLEAR.
    //
    // The obvious reading is that a pale cabin shows through, so the tint should be heavier.
    // It is the other way round. Painting the interior magenta and rendering it proves it: the
    // cabin comes back PALE PINK, not magenta, so most of those pixels are the glass, not what
    // is behind it. At `envMapIntensity: 1.9` with full clearcoat and reflectivity the screens
    // were a near-mirror of a bright sky, and raising opacity only handed that bright layer a
    // larger share — the interior got harder to see, and the greenhouse got paler.
    //
    // Dropping the reflection lets the tint carry. What shows through then is a dark cabin,
    // which is what reads as depth; the sheen stays as a highlight rather than a wash.
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#0a1018",
      roughness: 0.05,
      metalness: 0.0,
      reflectivity: 0.5,
      clearcoat: 0.45,
      clearcoatRoughness: 0.06,
      transparent: true,
      opacity: 0.72,
      envMap,
      envMapIntensity: 0.55,
    });

    // 2. Body Sections
    interface BodySection {
      z: number;
      wSill: number;
      ySill: number;
      wBelt: number;
      yBelt: number;
      wTop: number;
      yTop: number;
    }

    let sections: BodySection[];

    if (bodyStyle === "rally_hatch") {
      sections = [
        { z: 1.85, wSill: 1.62, ySill: 0.12, wBelt: 1.56, yBelt: 0.32, wTop: 1.25, yTop: 0.40 },
        { z: 1.20, wSill: 1.82, ySill: 0.22, wBelt: 1.76, yBelt: 0.48, wTop: 1.24, yTop: 0.52 },
        { z: 0.60, wSill: 1.70, ySill: 0.16, wBelt: 1.68, yBelt: 0.48, wTop: 1.24, yTop: 0.56 },
        { z: 0.15, wSill: 1.70, ySill: 0.16, wBelt: 1.68, yBelt: 0.48, wTop: 1.18, yTop: 0.94 },
        { z: -0.65, wSill: 1.70, ySill: 0.16, wBelt: 1.68, yBelt: 0.48, wTop: 1.18, yTop: 0.92 },
        { z: -1.25, wSill: 1.84, ySill: 0.22, wBelt: 1.78, yBelt: 0.50, wTop: 1.24, yTop: 0.88 },
        { z: -1.80, wSill: 1.66, ySill: 0.16, wBelt: 1.60, yBelt: 0.46, wTop: 1.28, yTop: 0.84 },
      ];
    } else if (bodyStyle === "box_utility") {
      sections = [
        { z: 1.75, wSill: 1.50, ySill: 0.18, wBelt: 1.48, yBelt: 0.45, wTop: 1.30, yTop: 0.52 },
        { z: 1.20, wSill: 1.62, ySill: 0.24, wBelt: 1.58, yBelt: 0.50, wTop: 1.24, yTop: 0.56 },
        { z: 0.65, wSill: 1.56, ySill: 0.18, wBelt: 1.54, yBelt: 0.48, wTop: 1.22, yTop: 0.58 },
        { z: 0.20, wSill: 1.56, ySill: 0.18, wBelt: 1.54, yBelt: 0.48, wTop: 1.18, yTop: 1.06 },
        { z: -0.65, wSill: 1.56, ySill: 0.18, wBelt: 1.54, yBelt: 0.48, wTop: 1.18, yTop: 1.06 },
        { z: -1.15, wSill: 1.58, ySill: 0.18, wBelt: 1.56, yBelt: 0.48, wTop: 1.18, yTop: 1.04 },
        { z: -1.30, wSill: 1.62, ySill: 0.24, wBelt: 1.58, yBelt: 0.50, wTop: 1.22, yTop: 0.60 },
        { z: -1.75, wSill: 1.52, ySill: 0.18, wBelt: 1.50, yBelt: 0.46, wTop: 1.35, yTop: 0.56 },
      ];
    } else if (bodyStyle === "sport_mid") {
      sections = [
        { z: 2.10, wSill: 1.54, ySill: 0.10, wBelt: 1.48, yBelt: 0.24, wTop: 1.20, yTop: 0.32 },
        { z: 1.35, wSill: 1.80, ySill: 0.20, wBelt: 1.74, yBelt: 0.40, wTop: 1.18, yTop: 0.44 },
        { z: 0.65, wSill: 1.70, ySill: 0.14, wBelt: 1.68, yBelt: 0.42, wTop: 1.18, yTop: 0.48 },
        { z: 0.15, wSill: 1.70, ySill: 0.14, wBelt: 1.68, yBelt: 0.42, wTop: 1.06, yTop: 0.82 },
        { z: -0.65, wSill: 1.70, ySill: 0.14, wBelt: 1.68, yBelt: 0.42, wTop: 1.06, yTop: 0.80 },
        { z: -1.35, wSill: 1.82, ySill: 0.20, wBelt: 1.76, yBelt: 0.44, wTop: 1.18, yTop: 0.48 },
        { z: -2.10, wSill: 1.64, ySill: 0.12, wBelt: 1.62, yBelt: 0.38, wTop: 1.38, yTop: 0.46 },
      ];
    } else {
      sections = [
        { z: 2.15, wSill: 1.56, ySill: 0.12, wBelt: 1.50, yBelt: 0.26, wTop: 1.25, yTop: 0.35 },
        { z: 1.40, wSill: 1.78, ySill: 0.22, wBelt: 1.72, yBelt: 0.42, wTop: 1.20, yTop: 0.48 },
        { z: 0.70, wSill: 1.68, ySill: 0.15, wBelt: 1.66, yBelt: 0.44, wTop: 1.22, yTop: 0.52 },
        { z: 0.20, wSill: 1.68, ySill: 0.15, wBelt: 1.66, yBelt: 0.44, wTop: 1.10, yTop: 0.90 },
        { z: -0.70, wSill: 1.68, ySill: 0.15, wBelt: 1.66, yBelt: 0.44, wTop: 1.10, yTop: 0.88 },
        { z: -1.35, wSill: 1.78, ySill: 0.22, wBelt: 1.74, yBelt: 0.46, wTop: 1.22, yTop: 0.52 },
        { z: -2.10, wSill: 1.62, ySill: 0.14, wBelt: 1.60, yBelt: 0.40, wTop: 1.42, yTop: 0.52 },
      ];
    }

    // 3. Half-section profile, mirrored across x = 0.
    //
    // WHY THE SHELL IS BUILT AS ONE HALF AND MIRRORED, rather than as a closed six-point ring.
    //
    // The old loft walked a ring of six points and emitted one quad per edge as the triangle
    // pair (0,1,2)+(0,2,3). Read the ring in order and the left flank's corners arrive as
    // sill,sill,belt,belt while the RIGHT flank's arrive as belt,belt,sill,sill — the same
    // band, entered from the other end. That flips which diagonal the quad is split along.
    //
    // A quad only splits identically both ways when it is planar, and almost none of these
    // are: the section profile changes width AND height between rings, so every panel is
    // slightly saddle-shaped. The two sides therefore creased along opposite diagonals, which
    // is visible wherever the profile changes fastest — the C-pillar and the backlight, where
    // the roof drops and the shoulder widens at the same time. Measured on the old geometry:
    // all 64 body triangles and all 16 glass triangles lacked a correctly-wound mirror.
    //
    // Emitting the left half and reflecting each triangle makes symmetry structural rather
    // than something the section table has to be lucky enough to preserve. Covered by
    // tests/car-model.test.ts.

    /** A point `width` metres from `corner` along the edge towards `edgeEnd`, capped so a
     *  chamfer can never eat more than 40% of a short edge. */
    const towards = (corner: Pt2, edgeEnd: Pt2, width: number): Pt2 => {
      const dx = edgeEnd.x - corner.x;
      const dy = edgeEnd.y - corner.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return { x: corner.x, y: corner.y };
      const t = Math.min(width, len * 0.4) / len;
      return { x: corner.x + dx * t, y: corner.y + dy * t };
    };

    const halfRing = (s: BodySection): Pt2[] => {
      const sill = { x: -s.wSill / 2, y: s.ySill };
      const belt = { x: -s.wBelt / 2, y: s.yBelt };
      const top = { x: -s.wTop / 2, y: s.yTop };
      const roofCentre = { x: 0, y: s.yTop };
      return [
        { x: 0, y: s.ySill },              // R_FLOOR_CENTRE
        sill,                              // R_SILL
        towards(belt, sill, BEVEL_M),      // R_BELT_LOWER
        towards(belt, top, BEVEL_M),       // R_BELT_UPPER
        towards(top, belt, BEVEL_M),       // R_TOP_OUTER
        towards(top, roofCentre, BEVEL_M), // R_TOP_INNER
        roofCentre,                        // R_ROOF_CENTRE
      ];
    };

    /**
     * Half-width of a section's profile at height `y`.
     *
     * Anything bolted to the nose or the tail has to fit the panel it sits on, and that panel
     * is whatever the section table happens to say — it is not a constant. Returns 0 above the
     * roofline or below the floor, where the cap has no material at all, so a caller that
     * clamps against this cannot place a part in open air.
     */
    const halfWidthAt = (s: BodySection, y: number): number => {
      if (y <= s.ySill || y >= s.yTop) return 0;
      if (y <= s.yBelt) {
        const t = (y - s.ySill) / Math.max(1e-6, s.yBelt - s.ySill);
        return (s.wSill + (s.wBelt - s.wSill) * t) / 2;
      }
      const t = (y - s.yBelt) / Math.max(1e-6, s.yTop - s.yBelt);
      return (s.wBelt + (s.wTop - s.wBelt) * t) / 2;
    };

    /** Roofline height at an arbitrary z, interpolated between the sections either side.
     *  Anything mounted ON the body needs the surface it stands on, not a constant. */
    const deckHeightAt = (z: number): number => {
      for (let k = 0; k < sections.length - 1; k++) {
        const a = sections[k];
        const b = sections[k + 1];
        if (z <= a.z && z >= b.z) {
          const t = (z - a.z) / (b.z - a.z);
          return a.yTop + (b.yTop - a.yTop) * t;
        }
      }
      return z > sections[0].z ? sections[0].yTop : sections[sections.length - 1].yTop;
    };

    const rings: Pt2[][] = sections.map(halfRing);
    const at = (k: number, i: number): Pt3 => ({ x: rings[k][i].x, y: rings[k][i].y, z: sections[k].z });

    const bodyPositions: number[] = [];
    const bodyIndices: number[] = [];
    const glassPositions: number[] = [];
    const glassIndices: number[] = [];

    const pushTri = (pos: number[], idx: number[], a: Pt3, b: Pt3, c: Pt3) => {
      const base = pos.length / 3;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      idx.push(base, base + 1, base + 2);
    };

    /** Emits a quad on the left half and its reflection. Winding is normalised afterwards by
     *  `orientFacesOutward`, which is mirror-stable: reflecting a triangle negates the x of
     *  both its normal and its offset from the (centreline) centroid, so the sign of their
     *  dot product — and therefore the flip decision — is identical for a mirrored pair. */
    const addQuad = (glass: boolean, p0: Pt3, p1: Pt3, p2: Pt3, p3: Pt3) => {
      const pos = glass ? glassPositions : bodyPositions;
      const idx = glass ? glassIndices : bodyIndices;
      pushTri(pos, idx, p0, p1, p2);
      pushTri(pos, idx, p0, p2, p3);
      const m = (p: Pt3): Pt3 => ({ x: -p.x, y: p.y, z: p.z });
      pushTri(pos, idx, m(p0), m(p3), m(p2));
      pushTri(pos, idx, m(p0), m(p2), m(p1));
    };

    const addTri = (p0: Pt3, p1: Pt3, p2: Pt3) => {
      pushTri(bodyPositions, bodyIndices, p0, p1, p2);
      const m = (p: Pt3): Pt3 => ({ x: -p.x, y: p.y, z: p.z });
      pushTri(bodyPositions, bodyIndices, m(p0), m(p2), m(p1));
    };

    for (let k = 0; k < sections.length - 1; k++) {
      for (let seg = 0; seg < R_ROOF_CENTRE; seg++) {
        let glass = false;
        if (seg === SEG_UPPER_FLANK) {
          glass = k >= 2 && k <= 4; // side windows
        } else if (seg === SEG_ROOF) {
          // Windscreen, then the backlight — which a van does not get, its roof runs on.
          glass = k === 2 || (k === 4 && bodyStyle !== "box_utility");
        }
        addQuad(glass, at(k, seg), at(k + 1, seg), at(k + 1, seg + 1), at(k, seg + 1));
      }
    }

    // Front & rear caps: a fan from the floor centreline around the half ring, mirrored.
    for (const k of [0, sections.length - 1]) {
      for (let i = R_SILL; i < R_ROOF_CENTRE; i++) {
        addTri(at(k, R_FLOOR_CENTRE), at(k, i), at(k, i + 1));
      }
    }

    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute("position", new THREE.Float32BufferAttribute(bodyPositions, 3));
    bodyGeo.setIndex(bodyIndices);
    CarMeshBuilder.orientFacesOutward(bodyGeo);
    bodyGeo.computeVertexNormals();
    const chassisMesh = new THREE.Mesh(bodyGeo, bodyMat);
    chassisMesh.castShadow = true;
    chassisMesh.receiveShadow = true;
    chassisGroup.add(chassisMesh);

    const glassGeo = new THREE.BufferGeometry();
    glassGeo.setAttribute("position", new THREE.Float32BufferAttribute(glassPositions, 3));
    glassGeo.setIndex(glassIndices);
    CarMeshBuilder.orientFacesOutward(glassGeo);
    glassGeo.computeVertexNormals();
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    chassisGroup.add(glassMesh);

    // AN INTERIOR LINER, NOT A BOX IN THE MIDDLE.
    //
    // The greenhouse is a shell with nothing inside it, so the player sees the road THROUGH
    // the car — and, from behind, the far wheel through the far window. No amount of tinting
    // fixes that: tint darkens what is behind the glass, and what was behind the glass was
    // more scenery.
    //
    // A single box between the two middle sections does not fix it either, which is what was
    // here before. The glazed run is sections 2 to 5 — windscreen, both side windows and the
    // backlight — and a box that spans only 3 to 4 leaves the ends of that run open. Sight
    // lines enter through the front of one side window and leave through the front of the
    // other, which is exactly the "you can see the wheels from the inside" case.
    //
    // So the liner follows the section table across the whole glazed span, inset a couple of
    // centimetres, with its roof tracking the real roofline as it rises and falls. It is one
    // closed shell: nothing can look past it in any direction.
    //
    // UNLIT ON PURPOSE. A lit box has a top face and the sun finds it through the backlight;
    // however dark the colour, a horizontal surface in full sun returns mid-grey and reads as
    // a slab where an interior should be. A car interior is in shadow at all times, so
    // `MeshBasicMaterial` is the correct response to the light here, not a shortcut. It still
    // takes fog, so it recedes with the rest of the car.
    const LINER_FIRST = 2;
    const LINER_LAST = Math.min(5, sections.length - 2);
    const linerMat = new THREE.MeshBasicMaterial({ color: "#0c0f13", side: THREE.DoubleSide });
    {
      const pos: number[] = [];
      const idx: number[] = [];
      const quad = (a: Pt3, b: Pt3, c: Pt3, d: Pt3) => {
        const base = pos.length / 3;
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };

      /**
       * The liner's cross-section at one section: THE BODY'S OWN PROFILE, shrunk slightly.
       *
       * A rectangle inscribed in the cabin does not work, and that is what was here. The
       * opening is a trapezoid — wide at the belt, narrow at the roof — so a box that fits
       * inside it at the roof leaves triangular gaps at the shoulders, and a sight line
       * entering one of those goes clean through the car. Magenta-testing the old liner showed
       * it covering the backlight and missing the whole front of the greenhouse, which is
       * where the wheel was showing through.
       *
       * Taking the same ring the bodywork is lofted from and scaling it about the cabin's own
       * centre keeps the SHAPE, so the liner sits just inside the glass everywhere along it
       * with no corner to leak through.
       */
      const linerRing = (k: number): Pt3[] => {
        const ring = rings[k];
        const z = sections[k].z;
        const midY = (ring[R_BELT_LOWER].y + ring[R_ROOF_CENTRE].y) / 2;
        const shrink = 0.93;
        const pull = (pt: Pt2, mirror: number): Pt3 => ({
          x: mirror * pt.x * shrink,
          y: midY + (pt.y - midY) * shrink,
          z,
        });
        const out: Pt3[] = [];
        // Up the left side, from the shoulder to the roof centre...
        for (let i = R_BELT_LOWER; i <= R_ROOF_CENTRE; i++) out.push(pull(ring[i], 1));
        // ...and back down the right, skipping the centre point the two sides share.
        for (let i = R_ROOF_CENTRE - 1; i >= R_BELT_LOWER; i--) out.push(pull(ring[i], -1));
        return out;
      };

      for (let k = LINER_FIRST; k < LINER_LAST; k++) {
        const a = linerRing(k);
        const b = linerRing(k + 1);
        for (let i = 0; i < a.length; i++) {
          const j = (i + 1) % a.length;
          quad(a[i], b[i], b[j], a[j]);
        }
      }
      // Close both ends, or the shell is a tube and you can see straight down it.
      for (const k of [LINER_FIRST, LINER_LAST]) {
        const ring = linerRing(k);
        for (let i = 1; i < ring.length - 1; i++) {
          const base = pos.length / 3;
          pos.push(
            ring[0].x, ring[0].y, ring[0].z,
            ring[i].x, ring[i].y, ring[i].z,
            ring[i + 1].x, ring[i + 1].y, ring[i + 1].z
          );
          idx.push(base, base + 1, base + 2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      chassisGroup.add(new THREE.Mesh(geo, linerMat));
    }

    const frontZ = sections[0].z;
    const rearZ = sections[sections.length - 1].z;

    // 4. Panel shut lines.
    //
    // A real car is assembled from separate pressings, and the dark line where two of them
    // meet is most of what tells the eye it is looking at a machine rather than a solid.
    // Each seam is a narrow dark ribbon following the section ring it sits on, lifted a few
    // millimetres proud of the skin so it cannot z-fight with the panel underneath.
    const addShutLine = (sectionIndex: number) => {
      const ring = rings[sectionIndex];
      const z = sections[sectionIndex].z;
      const halfDepth = 0.008;
      const proud = 0.006;
      const positions: number[] = [];
      const indices: number[] = [];
      for (let i = R_SILL; i < R_ROOF_CENTRE; i++) {
        // Outward normal of this ring edge, in the section plane.
        const dx = ring[i + 1].x - ring[i].x;
        const dy = ring[i + 1].y - ring[i].y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (dy / len) * proud;
        const ny = (-dx / len) * proud;
        // The ring is walked from the floor upwards on the left, so (dy, -dx) points away
        // from the body on that side.
        for (const p of [ring[i], ring[i + 1]]) {
          for (const side of [-1, 1] as const) {
            for (const mirror of [1, -1] as const) {
              positions.push(mirror * (p.x + nx), p.y + ny, z + side * halfDepth);
            }
          }
        }
      }
      // Stitch: vertices are laid out as [a-, a+, b-, b+] per ring point pair, four per
      // point-side; build one quad per (edge, mirror).
      const perEdge = 8;
      for (let e = 0; e * perEdge < positions.length / 3; e++) {
        const o = e * perEdge;
        for (const mirror of [0, 1]) {
          const v = [o + mirror, o + 2 + mirror, o + 6 + mirror, o + 4 + mirror];
          indices.push(v[0], v[1], v[2], v[0], v[2], v[3]);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      chassisGroup.add(new THREE.Mesh(geo, seamMat));
    };
    // Bonnet/wing shut at the base of the windscreen, boot shut at the base of the backlight.
    addShutLine(2);
    addShutLine(sections.length - 2);

    // Side Mirrors
    const mirrorGeo = new THREE.BoxGeometry(0.14, 0.08, 0.10);
    const mirrorL = new THREE.Mesh(mirrorGeo, secondaryMat);
    mirrorL.position.set(-sections[2].wBelt / 2 - 0.08, sections[2].yBelt + 0.04, sections[2].z + 0.08);
    const mirrorR = new THREE.Mesh(mirrorGeo, secondaryMat);
    mirrorR.position.set(sections[2].wBelt / 2 + 0.08, sections[2].yBelt + 0.04, sections[2].z + 0.08);
    chassisGroup.add(mirrorL, mirrorR);

    /** Emissive lamp material. `toneMapped: false` keeps the lens out of the ACES curve, so a
     *  lit lamp stays a saturated light source instead of being rolled off towards white with
     *  the rest of the frame. */
    const lampMat = (color: string, emissive: string, intensity: number) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: intensity,
        roughness: 0.1,
        toneMapped: false,
      });

    // THE NOSE LAMPS ARE SIZED FROM THE NOSE, exactly as the tail cluster is.
    //
    // They were fixed radii: a 0.12 m lens inside a 0.135 m chrome ring, sitting at y = 0.30.
    // The mid-engined car's nose runs from 0.10 to 0.32, so it is 0.22 m tall — a 0.27 m ring
    // cannot fit in it at any height, and the lamps stood proud of the bonnet, visible over the
    // nose from behind the car. The four noses differ by 12 cm in height, so this cannot be a
    // constant any more than the tail could.
    const frontSection = sections[0];
    const noseHeight = frontSection.yTop - frontSection.ySill;
    /** Outer lens radius. The ring around it is 13% larger, matching the original proportion. */
    const hlRadius = Math.min(0.12, noseHeight * 0.30);
    const hlRingRadius = hlRadius * 1.13;
    /** High in the nose, but with the ring's full height clear of the bonnet edge. */
    const hlY = Math.max(
      frontSection.ySill + hlRingRadius + 0.015,
      frontSection.yTop - hlRingRadius - 0.015
    );
    /** Furthest a lamp of this size can sit from the centreline and stay on the nose. */
    const hlMaxOffset =
      Math.min(
        halfWidthAt(frontSection, hlY - hlRingRadius),
        halfWidthAt(frontSection, hlY + hlRingRadius)
      ) - hlRingRadius - 0.02;
    /** Pulls an authored offset in until the lamp fits, keeping its side. */
    const hlFit = (offX: number, radius: number) => {
      const room = Math.max(0.02, hlMaxOffset + (hlRingRadius - radius * 1.13));
      return Math.sign(offX) * Math.min(Math.abs(offX), room);
    };

    // Front Grilles & Lights by Body Style
    if (bodyStyle === "rally_hatch") {
      const podRimGeo = new THREE.CylinderGeometry(hlRingRadius, hlRingRadius, 0.04, 14);
      const podLensGeo = new THREE.CylinderGeometry(hlRadius, hlRadius, 0.06, 14);
      const podMat = lampMat("#fef08a", "#facc15", 1.6);

      for (const raw of [-0.48, -0.18, 0.18, 0.48]) {
        const offX = hlFit(raw, hlRadius);
        const podRim = new THREE.Mesh(podRimGeo, chromeMat);
        podRim.rotation.x = Math.PI / 2;
        podRim.position.set(offX, hlY, frontZ + 0.03);

        const pod = new THREE.Mesh(podLensGeo, podMat);
        pod.rotation.x = Math.PI / 2;
        pod.position.set(offX, hlY, frontZ + 0.06);
        chassisGroup.add(podRim, pod);
        headlightGlowMeshes.push(pod);
        nosePanelMeshes.push(podRim, pod);
      }

      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.40), trimMat);
      scoop.position.set(0, sections[3].yTop + 0.06, 0.0);
      chassisGroup.add(scoop);

      // Behind the rear wheel and hanging DOWN from the arch. They used to sit outboard of
      // the sill at y = 0.04, which put their lower half below the road and left them reading
      // as red panels floating beside the car.
      const flapMat = new THREE.MeshStandardMaterial({ color: "#dc2626", roughness: 0.5 });
      const flapGeo = new THREE.BoxGeometry(0.24, 0.26, 0.02);
      for (const side of [-1, 1]) {
        const flap = new THREE.Mesh(flapGeo, flapMat);
        flap.position.set(
          side * (sections[5].wSill / 2 - 0.06),
          // chassisGroup is lifted onto the suspension, so y = 0 here is not the road.
          0.15 - chassisGroup.position.y + 0.13,
          sections[5].z - 0.30
        );
        chassisGroup.add(flap);
      }
    } else if (bodyStyle === "box_utility") {
      const bullBar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 0.08), trimMat);
      bullBar.position.set(0, 0.32, frontZ + 0.05);

      const safariRimGeo = new THREE.CylinderGeometry(hlRingRadius, hlRingRadius, 0.04, 14);
      const safariLensGeo = new THREE.CylinderGeometry(hlRadius, hlRadius, 0.06, 14);
      const safariMat = lampMat("#fef08a", "#facc15", 1.5);

      for (const raw of [-0.35, 0.35]) {
        const offX = hlFit(raw, hlRadius);
        const sfRim = new THREE.Mesh(safariRimGeo, chromeMat);
        sfRim.rotation.x = Math.PI / 2;
        sfRim.position.set(offX, hlY, frontZ + 0.06);

        const sf = new THREE.Mesh(safariLensGeo, safariMat);
        sf.rotation.x = Math.PI / 2;
        sf.position.set(offX, hlY, frontZ + 0.09);
        chassisGroup.add(sfRim, sf);
        headlightGlowMeshes.push(sf);
        nosePanelMeshes.push(sfRim, sf);
      }
      chassisGroup.add(bullBar);

      const rack = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.06, 1.20), trimMat);
      rack.position.set(0, sections[3].yTop + 0.04, -0.45);
      const spareTire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.18, 14),
        new THREE.MeshStandardMaterial({ color: "#18181b", roughness: 0.9 })
      );
      spareTire.position.set(0, sections[3].yTop + 0.14, -0.45);
      chassisGroup.add(rack, spareTire);
    } else if (bodyStyle === "sport_mid") {
      const hlMat = lampMat("#f8fafc", "#bae6fd", 1.8);
      const innerRadius = hlRadius * 0.75;
      const hlGeoOuter = new THREE.CylinderGeometry(hlRadius, hlRadius, 0.04, 14);
      const hlGeoInner = new THREE.CylinderGeometry(innerRadius, innerRadius, 0.04, 14);
      const ringGeoOuter = new THREE.CylinderGeometry(hlRingRadius, hlRingRadius, 0.02, 14);
      const ringGeoInner = new THREE.CylinderGeometry(innerRadius * 1.13, innerRadius * 1.13, 0.02, 14);

      for (const [raw, isOuter] of [[-0.52, true], [0.52, true], [-0.22, false], [0.22, false]] as [number, boolean][]) {
        const radius = isOuter ? hlRadius : innerRadius;
        const offX = hlFit(raw, radius);
        const ring = new THREE.Mesh(isOuter ? ringGeoOuter : ringGeoInner, chromeMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(offX, hlY, frontZ + 0.02);

        const hl = new THREE.Mesh(isOuter ? hlGeoOuter : hlGeoInner, hlMat);
        hl.rotation.x = Math.PI / 2;
        hl.position.set(offX, hlY, frontZ + 0.04);
        chassisGroup.add(ring, hl);
        headlightGlowMeshes.push(hl);
        nosePanelMeshes.push(ring, hl);
      }
    } else {
      // Grille height follows the nose too — a 0.20 m kidney on a 0.23 m nose overhung it.
      const grilleH = Math.min(0.16, noseHeight * 0.55);
      const kidneyH = Math.min(0.20, noseHeight * 0.68);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.95, grilleH, 0.04), trimMat);
      grille.position.set(0, hlY, frontZ + 0.02);
      const kidneys: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const kidney = new THREE.Mesh(new THREE.BoxGeometry(0.16, kidneyH, 0.05), chromeMat);
        kidney.position.set(side * 0.11, hlY, frontZ + 0.03);
        kidneys.push(kidney);
      }
      chassisGroup.add(grille, ...kidneys);
      nosePanelMeshes.push(grille, ...kidneys);

      const hlMat = lampMat("#f8fafc", "#dbeafe", 2.0);
      const hlGeo = new THREE.CylinderGeometry(hlRadius, hlRadius, 0.04, 14);
      const hlRingGeo = new THREE.CylinderGeometry(hlRingRadius, hlRingRadius, 0.02, 14);

      for (const raw of [-0.54, 0.54]) {
        const offX = hlFit(raw, hlRadius);
        const ring = new THREE.Mesh(hlRingGeo, chromeMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(offX, hlY, frontZ + 0.02);

        const hl = new THREE.Mesh(hlGeo, hlMat);
        hl.rotation.x = Math.PI / 2;
        hl.position.set(offX, hlY, frontZ + 0.04);
        chassisGroup.add(ring, hl);
        headlightGlowMeshes.push(hl);
        nosePanelMeshes.push(ring, hl);
      }
    }

    // 5. Rear lamps, set into a housing, SIZED FROM THE TAIL THEY ARE MOUNTED ON.
    //
    // A lens flush with the bumper skin reads as a sticker. The body shell is closed at
    // `rearZ`, so a true cavity would mean cutting the rear cap; instead the housing bezel
    // stands about a centimetre PROUDER than the lens it surrounds, which produces the same
    // shading cue — a dark rim with the lit surface sunk behind it.
    //
    // The dimensions cannot be constants. Four body styles share this code and their tails
    // differ by a lot: a fixed 1.50 x 0.15 housing at y = 0.44 overhung the coupe's tail by
    // 3.6 cm and the van's by 4.1 cm, and on the mid-engined car — whose tail panel stops at
    // y = 0.46 — the top third of it sat at a height where the bodywork has no material at
    // all, hanging in open air beside the car. Under roll it swings clear of the silhouette
    // and reads as a bite taken out of the rear quarter.
    // THE WHOLE CLUSTER IS LAID OUT AGAINST THE TAIL'S HEIGHT, TOP DOWN.
    //
    // The four tails are not the same depth: the van's runs 0.18 m to 0.56 m, the mid-engined
    // car's only 0.12 m to 0.46 m. A lamp housing and a number plate at fixed sizes do not
    // both fit in 0.34 m, which is how the exhaust tips ended up crossing the plate on the
    // blue car. Sizing each feature as a fraction of the tail and stacking them from the deck
    // edge downwards makes the layout hold on all four.
    const rearSection = sections[sections.length - 1];
    const LAMP_CLEARANCE = 0.03;
    const tailBottom = rearSection.ySill;
    const tailHeight = rearSection.yTop - tailBottom;

    const lampRadius = Math.min(0.09, tailHeight * 0.20);
    const housingHalfH = lampRadius + Math.min(0.024, tailHeight * 0.05);
    const plateH = Math.min(0.12, tailHeight * 0.30);
    const plateRecessH = plateH + 0.045;

    const lampY = Math.min(0.44, rearSection.yTop - housingHalfH - 0.012);
    // Measured at the housing's full vertical extent, so its narrowest point still fits.
    const lampHalfSpan =
      Math.min(
        halfWidthAt(rearSection, lampY - housingHalfH),
        halfWidthAt(rearSection, lampY + housingHalfH)
      ) - LAMP_CLEARANCE;
    const lampOffsetX = Math.min(0.56, lampHalfSpan - lampRadius - 0.02);

    // THE HOUSING IS EXTRUDED WITH THE LENS OPENINGS CUT OUT OF IT.
    //
    // A box with cylinders laid on top of it is two primitives sharing a volume, and it reads
    // as exactly that: the round lenses poked out above and below the bar's edges with a hard
    // intersection line across them, because nothing was actually cut. `Shape` takes holes and
    // `ExtrudeGeometry` triangulates around them, so the openings are real: the lens sits
    // INSIDE the trim, its rim hidden by the housing wall, which is what makes it read as a
    // light unit rather than a sticker with a disc on it.
    //
    // The bar's own aperture is cut the same way, so the whole cluster is one dark surface
    // with three windows in it.
    const barHalfH = Math.max(0.022, housingHalfH - 0.048);
    const barHalfW = Math.max(0.12, lampOffsetX - lampRadius - 0.035);

    const housingShape = new THREE.Shape();
    housingShape.moveTo(-lampHalfSpan, -housingHalfH);
    housingShape.lineTo(lampHalfSpan, -housingHalfH);
    housingShape.lineTo(lampHalfSpan, housingHalfH);
    housingShape.lineTo(-lampHalfSpan, housingHalfH);
    housingShape.closePath();

    for (const side of [-1, 1]) {
      const hole = new THREE.Path();
      hole.absarc(side * lampOffsetX, 0, lampRadius, 0, Math.PI * 2, true);
      housingShape.holes.push(hole);
    }
    const barHole = new THREE.Path();
    barHole.moveTo(-barHalfW, -barHalfH);
    barHole.lineTo(-barHalfW, barHalfH);
    barHole.lineTo(barHalfW, barHalfH);
    barHole.lineTo(barHalfW, -barHalfH);
    barHole.closePath();
    housingShape.holes.push(barHole);

    const housingGeo = new THREE.ExtrudeGeometry(housingShape, {
      depth: 0.055,
      bevelEnabled: false,
      curveSegments: 14,
    });
    // Extrude runs along +z from the shape plane; put the mouth at the back of the car.
    housingGeo.translate(0, 0, -0.055);
    const tlHousing = new THREE.Mesh(housingGeo, seamMat);
    tlHousing.position.set(0, lampY, rearZ - 0.002);
    chassisGroup.add(tlHousing);

    const tlMat = lampMat("#ef4444", "#7f1d1d", 1.0);
    tlMat.roughness = 0.2;

    // Lenses are set back inside their openings rather than laid over the trim, so the
    // housing wall shades them at the edge.
    const lensZ = rearZ - 0.040;
    const tlBar = new THREE.Mesh(
      new THREE.BoxGeometry(barHalfW * 2 - 0.004, barHalfH * 2 - 0.004, 0.02),
      tlMat
    );
    tlBar.position.set(0, lampY, lensZ);
    chassisGroup.add(tlBar);

    const tlRoundGeo = new THREE.CylinderGeometry(lampRadius - 0.004, lampRadius - 0.004, 0.02, 14);
    const tlL = new THREE.Mesh(tlRoundGeo, tlMat);
    tlL.rotation.x = Math.PI / 2;
    tlL.position.set(-lampOffsetX, lampY, lensZ);
    const tlR = new THREE.Mesh(tlRoundGeo, tlMat);
    tlR.rotation.x = Math.PI / 2;
    tlR.position.set(lampOffsetX, lampY, lensZ);
    chassisGroup.add(tlL, tlR);
    brakeLightMeshes.push(tlBar, tlL, tlR);
    tailPanelMeshes.push(tlHousing, tlBar, tlL, tlR);

    // Additive halos around the lamps.
    //
    // This is what a bloom pass would be bought for, without the pass. A full-screen bloom
    // means an extra bright-pass plus several blur iterations over the whole framebuffer
    // every frame, and this project is currently fill-rate limited, not short of ideas for
    // where to spend a millisecond. Two additive quads give the same halo around the only
    // emitters that ever needed one.
    const glowTex = CarMeshBuilder.getRadialGlowTexture();
    const glowGeo = new THREE.PlaneGeometry(0.62, 0.42);
    for (const offX of [-lampOffsetX, lampOffsetX]) {
      const glow = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({
          color: "#ff2d2d",
          map: glowTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      glow.position.set(offX, lampY, rearZ - 0.075);
      glow.renderOrder = 3;
      chassisGroup.add(glow);
      brakeGlowMeshes.push(glow);
    }

    // Reversing Lights
    const revMat = lampMat("#f8fafc", "#ffffff", 0.0);
    revMat.roughness = 0.2;
    const revGeo = new THREE.BoxGeometry(0.12, 0.06, 0.03);
    const revL = new THREE.Mesh(revGeo, revMat);
    revL.position.set(-0.28, lampY, rearZ - 0.030);
    const revR = new THREE.Mesh(revGeo, revMat);
    revR.position.set(0.28, lampY, rearZ - 0.030);
    chassisGroup.add(revL, revR);
    reverseLightMeshes.push(revL, revR);
    tailPanelMeshes.push(revL, revR);

    // License Plate, sunk into a dark surround by the same bezel trick as the lamps.
    // Stacked directly beneath the housing, then pushed back up if that would hang it below
    // the tail's lower edge. On a shallow tail the two clamps meet, which is the tightest the
    // panel can be packed and still hold both features.
    const plateY = Math.max(
      tailBottom + plateRecessH / 2 + 0.005,
      lampY - housingHalfH - 0.014 - plateRecessH / 2
    );
    const plateRecess = new THREE.Mesh(new THREE.BoxGeometry(0.50, plateRecessH, 0.04), seamMat);
    plateRecess.position.set(0, plateY, rearZ - 0.018);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, plateH),
      new THREE.MeshStandardMaterial({
        map: CarMeshBuilder.getPlateTexture(),
        roughness: 0.45,
        metalness: 0.0,
      })
    );
    plate.rotation.y = Math.PI;
    plate.position.set(0, plateY, rearZ - 0.039);
    chassisGroup.add(plateRecess, plate);
    tailPanelMeshes.push(plateRecess, plate);

    // Exhausts.
    //
    // A capped cylinder is a chrome peg. A real tailpipe is a tube: the outer wall catches a
    // highlight, and the bore behind it stays black however bright the scene gets.
    const makeExhaust = (radius: number, length: number): THREE.Group => {
      const group = new THREE.Group();
      const outer = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, 12, 1, true),
        chromeMat
      );
      const bore = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.78, radius * 0.78, length * 0.96, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: "#0a0a0b", roughness: 0.85, side: THREE.BackSide })
      );
      const floorDisc = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.78, 12),
        new THREE.MeshStandardMaterial({ color: "#08080a", roughness: 0.95 })
      );
      floorDisc.rotation.x = Math.PI / 2;
      floorDisc.position.y = -length * 0.36;
      group.add(outer, bore, floorDisc);
      group.rotation.x = Math.PI / 2;
      return group;
    };

    // Tips are kept clear of the plate SIDEWAYS, not by height.
    //
    // The twin pipes sat at x = +/-0.08, directly under the plate's centre, and on the blue
    // car the plate had to drop far enough down the shallow tail that the tips crossed
    // straight through it. There is no height that works on every tail — the plate moves with
    // the panel — but there is always room outboard of a 0.44 m plate, so that is where they
    // go. `exhaustClearX` is the first x at which a tip of that radius cannot touch it.
    const plateHalfWidth = 0.25;
    const exhaustClearX = (radius: number) => plateHalfWidth + radius + 0.05;
    const exhaustY = Math.max(tailBottom + 0.03, plateY - plateRecessH / 2 - 0.02);

    // Short, and mostly buried. A tip that stands 0.2 m clear of the bumper is a chrome rod
    // hanging in space; the visible part should be about a hand's width. `pipeZ` puts the
    // pipe's mouth at rearZ + 0.02 - length, i.e. just the last few centimetres showing.
    const pipeZ = (length: number) => rearZ + 0.02 - length / 2;

    if (bodyStyle === "sport_mid") {
      const r = 0.04;
      for (const side of [-1, 1]) {
        const pipe = makeExhaust(r, 0.16);
        pipe.position.set(side * exhaustClearX(r), exhaustY, pipeZ(0.16));
        chassisGroup.add(pipe);
      }
    } else if (bodyStyle === "rally_hatch") {
      const r = 0.065;
      const pipe = makeExhaust(r, 0.18);
      pipe.position.set(-Math.max(0.48, exhaustClearX(r)), exhaustY, pipeZ(0.18));
      chassisGroup.add(pipe);
    } else {
      const r = 0.045;
      for (const side of [-1, 1]) {
        const pipe = makeExhaust(r, 0.18);
        pipe.position.set(side * Math.max(0.42, exhaustClearX(r)), exhaustY, pipeZ(0.18));
        chassisGroup.add(pipe);
      }
    }

    // Exhaust Flame
    const flameGeo = new THREE.ConeGeometry(0.12, 0.45, 8);
    const flameMat = new THREE.MeshBasicMaterial({
      color: "#f97316",
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(bodyStyle === "rally_hatch" ? -0.48 : bodyStyle === "sport_mid" ? 0 : -0.42, 0.16, rearZ - 0.32);
    chassisGroup.add(flame);

    // Spoilers
    let spoilerGroup: THREE.Group | null = null;
    if (bodyStyle === "rally_hatch") {
      // THE WING IS BOLTED TO THE DECKLID, NOT FLOATED ABOVE IT.
      //
      // The mount was `sections[3].yTop + 0.08` — the height of the ROOF, at a z that is
      // most of a metre behind the roof, where the body has already dropped away. The strut
      // feet ended up 0.15 m clear of the decklid with nothing under them, so the aero read
      // as two blocks and a plank hanging in the air behind the car.
      const mountZ = rearZ + 0.15;
      spoilerGroup = new THREE.Group();
      spoilerGroup.position.set(0, deckHeightAt(mountZ), mountZ);

      // A slab has no leading edge, so it cannot read as a wing from any angle. This is a
      // cambered wedge: thick a little way back from the leading edge, tapering to a thin
      // trailing edge, extruded across the span and set at a few degrees of incidence.
      const chord = 0.36;
      const span = 1.60;
      const foil = new THREE.Shape();
      foil.moveTo(0, -0.010);
      foil.lineTo(0.075, -0.034);
      foil.lineTo(chord, -0.004);
      foil.lineTo(chord, 0.006);
      foil.lineTo(0.075, 0.028);
      foil.closePath();
      const wingGeo = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false });
      // Centre it, then swing the extrusion axis from z onto x so the span runs across the
      // car and the chord runs fore-and-aft.
      wingGeo.translate(-chord / 2, 0, -span / 2);
      wingGeo.rotateY(Math.PI / 2);
      const wing = new THREE.Mesh(wingGeo, secondaryMat);
      wing.position.set(0, 0.30, 0);
      wing.rotation.x = -0.13;
      wing.castShadow = true;

      const strutGeo = new THREE.BoxGeometry(0.05, 0.30, 0.15);
      const footGeo = new THREE.BoxGeometry(0.13, 0.018, 0.21);
      for (const side of [-1, 1]) {
        const strut = new THREE.Mesh(strutGeo, trimMat);
        strut.position.set(side * 0.55, 0.15, 0);
        // The baseplate is what makes it look bolted on rather than pushed through.
        const foot = new THREE.Mesh(footGeo, trimMat);
        foot.position.set(side * 0.55, 0.009, 0);
        spoilerGroup.add(strut, foot);
      }
      spoilerGroup.add(wing);
      chassisGroup.add(spoilerGroup);
    } else if (bodyStyle === "coupe") {
      const ducktail = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.08, 0.18), secondaryMat);
      ducktail.position.set(0, 0.54, rearZ + 0.08);
      ducktail.rotation.x = -0.22;
      chassisGroup.add(ducktail);
    }

    // Motorsport livery for the Weiss-Blau coupe.
    //
    // The car is already a period Bavarian homage — "Weiss-Blau" is white-and-blue, and the
    // colourways carry real paint names of the era (Chamonix White, Inka Orange, Nachtblau).
    // What it lacked was the thing that actually makes the reference read at a glance: the
    // tricolour flank stripes and a quartered roundel.
    //
    // Deliberately an homage rather than a reproduction: the stripe order and the roundel's
    // quartering evoke the works cars without copying a real manufacturer's trademarked
    // emblem, which this project has no licence to use.
    if (car.id === "weiss-blau-30") {
      // ONE MESH, NOT FOURTEEN. Six flank stripes, three nose stripes, a ring and four
      // quadrants are all matte paint differing only in colour, which is exactly what a
      // vertex-coloured merge is for. As separate meshes the livery cost more draw calls than
      // the rest of the bodywork put together.
      const liveryParts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: THREE.Color }[] = [];
      const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

      // Tricolour: light blue, dark blue, red — the classic motorsport banding.
      const stripeColors = ["#3aa0dc", "#12256b", "#d42026"].map((hex) => new THREE.Color(hex));
      const stripeW = 0.075;
      const halfBody = 0.86;

      const flankGeo = new THREE.BoxGeometry(0.012, stripeW, 1.95);
      for (const side of [-1, 1]) {
        stripeColors.forEach((color, i) => {
          // Stacked band running along the flank, just below the window line.
          liveryParts.push({
            geometry: flankGeo,
            matrix: at(side * halfBody, 0.27 + i * (stripeW + 0.01), 0.02),
            color,
          });
        });
      }

      // A shorter run of the same banding across the nose.
      const noseGeo = new THREE.BoxGeometry(0.52, 0.012, stripeW);
      stripeColors.forEach((color, i) => {
        liveryParts.push({
          geometry: noseGeo,
          matrix: at(-0.3 + i * (stripeW + 0.012), 0.545, frontZ - 0.18),
          color,
        });
      });

      // Quartered roundel on the bonnet: dark outer ring, then alternating blue and white
      // quadrants. Built from wedges rather than a texture so it needs no image asset.
      const roundelY = 0.556;
      const roundelZ = frontZ - 0.62;
      liveryParts.push({
        geometry: new THREE.CylinderGeometry(0.155, 0.155, 0.014, 28),
        matrix: at(0, roundelY, roundelZ),
        color: new THREE.Color("#101418"),
      });
      for (let q = 0; q < 4; q++) {
        liveryParts.push({
          geometry: new THREE.CylinderGeometry(0.125, 0.125, 0.016, 14, 1, false, (q * Math.PI) / 2, Math.PI / 2),
          matrix: at(0, roundelY + 0.002, roundelZ),
          color: new THREE.Color(q % 2 === 0 ? "#f4f7fa" : "#1e4fa3"),
        });
      }

      chassisGroup.add(
        new THREE.Mesh(
          CarMeshBuilder.mergeColoured(liveryParts),
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.44, metalness: 0.05 })
        )
      );
    }

    carGroup.add(chassisGroup);

    // Ground Contact Shadow.
    //
    // THIS BELONGS TO `carGroup`, NOT `chassisGroup`. The chassis is lifted by
    // `wheelRadius * 0.75` so the body sits on its suspension, and the shadow was parented to
    // it — which put the contact patch about 25 cm off the ground, level with the axles and
    // buried inside the bodywork, where it darkened nothing and grounded nothing. The wheels
    // are pivoted at y = wheelRadius with that same radius, so y = 0 in `carGroup` is exactly
    // the tyre contact plane, and that is where an occlusion patch has to sit.
    const shadowGeo = new THREE.PlaneGeometry(2.4, 4.6);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: CarMeshBuilder.getGroundShadowTexture(),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(0, 0.02, 0);
    shadowMesh.renderOrder = 1;
    carGroup.add(shadowMesh);

    // Perk Aura — same story, it was floating at axle height too.
    const perkGeo = new THREE.PlaneGeometry(3.0, 5.4);
    const perkMat = new THREE.MeshBasicMaterial({
      color: colorway.accent,
      map: CarMeshBuilder.getRadialGlowTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const perkGlowMesh = new THREE.Mesh(perkGeo, perkMat);
    perkGlowMesh.rotation.x = -Math.PI / 2;
    perkGlowMesh.position.set(0, 0.035, 0);
    perkGlowMesh.renderOrder = 2;
    carGroup.add(perkGlowMesh);

    // Wheels
    const rearWheelWidth =
      bodyStyle === "rally_hatch" || bodyStyle === "sport_mid" ? wheelWidth * 1.3 : wheelWidth;

    const frontAxleZ = sections[1].z;
    const rearAxleZ = sections[5].z;
    // TRACK IS SET FROM THE TYRE'S OUTER FACE, NOT ITS CENTRE.
    //
    // The old rule put the wheel CENTRE a fixed 4 cm inside the sill, so how far the tyre
    // stuck out depended on how wide the tyre happened to be — and the wider the tyre, the
    // further out it sat. On the mid-engined car, whose rear rubber is 30% wider, the rear
    // tyres stood 12.3 cm proud of the bodywork against 8.5 cm at the front: not a stance,
    // just lopsided. Fixing the OUTER FACE a set distance outside the body instead makes the
    // overhang the same on both axles and on all four cars, and widening a tyre now grows it
    // inboard, under the arch, where a wider tyre actually goes.
    //
    // Not flush: the body is a solid loft with no arch cut into it, so a tyre level with the
    // skin would have its whole upper half swallowed and the wheel face with it. Three
    // centimetres is enough to keep the face clear of the body when seen from the side.
    // Both axles share ONE outer-face plane, taken from the wider of the two axle sections.
    // Sizing each axle against its own section is defensible but does not look it: on the van
    // the two differ by 4 cm, so the rears would tuck 2 cm further in than the fronts relative
    // to the car's widest point, and in plan view that reads as a wonky track rather than as
    // deliberate.
    const WHEEL_PROUD_M = 0.03;
    const wheelOuterX = Math.max(sections[1].wSill, sections[5].wSill) / 2 + WHEEL_PROUD_M;
    const frontHalfTrack = wheelOuterX - wheelWidth / 2;
    const rearHalfTrack = wheelOuterX - rearWheelWidth / 2;

    const wheelPositions = [
      [-frontHalfTrack, wheelRadius, frontAxleZ],
      [frontHalfTrack, wheelRadius, frontAxleZ],
      [-rearHalfTrack, wheelRadius, rearAxleZ],
      [rearHalfTrack, wheelRadius, rearAxleZ],
    ];

    // Wheel parts are built PER AXLE, from that axle's own width.
    //
    // The driven axle runs wider rubber, and when only the tyre knew that the rim, lip, spokes
    // and cap were all still built to the front width — so on the rear they sat buried inside
    // a tyre 30% wider than they were, and the whole wheel came back as a plain black cylinder
    // while the front showed its spokes. Every part that has to stand proud of the tyre face
    // has to be told the same width.
    const tireMat = new THREE.MeshStandardMaterial({
      color: bodyStyle === "box_utility" ? "#262626" : "#18181b",
      roughness: 0.88,
      metalness: 0.1,
    });
    /** A shade lighter than the sidewall. From the chase camera the rear tyres are seen tread-
     *  on, and a single flat black made them read as featureless slabs. */
    const treadMat = new THREE.MeshStandardMaterial({
      color: bodyStyle === "box_utility" ? "#33322f" : "#242428",
      roughness: 0.95,
      metalness: 0.05,
    });

    // THE SPOKES WERE THE SAME MATERIAL AS THE DISC THEY SAT ON.
    //
    // A bright cylinder at 0.68R with bright spokes laid over it has nothing to read against:
    // the whole wheel centre resolved to one silver disc, and against a black tyre the pair
    // collapsed into a single dark cylinder at any distance. A wheel reads as a wheel because
    // the spokes are LIGHT and the disc behind them is DARK, with a bright lip at the rim.
    const rimColor = bodyStyle === "rally_hatch" ? "#ffffff" : bodyStyle === "sport_mid" ? "#e2e8f0" : "#f1f5f9";
    const rimMat = new THREE.MeshStandardMaterial({
      color: rimColor,
      metalness: 0.88,
      roughness: 0.18,
      envMap,
      envMapIntensity: 1.1,
    });
    const dishMat = new THREE.MeshStandardMaterial({
      color: "#20242b",
      metalness: 0.7,
      roughness: 0.5,
      envMap,
      envMapIntensity: 0.7,
    });
    const hubMat = new THREE.MeshStandardMaterial({ color: "#0f172a", metalness: 0.9, roughness: 0.2 });

    interface WheelParts {
      tire: THREE.CylinderGeometry;
      tread: THREE.CylinderGeometry;
      barrel: THREE.CylinderGeometry;
      lip: THREE.CylinderGeometry;
      hub: THREE.CylinderGeometry;
      cap: THREE.CylinderGeometry;
      spoke: THREE.BoxGeometry;
    }

    const makeWheelParts = (width: number): WheelParts => ({
      tire: new THREE.CylinderGeometry(wheelRadius, wheelRadius, width, 24),
      tread: new THREE.CylinderGeometry(wheelRadius * 1.004, wheelRadius * 1.004, width * 0.82, 24, 1, true),
      // Solid, not a band: an open cylinder would show the inside of the far side of the
      // wheel between the spokes, because back faces are culled.
      barrel: new THREE.CylinderGeometry(wheelRadius * 0.70, wheelRadius * 0.70, width + 0.004, 20),
      // The bright ring that separates rim from tyre.
      lip: new THREE.CylinderGeometry(wheelRadius * 0.745, wheelRadius * 0.745, width + 0.016, 20, 1, true),
      hub: new THREE.CylinderGeometry(wheelRadius * 0.22, wheelRadius * 0.22, width * 0.7, 12),
      cap: new THREE.CylinderGeometry(wheelRadius * 0.17, wheelRadius * 0.17, width + 0.044, 12),
      // THE SPOKES WERE NOT SPOKE-SHAPED. The box was
      //   (0.08R along the axle) x (1.25R radial) x (wheelWidth across)
      // and `wheelWidth` is 0.84R here, so each "spoke" was a slab covering most of the wheel
      // face and a handful of them rotated about the axle tiled the disc solid. That, more
      // than the colour, is why the wheel resolved to one flat cylinder. A spoke is long
      // radially and NARROW tangentially, and wider along the axle than the disc behind it or
      // it is buried inside the rim.
      spoke: new THREE.BoxGeometry(width + 0.030, wheelRadius * 1.38, wheelRadius * 0.13),
    });

    const frontWheel = makeWheelParts(wheelWidth);
    const rearWheel = wheelWidth === rearWheelWidth ? frontWheel : makeWheelParts(rearWheelWidth);

    const caliperGeo = new THREE.BoxGeometry(0.08, wheelRadius * 0.45, 0.11);
    const caliperMat = new THREE.MeshStandardMaterial({
      color: bodyStyle === "rally_hatch" ? "#eab308" : "#dc2626",
      roughness: 0.25,
      metalness: 0.4,
    });

    const discGeo = new THREE.CylinderGeometry(wheelRadius * 0.50, wheelRadius * 0.50, 0.03, 14);

    // TWO DRAW CALLS PER WHEEL, NOT TWELVE.
    //
    // Everything that spins is rigid relative to everything else that spins, so it can be one
    // geometry. The split is by how the surface behaves, not by what colour it is: rubber is
    // matte, the rim is polished metal, and each part's own colour rides along per vertex —
    // which is what keeps the bright spokes reading against the dark dish behind them.
    const axleTurn = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const numSpokes = bodyStyle === "rally_hatch" ? 3 : bodyStyle === "sport_mid" ? 5 : 4;

    const rubberMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.08,
    });
    const wheelMetalMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.85,
      roughness: 0.26,
      envMap,
      envMapIntensity: 1.0,
    });

    const buildWheel = (parts: WheelParts) => {
      const rubber = CarMeshBuilder.mergeColoured([
        { geometry: parts.tire, matrix: axleTurn, color: tireMat.color },
        { geometry: parts.tread, matrix: axleTurn, color: treadMat.color },
      ]);
      const metal: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: THREE.Color }[] = [
        { geometry: parts.barrel, matrix: axleTurn, color: dishMat.color },
        { geometry: parts.lip, matrix: axleTurn, color: rimMat.color },
        { geometry: parts.hub, matrix: axleTurn, color: hubMat.color },
        { geometry: parts.cap, matrix: axleTurn, color: rimMat.color },
      ];
      for (let sp = 0; sp < numSpokes; sp++) {
        metal.push({
          geometry: parts.spoke,
          matrix: new THREE.Matrix4().makeRotationX((sp * Math.PI) / numSpokes),
          color: rimMat.color,
        });
      }
      return { rubber, metal: CarMeshBuilder.mergeColoured(metal) };
    };

    const frontMerged = buildWheel(frontWheel);
    const rearMerged = frontWheel === rearWheel ? frontMerged : buildWheel(rearWheel);

    for (let i = 0; i < 4; i++) {
      const pivotGroup = new THREE.Group();
      pivotGroup.position.set(wheelPositions[i][0], wheelPositions[i][1], wheelPositions[i][2]);

      const spinGroup = new THREE.Group();
      // Wider rubber on the driven axle. Seen tread-on from the chase camera, a narrow rear
      // tyre is most of what makes a rally car look under-tyred from behind.
      const merged = i >= 2 ? rearMerged : frontMerged;

      const rubber = new THREE.Mesh(merged.rubber, rubberMat);
      rubber.castShadow = true;
      const metal = new THREE.Mesh(merged.metal, wheelMetalMat);

      // Stays its own mesh: its colour changes when the brakes get hot.
      const discMat = new THREE.MeshBasicMaterial({ color: "#475569" });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.z = Math.PI / 2;
      brakeDiscs.push(disc);

      spinGroup.add(rubber, metal, disc);

      // Bolted to the upright, so it does not turn with the wheel.
      const caliper = new THREE.Mesh(caliperGeo, caliperMat);
      caliper.position.set(0, wheelRadius * 0.22, 0);

      pivotGroup.add(spinGroup, caliper);
      carGroup.add(pivotGroup);
      wheelGroups.push(pivotGroup);
    }

    return {
      carGroup,
      chassisGroup,
      chassisMesh,
      glassMesh,
      wheelGroups,
      brakeLightMeshes,
      reverseLightMeshes,
      headlightGlowMeshes,
      brakeGlowMeshes,
      brakeDiscs,
      tailPanelMeshes,
      nosePanelMeshes,
      exhaustFlame: flame,
      perkGlowMesh,
      spoilerGroup,
    };
  }
}
