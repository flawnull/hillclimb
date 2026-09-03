/**
 * VAL BORBERA HILLCLIMB — Roadside Furniture & Props Builder
 * Generates guardrails, W-beams, reflectors, retaining stone walls, apex kerbs with banking,
 * milestone cippi, tornante chevron boards, start/finish gantries, and historic landmarks.
 */

import * as THREE from "three";
import { SplineSample } from "./TrackSpline";
import { buildHamlet, BuildingFootprint } from "./HamletBuilder";

function detNormalizeAngle(a: number): number {
  let res = a;
  while (res > Math.PI) res -= 2 * Math.PI;
  while (res < -Math.PI) res += 2 * Math.PI;
  return res;
}


/**
 * Finds a lateral offset at which a prop is clear of EVERY carriageway, not just the one it
 * belongs to.
 *
 * A prop is positioned from its own sample's `halfWidth`, and that is not enough twice over.
 * The spline interpolates width between control points, so a few metres along the road can
 * be wider than the prop assumed — the reason KERB_CLEARANCE was raised from 0.30 to 0.80
 * once already. And on a switchback the leg above or below passes close enough that an
 * offset measured from this leg lands inside that one: measured on Salita di Cosola, the
 * worst guardrail post sat 4.88 m inside another leg's lane and the worst apex kerb 3.75 m
 * inside one.
 *
 * Rather than reject the prop — a missing guardrail is an invisible wall, since Engine.ts
 * applies solid collision wherever `guardrail` is set — the offset is pushed outward in
 * small steps until it clears, and only abandoned if it cannot. Samples more than
 * VERTICAL_REACH below or above are ignored: a leg thirty metres down is not something a
 * kerb can be standing in.
 */
function clearOffset(
  samples: SplineSample[],
  s: SplineSample,
  side: number,
  startOffset: number,
  margin: number
): number | null {
  const VERTICAL_REACH = 2.5;
  const STEP = 0.25;
  const MAX_PUSH = 3.0;

  for (let off = startOffset; off <= startOffset + MAX_PUSH + 1e-9; off += STEP) {
    const x = s.x + s.normalX * off * side;
    const z = s.z + s.normalZ * off * side;

    // Mirror TrackSpline.projectFrenet exactly: it picks the NEAREST sample in 2D and then
    // reports the lateral offset against that sample's own normal. Any other rule (euclidean
    // distance to the sample, or a window along the tangent) can disagree with it, which is
    // how a post cleared a hand-rolled check by 4 m and still projected 0.28 m inside the
    // lane at a hairpin, where the normals rotate faster than the samples advance.
    //
    // Samples more than VERTICAL_REACH away in height are excluded, unlike projectFrenet,
    // which is height-blind: a carriageway twenty metres below is not something a kerb can be
    // standing in, and treating it as one would strip the furniture off every switchback.
    let bestLat = Infinity;
    let bestHw = 0;
    let bestDistSq = Infinity;
    for (const other of samples) {
      if (Math.abs(other.y - s.y) > VERTICAL_REACH) continue;
      const dx = x - other.x;
      const dz = z - other.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= bestDistSq) continue;
      bestDistSq = distSq;
      bestLat = Math.abs(dx * other.normalX + dz * other.normalZ);
      bestHw = other.halfWidth;
    }

    if (bestDistSq === Infinity || bestLat >= bestHw + margin) return off;
  }
  return null;
}

export function buildRoadsideFurniture(
  samples: SplineSample[],
  landmarkGroup: THREE.Group,
  guardrailGroup: THREE.Group,
  /**
   * Terrain height at a world point. Optional so the builder still works without a field
   * (tests construct RoadMesh alone), in which case props fall back to road height.
   *
   * Buildings need this. Everything else here — guardrails, kerbs, signs — hugs the
   * carriageway, where road height IS ground height. A house stands 10-14 m back, and over
   * that distance the hillside has usually moved, so placing it at the road's height left it
   * hovering in the air on the downhill side.
   */
  groundAt?: (x: number, z: number) => number
): BuildingFootprint[] {
  // --- Hamlets ------------------------------------------------------------------------
  //
  // Built from ANCHORS collected up front, not from inside the per-sample loop.
  // `TrackBuilder.village()` marks two consecutive samples about two metres apart, and the
  // loop below visits both, so a hamlet used to be generated twice — and since its seed was
  // `floor(s.s / 7)`, both generations fell in the same bucket and produced the same houses
  // two metres apart. That interpenetrating duplicate is what "two types of house right next
  // to each other" was. Grouping marked samples that are within HAMLET_GROUP_GAP_M of one
  // another leaves exactly one anchor per village, the same way Engine groups hairpin apex
  // flags into one tornante.
  const HAMLET_GROUP_GAP_M = 40;
  let lastHamletS = -Infinity;
  const buildings: BuildingFootprint[] = [];
  for (const s of samples) {
    if (s.landmark !== "hamlet" || s.s < 50) continue;
    if (s.s - lastHamletS < HAMLET_GROUP_GAP_M) continue;
    lastHamletS = s.s;
    buildings.push(...buildHamlet(s, samples, landmarkGroup, groundAt));
  }

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
    /** SIGNED turn across this station: positive is a turn toward +normal. */
    const turn = detNormalizeAngle(nextS.heading - prevS.heading);
    const dHeading = Math.abs(turn);
    const isCurving = dHeading > 0.04;
    const hw = s.halfWidth + (isCurving ? 0.95 : 0.70);

    // 1. Guardrails on the exposed side — on BOTH sides where both are exposed.
    //
    // This used to read `s.exposure === "left" ? -1 : 1`, a single side, and Engine.ts does
    // not agree with that: it treats `guardrail` as protecting whichever side the car leaves
    // (`isExposed && !guardrail` is what triggers the fall, so a guarded sample gets solid
    // wall collision on either side). On the 110 samples of Borbera Sprint marked
    // `exposure: 'both'` with a rail, the left-hand rail was therefore never drawn while the
    // physics still stopped the car dead there — an invisible wall.
    const guardSides: readonly (-1 | 1)[] =
      s.exposure === "both" ? [-1, 1] : [s.exposure === "left" ? -1 : 1];
    if (s.guardrail) {
     for (const sideSign of guardSides) {
      const railOffset = clearOffset(samples, s, sideSign, hw, 0.35);
      if (railOffset === null) continue;
      const posX = s.x + s.normalX * railOffset * sideSign;
      const posY = s.y + 0.38;
      const posZ = s.z + s.normalZ * railOffset * sideSign;

      const post = new THREE.Mesh(postGeo, postMat);
      // Named so tests can find them after the group is merged by batchStaticGroup, and so
      // an unbatched build can assert which side of the road they landed on.
      post.name = "guardrail-post";
      post.position.set(posX, posY, posZ);
      post.castShadow = true;
      guardrailGroup.add(post);

      if (i < samples.length - 3 && samples[i + 2].guardrail) {
        const nextGuardS = samples[i + 2];
        const nextIsCurving = Math.abs(detNormalizeAngle(samples[Math.min(samples.length - 1, i + 4)].heading - s.heading)) > 0.04;
        const nextBaseHw = nextGuardS.halfWidth + (nextIsCurving ? 0.95 : 0.70);
        // Follow this rail's own side into the next post rather than re-deriving it, so a
        // run that changes exposure does not draw a beam diagonally across the carriageway.
        const nextSideSign =
          nextGuardS.exposure === "both" ? sideSign : nextGuardS.exposure === "left" ? -1 : 1;
        // And where the sides genuinely differ — the exposure flips from one side of the
        // road to the other between two guarded samples — the run must BREAK rather than
        // reach across. Following the side through was not enough on its own: with
        // `exposure: 'left'` next to `exposure: 'right'`, this beam spanned the full width
        // of the carriageway at windscreen height, a solid steel bar straight across the
        // road you are driving down.
        if (nextSideSign !== sideSign) continue;
        const nextHw = clearOffset(samples, nextGuardS, nextSideSign, nextBaseHw, 0.35);
        if (nextHw === null) continue;
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
    }

    // 2. (removed) Stone retaining walls on the mountain side.
    //
    // These were 3.2 m x 1.4 m x 0.6 m boxes dropped every fourth sample at a FIXED height
    // of `s.y + 0.6` — road height, never the ground's. Nothing grounded them, so on any
    // slope they hung in the air or sank; nothing joined them, so they read as a dashed row
    // of detached slabs rather than as a wall; and seen from below the road they were the
    // black blocks flanking the carriageway that made the road itself look like a thick wall
    // from off-axis. They also depicted something that is not there: the carve profile
    // (roadProfile.ts, CUT_SLOPE = 0.42) rises about 0.65 m over the first five metres on
    // the cut side, which is a grass bank, not a face that needs retaining. Structure the
    // road genuinely needs is built from the height field itself, in TerrainSystem's
    // embankment/viaduct pass, where the ground height is actually known.

    // The inside of the corner, from the geometry rather than from the banking.
    //
    // `s.bank > 0 ? 1 : -1` was standing in for this, and banking is not a reliable proxy:
    // 32 curving samples on Borbera Sprint and 49 on Salita di Cosola carry `bank === 0`, so
    // the ternary fell through to -1 and put the apex kerb on the OUTSIDE of every
    // right-hand corner it touched, with the chevron board opposite it on the inside. A
    // further 9 and 27 samples respectively carry a bank whose sign disagrees with the
    // direction the road actually turns. The centre of curvature lies on the +normal side
    // exactly when the heading is increasing (normal = (cos h, -sin h) and the tangent's
    // derivative is normal * dh/ds), so the sign of the turn IS the inside.
    const insideSign = turn > 0 ? 1 : -1;

    // 3. Apex Kerbs on Curves with active curvature
    if (isCurving) {
      const sinB = Math.sin(s.bank);
      const cosB = Math.cos(s.bank);
      const upX = -s.normalX * sinB;
      const upY = cosB;
      const upZ = -s.normalZ * sinB;

      // Clearance from the lane edge.
      //
      // 0.30 m was too tight. The kerb is placed using the halfWidth of ITS OWN sample, but
      // the spline interpolates width between control points, so a few metres further along
      // the carriageway can be wider than the kerb assumed — and a kerb block has width of
      // its own on top of that. On the tighter stage layout this put a kerb 5 cm inside the
      // driving lane. Half a metre absorbs both the interpolation and the block.
      const KERB_CLEARANCE = 0.80;
      const kerbOffset = clearOffset(samples, s, insideSign, s.halfWidth + KERB_CLEARANCE, 0.45);
      if (kerbOffset !== null) {
      const kerb = new THREE.Mesh(kerbGeo, i % 4 === 0 ? kerbMatRed : kerbMatWhite);
      kerb.name = "apex-kerb";
      kerb.position.set(
        s.x + s.normalX * kerbOffset * insideSign + upX * 0.04,
        s.y + upY * 0.04,
        s.z + s.normalZ * kerbOffset * insideSign + upZ * 0.04
      );
      kerb.rotation.y = s.heading;
      kerb.rotation.z = s.bank;
      landmarkGroup.add(kerb);
      }
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
      const outerSign = -insideSign;
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
      chevGroup.name = "chevron";
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
    }
  }

  return buildings;
}
