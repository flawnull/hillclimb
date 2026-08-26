/**
 * VAL BORBERA HILLCLIMB — Roadside Furniture & Props Builder
 * Generates guardrails, W-beams, reflectors, retaining stone walls, apex kerbs with banking,
 * milestone cippi, tornante chevron boards, start/finish gantries, and historic landmarks.
 */

import * as THREE from "three";
import { SplineSample } from "./TrackSpline";

function detNormalizeAngle(a: number): number {
  let res = a;
  while (res > Math.PI) res -= 2 * Math.PI;
  while (res < -Math.PI) res += 2 * Math.PI;
  return res;
}

export function buildRoadsideFurniture(
  samples: SplineSample[],
  landmarkGroup: THREE.Group,
  guardrailGroup: THREE.Group
): void {
  const POST_RADIAL_SEGMENTS = 6;
  const POLE_RADIAL_SEGMENTS = 8;

  // Shared geometries
  const chevronPostGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.4, POST_RADIAL_SEGMENTS);
  const chevronBoardGeo = new THREE.BoxGeometry(1.2, 0.5, 0.04);
  const signPostGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.8, POST_RADIAL_SEGMENTS);
  const cippoBaseGeo = new THREE.BoxGeometry(0.32, 0.60, 0.22);
  const cippoTopGeo = new THREE.BoxGeometry(0.32, 0.16, 0.22);

  // Guardrail Geometry & Materials
  const postGeo = new THREE.BoxGeometry(0.12, 0.78, 0.12);
  const postMat = new THREE.MeshStandardMaterial({ color: "#94a3b8", metalness: 0.65, roughness: 0.35 });
  const beamMat = new THREE.MeshStandardMaterial({ color: "#cbd5e1", metalness: 0.75, roughness: 0.25 });
  const reflectorGeo = new THREE.BoxGeometry(0.03, 0.08, 0.08);
  const reflectorMatRed = new THREE.MeshStandardMaterial({ color: "#ef4444", roughness: 0.2, metalness: 0.8 });
  const reflectorMatWhite = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.2, metalness: 0.8 });

  // Stone Retaining Wall Material
  const wallGeo = new THREE.BoxGeometry(0.6, 1.4, 3.2);
  const wallMat = new THREE.MeshStandardMaterial({ color: "#78716c", roughness: 0.95, flatShading: true });

  // Start & Finish Gantries
  if (samples.length > 5) {
    const startS = samples[Math.min(5, samples.length - 1)];
    const finishS = samples[samples.length - 1];

    const createGantry = (sample: SplineSample, title: string, subtitle: string) => {
      const gantryGroup = new THREE.Group();
      const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6.2, POLE_RADIAL_SEGMENTS);
      const poleMat = new THREE.MeshStandardMaterial({ color: "#64748b", metalness: 0.25, roughness: 0.45 });

      const poleL = new THREE.Mesh(poleGeo, poleMat);
      poleL.position.set(-sample.halfWidth - 2.2, 3.1, 0);
      const poleR = new THREE.Mesh(poleGeo, poleMat);
      poleR.position.set(sample.halfWidth + 2.2, 3.1, 0);

      const trussGeo = new THREE.BoxGeometry(sample.halfWidth * 2 + 4.6, 0.7, 0.35);
      const trussMat = new THREE.MeshStandardMaterial({ color: "#475569", metalness: 0.25, roughness: 0.45 });
      const truss = new THREE.Mesh(trussGeo, trussMat);
      truss.position.set(0, 5.8, 0);

      const bannerGeo = new THREE.BoxGeometry(sample.halfWidth * 2 + 3.8, 0.55, 0.05);
      const bannerMat = new THREE.MeshStandardMaterial({ color: "#dc2626", roughness: 0.35, metalness: 0.05 });
      const banner = new THREE.Mesh(bannerGeo, bannerMat);
      banner.position.set(0, 5.8, 0.2);

      gantryGroup.position.set(sample.x, sample.y, sample.z);
      gantryGroup.rotation.y = sample.heading;
      gantryGroup.add(poleL, poleR, truss, banner);
      return gantryGroup;
    };

    landmarkGroup.add(createGantry(startS, "PARTENZA", "VAL BORBERA"));
    landmarkGroup.add(createGantry(finishS, "ARRIVO", "FINISH"));
  }

  // Red & White Apex Kerbs for Curves
  const kerbGeo = new THREE.BoxGeometry(0.35, 0.08, 1.8);
  const kerbMatRed = new THREE.MeshStandardMaterial({ color: "#dc2626", roughness: 0.6 });
  const kerbMatWhite = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.6 });

  for (let i = 0; i < samples.length - 2; i += 2) {
    const s = samples[i];
    const prevS = samples[Math.max(0, i - 2)];
    const nextS = samples[Math.min(samples.length - 1, i + 2)];
    const dHeading = Math.abs(detNormalizeAngle(nextS.heading - prevS.heading));
    const isCurving = dHeading > 0.04;
    const hw = s.halfWidth + (isCurving ? 0.95 : 0.70);

    // 1. Guardrails on Valley/River side
    if (s.guardrail) {
      const sideSign = s.exposure === "left" ? -1 : 1;
      const posX = s.x + s.normalX * hw * sideSign;
      const posY = s.y + 0.38;
      const posZ = s.z + s.normalZ * hw * sideSign;

      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(posX, posY, posZ);
      post.castShadow = true;
      guardrailGroup.add(post);

      if (i < samples.length - 3 && samples[i + 2].guardrail) {
        const nextGuardS = samples[i + 2];
        const nextIsCurving = Math.abs(detNormalizeAngle(samples[Math.min(samples.length - 1, i + 4)].heading - s.heading)) > 0.04;
        const nextHw = nextGuardS.halfWidth + (nextIsCurving ? 0.95 : 0.70);
        const nextSideSign = nextGuardS.exposure === "left" ? -1 : 1;
        const nextPosX = nextGuardS.x + nextGuardS.normalX * nextHw * nextSideSign;
        const nextPosY = nextGuardS.y + 0.38;
        const nextPosZ = nextGuardS.z + nextGuardS.normalZ * nextHw * nextSideSign;

        const dx = nextPosX - posX;
        const dz = nextPosZ - posZ;
        const segLen = Math.sqrt(dx * dx + dz * dz) || 0.1;
        const segHeading = Math.atan2(dx, dz);

        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, segLen), beamMat);
        beam.position.set((posX + nextPosX) * 0.5, (posY + nextPosY) * 0.5 + 0.15, (posZ + nextPosZ) * 0.5);
        beam.rotation.y = segHeading;
        guardrailGroup.add(beam);

        const reflector = new THREE.Mesh(reflectorGeo, i % 4 === 0 ? reflectorMatRed : reflectorMatWhite);
        reflector.position.set(posX - s.normalX * 0.06 * sideSign, posY + 0.18, posZ - s.normalZ * 0.06 * sideSign);
        guardrailGroup.add(reflector);
      }
    }

    // 2. Stone Retaining Walls on Mountain Cut side
    if (s.exposure === "right" || s.exposure === "left") {
      const mountainSign = s.exposure === "right" ? -1 : 1;
      if (i % 4 === 0 && !isCurving) {
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(
          s.x + s.normalX * (s.halfWidth + 1.4) * mountainSign,
          s.y + 0.6,
          s.z + s.normalZ * (s.halfWidth + 1.4) * mountainSign
        );
        wall.rotation.y = s.heading;
        wall.castShadow = true;
        guardrailGroup.add(wall);
      }
    }

    // 3. Apex Kerbs on Curves with active curvature
    if (isCurving) {
      const insideSign = s.bank > 0 ? 1 : -1;
      const sinB = Math.sin(s.bank);
      const cosB = Math.cos(s.bank);
      const upX = -s.normalX * sinB;
      const upY = cosB;
      const upZ = -s.normalZ * sinB;

      const kerb = new THREE.Mesh(kerbGeo, i % 4 === 0 ? kerbMatRed : kerbMatWhite);
      kerb.position.set(
        s.x + s.normalX * (s.halfWidth + 0.30) * insideSign + upX * 0.04,
        s.y + upY * 0.04,
        s.z + s.normalZ * (s.halfWidth + 0.30) * insideSign + upZ * 0.04
      );
      kerb.rotation.y = s.heading;
      kerb.rotation.z = s.bank;
      landmarkGroup.add(kerb);
    }

    // 4. Milestone Posts (Cippo Cantoniero SP140) every 250m on straights
    if (i > 12 && i % 25 === 0 && !isCurving) {
      const cippoBase = new THREE.Mesh(
        cippoBaseGeo,
        new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.85 })
      );
      const cippoTop = new THREE.Mesh(
        cippoTopGeo,
        new THREE.MeshStandardMaterial({ color: "#dc2626", roughness: 0.8 })
      );
      cippoTop.position.set(0, 0.38, 0);
      const cippoGroup = new THREE.Group();
      cippoGroup.position.set(
        s.x + s.normalX * (s.halfWidth + 1.25),
        s.y + 0.30,
        s.z + s.normalZ * (s.halfWidth + 1.25)
      );
      cippoGroup.rotation.y = s.heading;
      cippoGroup.add(cippoBase, cippoTop);
      landmarkGroup.add(cippoGroup);
    }

    // 5. Hairpin Warning Boards (Tornante Chevron Arrows)
    if (isCurving && Math.abs(s.bank) > 0.035 && i % 6 === 0) {
      const outerSign = s.bank > 0 ? -1 : 1;
      const chevPost = new THREE.Mesh(
        chevronPostGeo,
        new THREE.MeshStandardMaterial({ color: "#334155" })
      );
      const chevBoard = new THREE.Mesh(
        chevronBoardGeo,
        new THREE.MeshStandardMaterial({ color: "#eab308", roughness: 0.35 })
      );
      chevBoard.position.set(0, 0.55, 0);
      const chevGroup = new THREE.Group();
      chevGroup.position.set(
        s.x + s.normalX * (s.halfWidth + 1.6) * outerSign,
        s.y + 0.2,
        s.z + s.normalZ * (s.halfWidth + 1.6) * outerSign
      );
      chevGroup.rotation.y = s.heading + (outerSign < 0 ? Math.PI : 0);
      chevGroup.add(chevPost, chevBoard);
      landmarkGroup.add(chevGroup);
    }

    // 6. Landmarks along SP140 (Bridges, Signs, Hamlets)
    if (s.landmark === "bridge") {
      const arch = new THREE.Mesh(
        new THREE.BoxGeometry(s.halfWidth * 2.6, 5.0, 14),
        new THREE.MeshStandardMaterial({ color: "#8c827a", roughness: 0.95, flatShading: true })
      );
      arch.position.set(s.x, s.y - 2.5, s.z);
      arch.rotation.y = s.heading;
      landmarkGroup.add(arch);

      for (const side of [-1, 1]) {
        const parapet = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.9, 14),
          new THREE.MeshStandardMaterial({ color: "#a8a29e", roughness: 0.9 })
        );
        parapet.position.set(s.x + s.normalX * (s.halfWidth + 0.4) * side, s.y + 0.45, s.z + s.normalZ * (s.halfWidth + 0.4) * side);
        parapet.rotation.y = s.heading;
        landmarkGroup.add(parapet);
      }
    } else if (s.landmark === "sign") {
      const signGroup = new THREE.Group();
      const signPost = new THREE.Mesh(
        signPostGeo,
        new THREE.MeshStandardMaterial({ color: "#475569" })
      );
      signPost.position.set(0, 0.9, 0);

      const signPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.38, 0.04),
        new THREE.MeshStandardMaterial({ color: "#0284c7", roughness: 0.3 })
      );
      signPlate.position.set(0, 1.45, 0);

      const caiPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.9, 0.08),
        new THREE.MeshStandardMaterial({ color: "#78350f", roughness: 0.85 })
      );
      caiPost.position.set(0.6, 0.45, 0);

      const caiStripeR1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.08, 0.09),
        new THREE.MeshStandardMaterial({ color: "#dc2626" })
      );
      caiStripeR1.position.set(0.6, 0.75, 0);

      const caiStripeW = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.08, 0.09),
        new THREE.MeshStandardMaterial({ color: "#f8fafc" })
      );
      caiStripeW.position.set(0.6, 0.67, 0);

      const caiStripeR2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.08, 0.09),
        new THREE.MeshStandardMaterial({ color: "#dc2626" })
      );
      caiStripeR2.position.set(0.6, 0.59, 0);

      signGroup.add(signPost, signPlate, caiPost, caiStripeR1, caiStripeW, caiStripeR2);
      signGroup.position.set(s.x + s.normalX * (s.halfWidth + 1.4), s.y, s.z + s.normalZ * (s.halfWidth + 1.4));
      signGroup.rotation.y = s.heading;
      landmarkGroup.add(signGroup);
    } else if (s.landmark === "hamlet" && s.s >= 50) {
      const houseColors = ["#e2d5c3", "#d8b28a", "#c49a7a", "#ecd9b8"];
      const shutterColors = ["#14532d", "#1e3a8a", "#451a03", "#166534"];

      for (let h = -1; h <= 1; h += 2) {
        const colorIdx = Math.abs(Math.floor(s.s / 40) + h) % houseColors.length;
        const houseGroup = new THREE.Group();

        const setback = s.halfWidth + 4.8 + ((i % 3) * 1.2);
        const hW = 6.4;
        const hD = 5.2;
        const hH = 5.4;

        const baseGeo = new THREE.BoxGeometry(hW + 0.2, 2.4, hD + 0.2);
        const baseMat = new THREE.MeshStandardMaterial({ color: "#6b655b", roughness: 0.95, flatShading: true });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.set(0, -0.4, 0);
        base.castShadow = true;
        base.receiveShadow = true;

        const bodyGeo = new THREE.BoxGeometry(hW, hH, hD);
        const bodyMat = new THREE.MeshStandardMaterial({ color: houseColors[colorIdx], roughness: 0.88 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, hH / 2 + 0.8, 0);
        body.castShadow = true;
        body.receiveShadow = true;

        const roofGeo = new THREE.ConeGeometry((hW / 2) * 1.35, 2.4, 4);
        const roofMat = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.82 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, hH + 1.9, 0);
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;

        const winGeo = new THREE.BoxGeometry(0.75, 1.05, 0.06);
        const winMat = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.3 });
        const shutGeo = new THREE.BoxGeometry(0.38, 1.05, 0.08);
        const shutMat = new THREE.MeshStandardMaterial({ color: shutterColors[colorIdx], roughness: 0.7 });

        const faceZ = -(hD / 2 + 0.04);
        for (const winX of [-1.8, 1.8]) {
          for (const winY of [2.4, 4.6]) {
            const win = new THREE.Mesh(winGeo, winMat);
            win.position.set(winX, winY, faceZ);

            const shutL = new THREE.Mesh(shutGeo, shutMat);
            shutL.position.set(winX - 0.45, winY, faceZ + 0.02);
            const shutR = new THREE.Mesh(shutGeo, shutMat);
            shutR.position.set(winX + 0.45, winY, faceZ + 0.02);

            houseGroup.add(win, shutL, shutR);
          }
        }

        const doorGeo = new THREE.BoxGeometry(1.1, 2.1, 0.08);
        const doorMat = new THREE.MeshStandardMaterial({ color: "#451a03", roughness: 0.8 });
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0, 1.85, faceZ);
        houseGroup.add(door);

        const chimGeo = new THREE.BoxGeometry(0.55, 1.6, 0.55);
        const chimMat = new THREE.MeshStandardMaterial({ color: "#991b1b", roughness: 0.9 });
        const chimney = new THREE.Mesh(chimGeo, chimMat);
        chimney.position.set(1.6, hH + 2.4, 0.8);
        chimney.castShadow = true;
        houseGroup.add(chimney);

        const isDrop = (h < 0 && s.exposure === "left") || (h > 0 && s.exposure === "right");
        if (isDrop && (s.dropDepth ?? 0) > 20) continue;

        houseGroup.add(base, body, roof);
        houseGroup.position.set(
          s.x + s.normalX * setback * h,
          s.y - 0.20,
          s.z + s.normalZ * setback * h
        );
        houseGroup.rotation.y = s.heading + (h > 0 ? -Math.PI / 2 : Math.PI / 2);
        landmarkGroup.add(houseGroup);
      }
    }
  }
}
