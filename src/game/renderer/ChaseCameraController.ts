/**
 * VAL BORBERA HILLCLIMB — Chase Camera Controller
 * Smooth spring-damper camera tracking, speed-dependent dynamic FOV, lookahead target,
 * high-speed camera shake, lateral G camera roll, and altitude-based fog/sky transitions.
 */

import * as THREE from "three";
import { EngineRenderState } from "../Engine";

export class ChaseCameraController {
  private camPos: THREE.Vector3 = new THREE.Vector3();
  private camLookAt: THREE.Vector3 = new THREE.Vector3();
  private camInitialised: boolean = false;

  // Haze endpoints, allocated once. `fogLow` matches the renderer's own background/fog
  // colour so valley air agrees with the scene setup; `fogHigh` is the same hue lifted and
  // desaturated slightly for thinner air at altitude.
  private readonly fogLow = new THREE.Color("#7891a8");
  private readonly fogHigh = new THREE.Color("#9fb3c8");
  private readonly fogScratch = new THREE.Color();

  public reset(): void {
    this.camInitialised = false;
  }

  public update(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    dirLight: THREE.DirectionalLight,
    s: EngineRenderState,
    deltaSeconds: number
  ): void {
    const speedRatio = Math.min(1.0, s.speedMs / 55.0);
    const sinH = Math.sin(s.heading);
    const cosH = Math.cos(s.heading);

    // 1. Speed-dependent Dynamic FOV
    const targetFov = 60 + speedRatio * 18;
    camera.fov += (targetFov - camera.fov) * Math.min(1.0, deltaSeconds * 6.0);
    camera.updateProjectionMatrix();

    // 2. Camera offsets & high-speed vibration
    const camDist = 6.2 + speedRatio * 1.5;
    const camHeight = 2.4 + speedRatio * 0.4;
    const lookAheadDist = 6.0 + speedRatio * 14.0;
    const speedShake = s.speedKmh > 130 ? (Math.random() - 0.5) * 0.03 * ((s.speedKmh - 130) / 70) : 0;

    const targetCamX = s.pos.x - sinH * camDist;
    const targetCamY = s.pos.y + camHeight + speedShake;
    const targetCamZ = s.pos.z - cosH * camDist;

    const targetLookX = s.pos.x + sinH * lookAheadDist;
    const targetLookY = s.pos.y + 1.1;
    const targetLookZ = s.pos.z + cosH * lookAheadDist;

    const lerpRate = this.camInitialised ? Math.min(1.0, deltaSeconds * 8.5) : 1.0;
    this.camInitialised = true;

    this.camPos.x += (targetCamX - this.camPos.x) * lerpRate;
    this.camPos.y += (targetCamY - this.camPos.y) * lerpRate;
    this.camPos.z += (targetCamZ - this.camPos.z) * lerpRate;

    this.camLookAt.x += (targetLookX - this.camLookAt.x) * lerpRate;
    this.camLookAt.y += (targetLookY - this.camLookAt.y) * lerpRate;
    this.camLookAt.z += (targetLookZ - this.camLookAt.z) * lerpRate;

    camera.position.copy(this.camPos);
    camera.lookAt(this.camLookAt);
    camera.rotation.z += -s.steer * speedRatio * 0.035; // Subtle lateral G roll

    // 3. Dynamic Sun Light Tracking
    dirLight.position.set(
      s.pos.x - sinH * 35 - cosH * 25,
      s.pos.y + 60,
      s.pos.z - cosH * 35 + sinH * 25
    );
    dirLight.target.position.set(s.pos.x, s.pos.y, s.pos.z);
    dirLight.target.updateMatrixWorld();

    // 4. Dynamic Sky / Fog tone based on altitude
    //
    // Two bugs lived here. The colours were the pre-unified-terrain palette, so this
    // overwrote the horizon colour the renderer sets up every single frame — the fog tuning
    // that makes distant ridges fade into haze was being undone as fast as it was applied.
    // The endpoints are now derived from that colour instead of hardcoded against it.
    //
    // And both Colors were allocated fresh on every frame, on the hottest path in the app:
    // two garbage objects per frame, ~120/second, purely to interpolate between two
    // constants. They are hoisted to instance fields and lerped into a scratch colour.
    const altNorm = Math.max(0, Math.min(1, (s.altitude - 500) / 1100));
    this.fogScratch.lerpColors(this.fogLow, this.fogHigh, altNorm);
    if (scene.fog) {
      (scene.fog as THREE.FogExp2).color.copy(this.fogScratch);
      (scene.background as THREE.Color).copy(this.fogScratch);
    }
  }
}
