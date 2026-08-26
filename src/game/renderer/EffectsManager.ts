/**
 * VAL BORBERA HILLCLIMB — Effects & Particle Manager
 * High-performance GPU particles for tire smoke/gravel dust and dynamic ribbon skid mark meshes.
 */

import * as THREE from "three";
import { EngineRenderState } from "../Engine";

export class EffectsManager {
  private particleCount = 180;
  private particlePositions: Float32Array;
  private particleAges: Float32Array;
  private particleVelocities: Float32Array;
  private smokeGeo: THREE.BufferGeometry;
  public smokePoints: THREE.Points;

  private maxSkidVerts = 600;
  private skidPositions: Float32Array;
  private skidGeo: THREE.BufferGeometry;
  private skidWriteIdx = 0;
  public skidLines: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    // 1. Smoke & Dust Particles
    this.particlePositions = new Float32Array(this.particleCount * 3);
    this.particleAges = new Float32Array(this.particleCount);
    this.particleVelocities = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      this.particleAges[i] = 1.0;
      this.particlePositions[i * 3 + 1] = -100;
    }

    this.smokeGeo = new THREE.BufferGeometry();
    this.smokeGeo.setAttribute("position", new THREE.BufferAttribute(this.particlePositions, 3));
    const smokeMat = new THREE.PointsMaterial({
      size: 0.8,
      color: "#e2e8f0",
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.smokePoints = new THREE.Points(this.smokeGeo, smokeMat);
    scene.add(this.smokePoints);

    // 2. Skid Mark Line Segments
    this.skidPositions = new Float32Array(this.maxSkidVerts * 3);
    this.skidGeo = new THREE.BufferGeometry();
    this.skidGeo.setAttribute("position", new THREE.BufferAttribute(this.skidPositions, 3));
    const skidMat = new THREE.LineBasicMaterial({
      color: "#18181b",
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    this.skidLines = new THREE.LineSegments(this.skidGeo, skidMat);
    scene.add(this.skidLines);
  }

  public update(s: EngineRenderState, deltaSeconds: number): void {
    const posAttr = this.smokeGeo.attributes.position as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;

    const sinH = Math.sin(s.heading);
    const cosH = Math.cos(s.heading);

    // Emit smoke on drift / hard brake
    if ((s.isSliding || s.brake > 0.6 || s.handbrake) && s.speedMs > 4.5) {
      for (let k = 0; k < 2; k++) {
        const idx = Math.floor(Math.random() * this.particleCount);
        this.particleAges[idx] = 0;
        const sideOffset = (Math.random() - 0.5) * 1.5;
        positions[idx * 3] = s.pos.x - sinH * 1.30 + cosH * sideOffset;
        positions[idx * 3 + 1] = s.pos.y + 0.12;
        positions[idx * 3 + 2] = s.pos.z - cosH * 1.30 - sinH * sideOffset;

        this.particleVelocities[idx * 3] = (Math.random() - 0.5) * 2;
        this.particleVelocities[idx * 3 + 1] = 0.8 + Math.random() * 1.2;
        this.particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 2;
      }
    }

    // Step active particles
    for (let i = 0; i < this.particleCount; i++) {
      if (this.particleAges[i] < 1.0) {
        this.particleAges[i] += deltaSeconds * 1.8;
        positions[i * 3] += this.particleVelocities[i * 3] * deltaSeconds;
        positions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * deltaSeconds;
        positions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * deltaSeconds;
      } else {
        positions[i * 3 + 1] = -100;
      }
    }
    posAttr.needsUpdate = true;

    // Record tire skid lines
    if ((s.isSliding || s.brake > 0.4 || s.handbrake) && s.speedMs > 4.5 && this.skidGeo) {
      const rearX = s.pos.x - sinH * 1.30;
      const rearZ = s.pos.z - cosH * 1.30;
      const lX = rearX - cosH * 0.82;
      const lZ = rearZ + sinH * 0.82;
      const rX = rearX + cosH * 0.82;
      const rZ = rearZ - sinH * 0.82;
      const y = s.pos.y + 0.025;

      const attr = this.skidGeo.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;

      const idx = (this.skidWriteIdx % (this.maxSkidVerts - 6)) * 3;
      arr[idx] = lX; arr[idx + 1] = y; arr[idx + 2] = lZ;
      arr[idx + 3] = lX - sinH * 0.5; arr[idx + 4] = y; arr[idx + 5] = lZ - cosH * 0.5;

      arr[idx + 6] = rX; arr[idx + 7] = y; arr[idx + 8] = rZ;
      arr[idx + 9] = rX - sinH * 0.5; arr[idx + 10] = y; arr[idx + 11] = rZ - cosH * 0.5;

      this.skidWriteIdx += 4;
      attr.needsUpdate = true;
    }
  }

  public clear(): void {
    for (let i = 0; i < this.particleCount; i++) {
      this.particleAges[i] = 1.0;
      this.particlePositions[i * 3 + 1] = -100;
    }
    (this.smokeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    this.skidPositions.fill(0);
    this.skidWriteIdx = 0;
    (this.skidGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
