/**
 * VAL BORBERA HILLCLIMB — 3D Car Mesh Builder
 * Procedurally generates high-detail chassis, bodywork, glass, lighting, aerodynamic wings,
 * wheels, brake calipers, slotted discs, and perk glow effects for all 4 vehicle classes.
 */

import * as THREE from "three";
import { CarDef } from "../vehicle/cars";

export interface CarMeshResult {
  carGroup: THREE.Group;
  chassisMesh: THREE.Mesh;
  glassMesh: THREE.Mesh;
  wheelGroups: THREE.Group[];
  brakeLightMeshes: THREE.Mesh[];
  reverseLightMeshes: THREE.Mesh[];
  headlightGlowMeshes: THREE.Mesh[];
  brakeDiscs: THREE.Mesh[];
  exhaustFlame: THREE.Mesh | null;
  perkGlowMesh: THREE.Mesh | null;
  spoilerGroup: THREE.Group | null;
}

export class CarMeshBuilder {
  private static radialGlowTexture: THREE.Texture | null = null;
  private static groundShadowTexture: THREE.Texture | null = null;

  public static getRadialGlowTexture(): THREE.Texture {
    if (CarMeshBuilder.radialGlowTexture) return CarMeshBuilder.radialGlowTexture;

    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
    grad.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    CarMeshBuilder.radialGlowTexture = tex;
    return tex;
  }

  public static getGroundShadowTexture(): THREE.Texture {
    if (CarMeshBuilder.groundShadowTexture) return CarMeshBuilder.groundShadowTexture;

    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size * 0.48);
    grad.addColorStop(0.0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.45)");
    grad.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    CarMeshBuilder.groundShadowTexture = tex;
    return tex;
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
    const brakeDiscs: THREE.Mesh[] = [];

    const colorway = car.colorways[colorIndex] || car.colorways[0];
    const bodyStyle = colorway.bodyStyle || "coupe";

    const chassisGroup = new THREE.Group();
    const wheelRadius = bodyStyle === "box_utility" ? 0.30 : bodyStyle === "rally_hatch" ? 0.31 : 0.32;
    const wheelWidth = bodyStyle === "sport_mid" ? 0.25 : bodyStyle === "box_utility" ? 0.20 : 0.23;
    chassisGroup.position.set(0, wheelRadius * 0.75, 0);

    // 1. Physical Materials
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: colorway.primary,
      metalness: 0.65,
      roughness: 0.28,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
    });

    const secondaryMat = new THREE.MeshPhysicalMaterial({
      color: colorway.secondary || "#0f172a",
      metalness: 0.5,
      roughness: 0.35,
      clearcoat: 0.8,
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: "#0f172a",
      roughness: 0.75,
      metalness: 0.2,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      metalness: 0.95,
      roughness: 0.08,
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#030712",
      roughness: 0.05,
      transmission: 0.45,
      transparent: true,
      opacity: 0.85,
      metalness: 0.1,
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

    const bodyPositions: number[] = [];
    const bodyIndices: number[] = [];
    const glassPositions: number[] = [];
    const glassIndices: number[] = [];

    const secVerts: { x: number; y: number; z: number }[][] = [];
    for (let k = 0; k < sections.length; k++) {
      const s = sections[k];
      secVerts.push([
        { x: -s.wSill / 2, y: s.ySill, z: s.z },
        { x: -s.wBelt / 2, y: s.yBelt, z: s.z },
        { x: -s.wTop / 2,  y: s.yTop,  z: s.z },
        { x: s.wTop / 2,   y: s.yTop,  z: s.z },
        { x: s.wBelt / 2,  y: s.yBelt, z: s.z },
        { x: s.wSill / 2,  y: s.ySill, z: s.z },
      ]);
    }

    let bIdx = 0;
    const addBodyQuad = (p0: {x:number,y:number,z:number}, p1: {x:number,y:number,z:number}, p2: {x:number,y:number,z:number}, p3: {x:number,y:number,z:number}) => {
      bodyPositions.push(p0.x, p0.y, p0.z,  p1.x, p1.y, p1.z,  p2.x, p2.y, p2.z,  p3.x, p3.y, p3.z);
      bodyIndices.push(bIdx, bIdx + 1, bIdx + 2,  bIdx, bIdx + 2, bIdx + 3);
      bIdx += 4;
    };

    let gIdx = 0;
    const addGlassQuad = (p0: {x:number,y:number,z:number}, p1: {x:number,y:number,z:number}, p2: {x:number,y:number,z:number}, p3: {x:number,y:number,z:number}) => {
      glassPositions.push(p0.x, p0.y, p0.z,  p1.x, p1.y, p1.z,  p2.x, p2.y, p2.z,  p3.x, p3.y, p3.z);
      glassIndices.push(gIdx, gIdx + 1, gIdx + 2,  gIdx, gIdx + 2, gIdx + 3);
      gIdx += 4;
    };

    for (let k = 0; k < sections.length - 1; k++) {
      const vA = secVerts[k];
      const vB = secVerts[k + 1];

      addBodyQuad(vA[0], vB[0], vB[1], vA[1]);

      if (k >= 2 && k <= 4) {
        addGlassQuad(vA[1], vB[1], vB[2], vA[2]);
      } else {
        addBodyQuad(vA[1], vB[1], vB[2], vA[2]);
      }

      if (k === 2) {
        addGlassQuad(vA[2], vB[2], vB[3], vA[3]);
      } else if (k === 3) {
        addBodyQuad(vA[2], vB[2], vB[3], vA[3]);
      } else if (k === 4 && bodyStyle !== "box_utility") {
        addGlassQuad(vA[2], vB[2], vB[3], vA[3]);
      } else {
        addBodyQuad(vA[2], vB[2], vB[3], vA[3]);
      }

      if (k >= 2 && k <= 4) {
        addGlassQuad(vA[3], vB[3], vB[4], vA[4]);
      } else {
        addBodyQuad(vA[3], vB[3], vB[4], vA[4]);
      }

      addBodyQuad(vA[4], vB[4], vB[5], vA[5]);
      addBodyQuad(vA[5], vB[5], vB[0], vA[0]);
    }

    // Front & Rear Caps
    const fv = secVerts[0];
    addBodyQuad(fv[0], fv[5], fv[4], fv[1]);
    addBodyQuad(fv[1], fv[4], fv[3], fv[2]);

    const rv = secVerts[secVerts.length - 1];
    addBodyQuad(rv[5], rv[0], rv[1], rv[4]);
    addBodyQuad(rv[4], rv[1], rv[2], rv[3]);

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

    const frontZ = sections[0].z;
    const rearZ = sections[sections.length - 1].z;

    // Side Mirrors
    const mirrorGeo = new THREE.BoxGeometry(0.14, 0.08, 0.10);
    const mirrorL = new THREE.Mesh(mirrorGeo, secondaryMat);
    mirrorL.position.set(-sections[2].wBelt / 2 - 0.08, sections[2].yBelt + 0.04, sections[2].z + 0.08);
    const mirrorR = new THREE.Mesh(mirrorGeo, secondaryMat);
    mirrorR.position.set(sections[2].wBelt / 2 + 0.08, sections[2].yBelt + 0.04, sections[2].z + 0.08);
    chassisGroup.add(mirrorL, mirrorR);

    // Front Grilles & Lights by Body Style
    if (bodyStyle === "rally_hatch") {
      const podRimGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.04, 14);
      const podLensGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14);
      const podMat = new THREE.MeshStandardMaterial({
        color: "#fef08a",
        emissive: "#facc15",
        emissiveIntensity: 1.6,
        roughness: 0.1,
      });

      for (const offX of [-0.48, -0.18, 0.18, 0.48]) {
        const podRim = new THREE.Mesh(podRimGeo, chromeMat);
        podRim.rotation.x = Math.PI / 2;
        podRim.position.set(offX, 0.36, frontZ + 0.03);

        const pod = new THREE.Mesh(podLensGeo, podMat);
        pod.rotation.x = Math.PI / 2;
        pod.position.set(offX, 0.36, frontZ + 0.06);
        chassisGroup.add(podRim, pod);
        headlightGlowMeshes.push(pod);
      }

      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.40), trimMat);
      scoop.position.set(0, sections[3].yTop + 0.06, 0.0);
      chassisGroup.add(scoop);

      const flapMat = new THREE.MeshStandardMaterial({ color: "#dc2626", roughness: 0.5 });
      const flapGeo = new THREE.BoxGeometry(0.24, 0.28, 0.02);
      const flapL = new THREE.Mesh(flapGeo, flapMat);
      flapL.position.set(-sections[5].wSill / 2 - 0.02, 0.04, sections[5].z - 0.18);
      const flapR = new THREE.Mesh(flapGeo, flapMat);
      flapR.position.set(sections[5].wSill / 2 + 0.02, 0.04, sections[5].z - 0.18);
      chassisGroup.add(flapL, flapR);
    } else if (bodyStyle === "box_utility") {
      const bullBar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 0.08), trimMat);
      bullBar.position.set(0, 0.32, frontZ + 0.05);

      const safariRimGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 14);
      const safariLensGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.06, 14);
      const safariMat = new THREE.MeshStandardMaterial({
        color: "#fef08a",
        emissive: "#facc15",
        emissiveIntensity: 1.5,
        roughness: 0.1,
      });

      for (const offX of [-0.35, 0.35]) {
        const sfRim = new THREE.Mesh(safariRimGeo, chromeMat);
        sfRim.rotation.x = Math.PI / 2;
        sfRim.position.set(offX, 0.36, frontZ + 0.06);

        const sf = new THREE.Mesh(safariLensGeo, safariMat);
        sf.rotation.x = Math.PI / 2;
        sf.position.set(offX, 0.36, frontZ + 0.09);
        chassisGroup.add(sfRim, sf);
        headlightGlowMeshes.push(sf);
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
      const hlMat = new THREE.MeshStandardMaterial({
        color: "#f8fafc",
        emissive: "#bae6fd",
        emissiveIntensity: 1.8,
        roughness: 0.1,
      });
      const hlGeoOuter = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 14);
      const hlGeoInner = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 14);
      const ringGeoOuter = new THREE.CylinderGeometry(0.135, 0.135, 0.02, 14);
      const ringGeoInner = new THREE.CylinderGeometry(0.105, 0.105, 0.02, 14);

      for (const [offX, isOuter] of [[-0.52, true], [0.52, true], [-0.22, false], [0.22, false]] as [number, boolean][]) {
        const ring = new THREE.Mesh(isOuter ? ringGeoOuter : ringGeoInner, chromeMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(offX, 0.30, frontZ + 0.02);

        const hl = new THREE.Mesh(isOuter ? hlGeoOuter : hlGeoInner, hlMat);
        hl.rotation.x = Math.PI / 2;
        hl.position.set(offX, 0.30, frontZ + 0.04);
        chassisGroup.add(ring, hl);
        headlightGlowMeshes.push(hl);
      }
    } else {
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.04), trimMat);
      grille.position.set(0, 0.28, frontZ + 0.02);
      const kidneyL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 0.05), chromeMat);
      kidneyL.position.set(-0.11, 0.28, frontZ + 0.03);
      const kidneyR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 0.05), chromeMat);
      kidneyR.position.set(0.11, 0.28, frontZ + 0.03);
      chassisGroup.add(grille, kidneyL, kidneyR);

      const hlMat = new THREE.MeshStandardMaterial({
        color: "#f8fafc",
        emissive: "#dbeafe",
        emissiveIntensity: 2.0,
        roughness: 0.1,
      });
      const hlGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 14);
      const hlRingGeo = new THREE.CylinderGeometry(0.125, 0.125, 0.02, 14);

      for (const offX of [-0.54, 0.54]) {
        const ring = new THREE.Mesh(hlRingGeo, chromeMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(offX, 0.32, frontZ + 0.02);

        const hl = new THREE.Mesh(hlGeo, hlMat);
        hl.rotation.x = Math.PI / 2;
        hl.position.set(offX, 0.32, frontZ + 0.04);
        chassisGroup.add(ring, hl);
        headlightGlowMeshes.push(hl);
      }
    }

    // Taillights
    const tlBarGeo = new THREE.BoxGeometry(1.42, 0.08, 0.04);
    const tlMat = new THREE.MeshStandardMaterial({
      color: "#ef4444",
      emissive: "#7f1d1d",
      emissiveIntensity: 1.0,
      roughness: 0.2,
    });
    const tlBar = new THREE.Mesh(tlBarGeo, tlMat);
    tlBar.position.set(0, 0.44, rearZ - 0.02);
    chassisGroup.add(tlBar);

    const tlRoundGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 14);
    const tlL = new THREE.Mesh(tlRoundGeo, tlMat);
    tlL.rotation.x = Math.PI / 2;
    tlL.position.set(-0.56, 0.44, rearZ - 0.03);
    const tlR = new THREE.Mesh(tlRoundGeo, tlMat);
    tlR.rotation.x = Math.PI / 2;
    tlR.position.set(0.56, 0.44, rearZ - 0.03);
    chassisGroup.add(tlL, tlR);
    brakeLightMeshes.push(tlBar, tlL, tlR);

    // Reversing Lights
    const revGeo = new THREE.BoxGeometry(0.12, 0.06, 0.03);
    const revMat = new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      emissive: "#ffffff",
      emissiveIntensity: 0.0,
      roughness: 0.2,
    });
    const revL = new THREE.Mesh(revGeo, revMat);
    revL.position.set(-0.28, 0.44, rearZ - 0.03);
    const revR = new THREE.Mesh(revGeo, revMat);
    revR.position.set(0.28, 0.44, rearZ - 0.03);
    chassisGroup.add(revL, revR);
    reverseLightMeshes.push(revL, revR);

    // License Plate
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.12, 0.02),
      new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.4 })
    );
    plate.position.set(0, 0.28, rearZ - 0.02);
    chassisGroup.add(plate);

    // Exhausts
    if (bodyStyle === "sport_mid") {
      for (const side of [-0.08, 0.08]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.20, 10), chromeMat);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(side, 0.18, rearZ - 0.10);
        chassisGroup.add(pipe);
      }
    } else if (bodyStyle === "rally_hatch") {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.24, 12), chromeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(-0.48, 0.16, rearZ - 0.12);
      chassisGroup.add(pipe);
    } else {
      for (const side of [-1, 1]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10), chromeMat);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(0.42 * side, 0.16, rearZ - 0.10);
        chassisGroup.add(pipe);
      }
    }

    // Exhaust Flame
    const flameGeo = new THREE.ConeGeometry(0.12, 0.45, 8);
    const flameMat = new THREE.MeshBasicMaterial({ color: "#f97316", transparent: true, opacity: 0 });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(bodyStyle === "rally_hatch" ? -0.48 : bodyStyle === "sport_mid" ? 0 : -0.42, 0.16, rearZ - 0.32);
    chassisGroup.add(flame);

    // Spoilers
    let spoilerGroup: THREE.Group | null = null;
    if (bodyStyle === "rally_hatch") {
      spoilerGroup = new THREE.Group();
      spoilerGroup.position.set(0, sections[3].yTop + 0.08, rearZ + 0.15);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.60, 0.06, 0.35), secondaryMat);
      wing.position.set(0, 0.28, 0);
      wing.castShadow = true;
      const strutL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.15), trimMat);
      strutL.position.set(-0.55, 0.14, 0);
      const strutR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.15), trimMat);
      strutR.position.set(0.55, 0.14, 0);
      spoilerGroup.add(wing, strutL, strutR);
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
      const liveryGroup = new THREE.Group();

      // Tricolour: light blue, dark blue, red — the classic motorsport banding.
      const stripeColors = ["#3aa0dc", "#12256b", "#d42026"];
      const stripeW = 0.075;
      const halfBody = 0.86;

      for (const side of [-1, 1]) {
        stripeColors.forEach((hex, i) => {
          const stripe = new THREE.Mesh(
            new THREE.BoxGeometry(0.012, stripeW, 1.95),
            new THREE.MeshStandardMaterial({ color: hex, roughness: 0.42, metalness: 0.05 })
          );
          // Stacked band running along the flank, just below the window line.
          stripe.position.set(side * halfBody, 0.27 + i * (stripeW + 0.010), 0.02);
          liveryGroup.add(stripe);
        });
      }

      // A shorter run of the same banding across the nose.
      stripeColors.forEach((hex, i) => {
        const nose = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.012, stripeW),
          new THREE.MeshStandardMaterial({ color: hex, roughness: 0.42, metalness: 0.05 })
        );
        nose.position.set(-0.30 + i * (stripeW + 0.012), 0.545, frontZ - 0.18);
        liveryGroup.add(nose);
      });

      // Quartered roundel on the bonnet: white outer ring, then alternating blue and white
      // quadrants. Built from wedges rather than a texture so it needs no image asset.
      const roundelY = 0.556;
      const roundelZ = frontZ - 0.62;
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.155, 0.155, 0.014, 28),
        new THREE.MeshStandardMaterial({ color: "#101418", roughness: 0.5, metalness: 0.3 })
      );
      ring.position.set(0, roundelY, roundelZ);
      liveryGroup.add(ring);

      for (let q = 0; q < 4; q++) {
        const wedge = new THREE.Mesh(
          new THREE.CylinderGeometry(0.125, 0.125, 0.016, 14, 1, false, (q * Math.PI) / 2, Math.PI / 2),
          new THREE.MeshStandardMaterial({
            color: q % 2 === 0 ? "#f4f7fa" : "#1e4fa3",
            roughness: 0.45,
            metalness: 0.05,
          })
        );
        wedge.position.set(0, roundelY + 0.002, roundelZ);
        liveryGroup.add(wedge);
      }

      chassisGroup.add(liveryGroup);
    }

    // Ground Contact Shadow
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
    shadowMesh.position.set(0, 0.015, 0);
    shadowMesh.renderOrder = 1;
    chassisGroup.add(shadowMesh);

    // Perk Aura
    const perkGeo = new THREE.PlaneGeometry(3.0, 5.4);
    const perkMat = new THREE.MeshBasicMaterial({
      color: colorway.accent,
      map: CarMeshBuilder.getRadialGlowTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const perkGlowMesh = new THREE.Mesh(perkGeo, perkMat);
    perkGlowMesh.rotation.x = -Math.PI / 2;
    perkGlowMesh.position.set(0, 0.03, 0);
    perkGlowMesh.renderOrder = 2;
    chassisGroup.add(perkGlowMesh);

    carGroup.add(chassisGroup);

    // Wheels
    const frontAxleZ = sections[1].z;
    const rearAxleZ = sections[5].z;
    const frontHalfTrack = (sections[1].wSill / 2) - 0.04;
    const rearHalfTrack = (sections[5].wSill / 2) - 0.04;

    const wheelPositions = [
      [-frontHalfTrack, wheelRadius, frontAxleZ],
      [frontHalfTrack, wheelRadius, frontAxleZ],
      [-rearHalfTrack, wheelRadius, rearAxleZ],
      [rearHalfTrack, wheelRadius, rearAxleZ],
    ];

    const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 24);
    const tireMat = new THREE.MeshStandardMaterial({
      color: bodyStyle === "box_utility" ? "#262626" : "#18181b",
      roughness: 0.88,
      metalness: 0.1,
    });

    const rimColor = bodyStyle === "rally_hatch" ? "#ffffff" : bodyStyle === "sport_mid" ? "#e2e8f0" : "#f1f5f9";
    const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.68, wheelRadius * 0.68, wheelWidth + 0.012, 16);
    const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, metalness: 0.88, roughness: 0.18 });

    const hubGeo = new THREE.CylinderGeometry(wheelRadius * 0.22, wheelRadius * 0.22, wheelWidth + 0.016, 12);
    const hubMat = new THREE.MeshStandardMaterial({ color: "#0f172a", metalness: 0.9, roughness: 0.2 });

    const spokeGeo = new THREE.BoxGeometry(wheelRadius * 0.08, wheelRadius * 1.25, wheelWidth + 0.014);

    const caliperGeo = new THREE.BoxGeometry(0.08, wheelRadius * 0.45, 0.11);
    const caliperMat = new THREE.MeshStandardMaterial({
      color: bodyStyle === "rally_hatch" ? "#eab308" : "#dc2626",
      roughness: 0.25,
      metalness: 0.4,
    });

    const discGeo = new THREE.CylinderGeometry(wheelRadius * 0.50, wheelRadius * 0.50, 0.03, 14);

    for (let i = 0; i < 4; i++) {
      const pivotGroup = new THREE.Group();
      pivotGroup.position.set(wheelPositions[i][0], wheelPositions[i][1], wheelPositions[i][2]);

      const spinGroup = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;

      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.z = Math.PI / 2;

      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;

      const discMat = new THREE.MeshBasicMaterial({ color: "#475569" });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.z = Math.PI / 2;
      brakeDiscs.push(disc);

      spinGroup.add(tire, rim, hub, disc);

      const numSpokes = bodyStyle === "rally_hatch" ? 3 : bodyStyle === "sport_mid" ? 5 : 4;
      for (let s = 0; s < numSpokes; s++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.x = (s * Math.PI) / numSpokes;
        spinGroup.add(spoke);
      }

      const caliper = new THREE.Mesh(caliperGeo, caliperMat);
      caliper.position.set(0, wheelRadius * 0.22, 0);

      pivotGroup.add(spinGroup, caliper);
      carGroup.add(pivotGroup);
      wheelGroups.push(pivotGroup);
    }

    return {
      carGroup,
      chassisMesh,
      glassMesh,
      wheelGroups,
      brakeLightMeshes,
      reverseLightMeshes,
      headlightGlowMeshes,
      brakeDiscs,
      exhaustFlame: flame,
      perkGlowMesh,
      spoilerGroup,
    };
  }
}
