/**
 * VAL BORBERA HILLCLIMB — Vegetation & Scenery Scatter Builder
 * Generates instanced multi-species trees (Italian Stone Pines, Cypresses, Olive Trees, Chestnuts, Boulders)
 * with authentic per-part vertex colors and spline-grounded placement.
 */

import * as THREE from "three";
import { TrackSpline } from "./TrackSpline";
import { terrainHeightAt } from "./Terrain";

const colorGeo = (geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry => {
  const col = new THREE.Color(hex);
  const posCount = geo.attributes.position.count;
  const colors = new Float32Array(posCount * 3);
  for (let i = 0; i < posCount; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
};

const mergeGeometries = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.array.length;
    if (g.index) totalIndices += g.index.array.length;
  }

  const combinedPos = new Float32Array(totalVerts);
  const combinedCol = new Float32Array(totalVerts);
  const combinedIdx = new Uint32Array(totalIndices);

  let posOffset = 0;
  let idxOffset = 0;
  let vertCount = 0;

  for (const g of geos) {
    const pos = g.attributes.position.array as Float32Array;
    combinedPos.set(pos, posOffset);

    const col = g.attributes.color?.array as Float32Array;
    if (col) {
      combinedCol.set(col, posOffset);
    }

    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) {
        combinedIdx[idxOffset + i] = idx[i] + vertCount;
      }
      idxOffset += idx.length;
    }

    vertCount += pos.length / 3;
    posOffset += pos.length;
  }

  const combinedGeo = new THREE.BufferGeometry();
  combinedGeo.setAttribute("position", new THREE.BufferAttribute(combinedPos, 3));
  combinedGeo.setAttribute("color", new THREE.BufferAttribute(combinedCol, 3));
  if (totalIndices > 0) {
    combinedGeo.setIndex(new THREE.BufferAttribute(combinedIdx, 1));
  }
  combinedGeo.computeVertexNormals();
  return combinedGeo;
};

export function buildInstancedVegetation(spline: TrackSpline, vegetationGroup: THREE.Group): void {
  const samples = spline.getAllSamples();
  const count = Math.min(450, Math.floor(samples.length * 1.1));

  // 1. Italian Stone Pine
  const pineTrunk = colorGeo(new THREE.CylinderGeometry(0.20, 0.36, 5.2, 8), "#4a2c11");
  pineTrunk.translate(0, 2.6, 0);
  const pineTier1 = colorGeo(new THREE.ConeGeometry(3.8, 1.6, 12), "#1b431b");
  pineTier1.translate(0, 5.4, 0);
  const pineTier2 = colorGeo(new THREE.ConeGeometry(2.6, 1.4, 10), "#235323");
  pineTier2.translate(0, 6.2, 0);
  const pineGeo = mergeGeometries([pineTrunk, pineTier1, pineTier2]);
  const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.FrontSide, transparent: false, depthWrite: true });
  const pineMesh = new THREE.InstancedMesh(pineGeo, pineMat, count);

  // 2. Ligurian Cypress
  const cypTrunk = colorGeo(new THREE.CylinderGeometry(0.18, 0.26, 1.8, 8), "#3d2b1f");
  cypTrunk.translate(0, 0.9, 0);
  const cypCone = colorGeo(new THREE.ConeGeometry(1.2, 6.8, 10), "#143314");
  cypCone.translate(0, 4.8, 0);
  const cypGeo = mergeGeometries([cypTrunk, cypCone]);
  const cypMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.80, side: THREE.FrontSide, transparent: false, depthWrite: true });
  const cypMesh = new THREE.InstancedMesh(cypGeo, cypMat, count);

  // 3. Ligurian Olive Trees
  const oliveTrunk = colorGeo(new THREE.CylinderGeometry(0.26, 0.42, 2.6, 8), "#5c4a38");
  oliveTrunk.translate(0, 1.3, 0);
  const oliveLobe1 = colorGeo(new THREE.SphereGeometry(2.0, 8, 8), "#556b2f");
  oliveLobe1.translate(0, 3.2, 0);
  const oliveLobe2 = colorGeo(new THREE.SphereGeometry(1.6, 8, 8), "#6b8e23");
  oliveLobe2.translate(0.6, 3.6, 0.3);
  const oliveGeo = mergeGeometries([oliveTrunk, oliveLobe1, oliveLobe2]);
  const oliveMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.FrontSide, transparent: false, depthWrite: true });
  const oliveMesh = new THREE.InstancedMesh(oliveGeo, oliveMat, count);

  // 4. Mountain Chestnut & Beech Woods
  const chestnutTrunk = colorGeo(new THREE.CylinderGeometry(0.32, 0.50, 3.8, 8), "#3b2314");
  chestnutTrunk.translate(0, 1.9, 0);
  const chestnutLobe1 = colorGeo(new THREE.SphereGeometry(3.0, 9, 9), "#2d5a27");
  chestnutLobe1.translate(0, 4.4, 0);
  const chestnutLobe2 = colorGeo(new THREE.SphereGeometry(2.2, 8, 8), "#387030");
  chestnutLobe2.translate(-0.8, 5.0, 0.6);
  const chestnutGeo = mergeGeometries([chestnutTrunk, chestnutLobe1, chestnutLobe2]);
  const chestnutMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.80, side: THREE.FrontSide, transparent: false, depthWrite: true });
  const chestnutMesh = new THREE.InstancedMesh(chestnutGeo, chestnutMat, count);

  // 5. Limestone Boulders
  const rockGeo = new THREE.DodecahedronGeometry(2.2, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#94a3b8", roughness: 0.92, flatShading: true });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, count);

  const dummy = new THREE.Object3D();
  let pineIdx = 0;
  let cypIdx = 0;
  let oliveIdx = 0;
  let chestnutIdx = 0;
  let rockIdx = 0;

  for (let i = 2; i < samples.length - 2; i += 3) {
    const s = samples[i];
    const alt = s.altitude;
    const numTreesAtStation = (i % 5 === 0) ? 2 : 1;

    for (let k = 0; k < numTreesAtStation; k++) {
      const hash = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      const rand = hash - Math.floor(hash);

      const side = rand > 0.5 ? 1 : -1;
      const isRiverSide =
        (side < 0 && (s.exposure === "left" || s.exposure === "both")) ||
        (side > 0 && (s.exposure === "right" || s.exposure === "both"));

      const maxTreeDist = isRiverSide ? 42.0 : 34.0;
      const dist = s.halfWidth + 3.6 + rand * maxTreeDist + k * 6.0;
      const posX = s.x + s.normalX * dist * side + (rand - 0.5) * 3.0;
      const pz = s.z + s.normalZ * dist * side + (rand - 0.5) * 3.0;

      const proj = spline.projectFrenet(posX, pz);
      if (Math.abs(proj.t) <= proj.sample.halfWidth + 2.8 || Math.abs(proj.t) > 60.0) {
        continue;
      }

      // Embed slightly into ground (-0.6) to avoid floating above coarse terrain mesh triangles
      const posY = terrainHeightAt(proj.sample, proj.t) - 0.6;

      const scale = 0.85 + rand * 0.45;
      dummy.position.set(posX, posY, pz);
      dummy.scale.set(scale, scale * (0.95 + rand * 0.15), scale);
      dummy.rotation.y = rand * Math.PI * 2;
      dummy.updateMatrix();

      if (isRiverSide && rand > 0.65 && rockIdx < count) {
        dummy.position.y = posY + 0.6;
        dummy.scale.set(1.2 + rand * 0.6, 0.7 + rand * 0.4, 1.2 + rand * 0.6);
        dummy.updateMatrix();
        rockMesh.setMatrixAt(rockIdx++, dummy.matrix);
      } else if (alt < 620) {
        if (rand > 0.4 && oliveIdx < count) {
          oliveMesh.setMatrixAt(oliveIdx++, dummy.matrix);
        } else if (cypIdx < count) {
          cypMesh.setMatrixAt(cypIdx++, dummy.matrix);
        }
      } else if (alt >= 620 && alt < 980) {
        if (rand > 0.35 && pineIdx < count) {
          pineMesh.setMatrixAt(pineIdx++, dummy.matrix);
        } else if (chestnutIdx < count) {
          chestnutMesh.setMatrixAt(chestnutIdx++, dummy.matrix);
        }
      } else if (chestnutIdx < count) {
        chestnutMesh.setMatrixAt(chestnutIdx++, dummy.matrix);
      }
    }
  }

  pineMesh.count = pineIdx;
  cypMesh.count = cypIdx;
  oliveMesh.count = oliveIdx;
  chestnutMesh.count = chestnutIdx;
  rockMesh.count = rockIdx;

  pineMesh.instanceMatrix.needsUpdate = true;
  cypMesh.instanceMatrix.needsUpdate = true;
  oliveMesh.instanceMatrix.needsUpdate = true;
  chestnutMesh.instanceMatrix.needsUpdate = true;
  rockMesh.instanceMatrix.needsUpdate = true;

  pineMesh.castShadow = true;
  cypMesh.castShadow = true;
  oliveMesh.castShadow = true;
  chestnutMesh.castShadow = true;

  vegetationGroup.add(pineMesh, cypMesh, oliveMesh, chestnutMesh, rockMesh);
}
