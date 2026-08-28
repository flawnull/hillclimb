/**
 * VAL BORBERA HILLCLIMB — Effects & Particle Manager
 * High-performance GPU particles for tire smoke/gravel dust and dynamic ribbon skid mark meshes.
 */

import * as THREE from "three";
import { EngineRenderState } from "../Engine";

export class EffectsManager {
  private scene: THREE.Scene;
  private particleCount = 180;
  private particlePositions: Float32Array;
  private particleAges: Float32Array;
  private particleVelocities: Float32Array;
  /** Carries the fractional particle count between frames so emission is rate-based. */
  private emitAccumulator = 0;
  private puffTexture: THREE.CanvasTexture | null = null;
  private smokeGeo: THREE.BufferGeometry;
  public smokePoints: THREE.Points;

  private maxSkidVerts = 600;
  private skidPositions: Float32Array;
  private skidGeo: THREE.BufferGeometry;
  private skidWriteIdx = 0;
  public skidLines: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

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
    // A soft round sprite. An untextured PointsMaterial draws hard squares, which read as
    // grey boxes rather than smoke once the particles are actually visible.
    // Guarded like the other Canvas-generated textures in this project: the resource-disposal
    // suite constructs an EffectsManager under node:test, where `document` does not exist.
    // Without a map the points fall back to hard squares, which only affects headless runs.
    if (typeof document !== "undefined") {
      const puff = document.createElement("canvas");
      puff.width = 64;
      puff.height = 64;
      const pctx = puff.getContext("2d");
      if (pctx) {
        const grad = pctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(0.45, "rgba(255,255,255,0.45)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        pctx.fillStyle = grad;
        pctx.fillRect(0, 0, 64, 64);
      }
      this.puffTexture = new THREE.CanvasTexture(puff);
    }

    // Sizing note: these values were re-tuned AFTER fixing the frustum-culling bug above.
    // While the system was invisible, size and opacity kept being raised to try to see it;
    // once it actually drew, that made braking fill half the screen. These are what look
    // right with the effect genuinely rendering.
    const smokeMat = new THREE.PointsMaterial({
      size: 0.85,
      map: this.puffTexture ?? undefined,
      color: "#e8edf3",
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.smokePoints = new THREE.Points(this.smokeGeo, smokeMat);
    // THE reason smoke never appeared, independent of any emission threshold.
    //
    // three.js computes a geometry's bounding sphere ONCE, lazily, and caches it. Every
    // particle starts parked at y = -100 (the "dead" position), so the cached sphere says
    // this object sits a hundred metres below the world. The particles then get written to
    // the car's position at y ~ 560, but the stale sphere is what the frustum test uses — so
    // the entire point cloud was culled every frame and never drawn, however many particles
    // were live. Measured 27 active particles while braking at 61 km/h with nothing on screen.
    //
    // Recomputing the sphere per frame would mean scanning all 180 particles every frame for
    // no benefit; a particle system that is always near the camera simply should not be
    // frustum-tested.
    this.smokePoints.frustumCulled = false;
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
    // Same stale-bounding-sphere trap as the smoke above: the skid buffer also starts zeroed
    // and is filled in later at track altitude, so it was being culled too.
    this.skidLines.frustumCulled = false;
    scene.add(this.skidLines);
  }

  public update(s: EngineRenderState, deltaSeconds: number): void {
    const posAttr = this.smokeGeo.attributes.position as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;

    const sinH = Math.sin(s.heading);
    const cosH = Math.cos(s.heading);

    // Emit smoke on drift / hard brake.
    //
    // Two things were wrong here. The speed gate was 4.5 m/s — 16 km/h — so braking hard
    // from a standstill or in slow corners produced nothing at all, which read as the effect
    // being broken rather than as a deliberate threshold. And emission was a flat two
    // particles per FRAME, making the whole effect frame-rate dependent: twice the smoke at
    // 120 fps as at 60, on identical driving.
    //
    // Now the trigger has an intensity rather than being a switch. It fades in from 2.0 m/s
    // instead of snapping on at 4.5, scales with how hard the tyres are actually being
    // abused, and drives a rate in particles per SECOND that is integrated over the frame
    // time, so the visual result is the same regardless of refresh rate.
    const speedFade = Math.max(0, Math.min(1, (s.speedMs - 2.0) / 6.0));
    const brakeLoad = s.brake > 0.35 ? (s.brake - 0.35) / 0.65 : 0;
    const abuse = Math.max(s.isSliding ? 1 : 0, s.handbrake ? 1 : 0, brakeLoad);
    const intensity = abuse * speedFade;

    this.emitAccumulator += intensity * 48 * deltaSeconds;
    const toEmit = Math.floor(this.emitAccumulator);
    this.emitAccumulator -= toEmit;

    if (toEmit > 0) {
      for (let k = 0; k < toEmit; k++) {
        const idx = Math.floor(Math.random() * this.particleCount);
        this.particleAges[idx] = 0;
        const sideOffset = (Math.random() - 0.5) * 1.5;
        positions[idx * 3] = s.pos.x - sinH * 1.30 + cosH * sideOffset;
        positions[idx * 3 + 1] = s.pos.y + 0.12;
        positions[idx * 3 + 2] = s.pos.z - cosH * 1.30 - sinH * sideOffset;

        // Harder abuse throws the smoke out faster and wider, so a locked-up stop billows
        // while a light trail-brake only wisps.
        const spread = 1.0 + intensity * 1.6;
        this.particleVelocities[idx * 3] = (Math.random() - 0.5) * 2 * spread;
        this.particleVelocities[idx * 3 + 1] = 0.6 + Math.random() * (0.8 + intensity * 1.0);
        this.particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 2 * spread;
      }
    }

    // Step active particles
    for (let i = 0; i < this.particleCount; i++) {
      if (this.particleAges[i] < 1.0) {
        // Slower ageing: ~0.8 s of life rather than ~0.55 s, so a puff hangs long enough
        // to be seen at speed instead of vanishing almost as it appears.
        this.particleAges[i] += deltaSeconds * 1.25;
        positions[i * 3] += this.particleVelocities[i * 3] * deltaSeconds;
        positions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * deltaSeconds;
        positions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * deltaSeconds;
      } else {
        positions[i * 3 + 1] = -100;
      }
    }
    posAttr.needsUpdate = true;

    // Record tire skid lines
    // Same fade-in point as the smoke above, so marks and smoke appear together rather
    // than the smoke arriving 16 km/h later than the skid it is supposed to accompany.
    if ((s.isSliding || s.brake > 0.4 || s.handbrake) && s.speedMs > 2.5 && this.skidGeo) {
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

  /**
   * Frees the smoke and skid-mark buffers this manager owns. Both `PointsMaterial` and
   * `LineBasicMaterial` here are constructed fresh per instance — never routed through
   * `batchStatics.ts`'s shared `canonicalMaterials` cache — so, unlike the road/guardrail
   * meshes, disposing them outright is safe: nothing else references these instances.
   */
  public dispose(): void {
    this.scene.remove(this.smokePoints);
    this.smokeGeo.dispose();
    this.puffTexture?.dispose();
    (this.smokePoints.material as THREE.Material).dispose();

    this.scene.remove(this.skidLines);
    this.skidGeo.dispose();
    (this.skidLines.material as THREE.Material).dispose();
  }
}
