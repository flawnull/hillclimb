/**
 * VAL BORBERA HILLCLIMB — Raw Three.js High-Performance Renderer
 * Orchestrates 3D mountain stages, corridor terrain, instanced vegetation, road ribbon, and vehicles.
 */

import * as THREE from "three";
import { Engine, EngineRenderState } from "../Engine";
import { CarDef } from "../vehicle/cars";
import { TrackSpline } from "../track/TrackSpline";
import { RoadMesh } from "../track/RoadMesh";
import { Terrain } from "../track/Terrain";
import { QualityTier } from "@/store/gameStore";
import { CarMeshBuilder, CarMeshResult } from "./CarMeshBuilder";
import { ChaseCameraController } from "./ChaseCameraController";
import { EffectsManager } from "./EffectsManager";

const CAMERA_FAR = 900;

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;

  // Track & Terrain Scene Graph
  private roadMesh: RoadMesh | null = null;
  private terrain: Terrain | null = null;
  private trackGroup: THREE.Group;

  // Modular Subsystems
  private cameraController: ChaseCameraController;
  private effectsManager: EffectsManager;

  // Car Scene Objects & Mesh Handle
  private carGroup: THREE.Group;
  private carMeshResult: CarMeshResult | null = null;
  private wheelAngle: number = 0;

  // Lighting & Sky
  private dirLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;

  // Dynamic Quality Auto-Scaler
  private lowFpsTimer = 0;
  private currentDprScale = 1.0;

  // Active Car & Stage
  private activeCar: CarDef;
  private activeColorIndex: number = 0;
  private activeSpline?: TrackSpline;

  constructor(
    canvas: HTMLCanvasElement,
    initialCar: CarDef,
    colorIndex: number = 0,
    spline?: TrackSpline
  ) {
    this.canvas = canvas;
    this.activeCar = initialCar;
    this.activeColorIndex = colorIndex;
    this.activeSpline = spline;

    // 1. Initialize WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // 2. Initialize Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#cbd5e1");
    this.scene.fog = new THREE.FogExp2("#cbd5e1", 0.0021);

    const aspect = canvas.clientWidth / canvas.clientHeight || 16 / 9;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, CAMERA_FAR);
    this.camera.position.set(0, 4, -8);

    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      const w = window as unknown as { __vbScene?: THREE.Scene; __vbCamera?: THREE.Camera; __vbRenderer?: GameRenderer };
      w.__vbScene = this.scene;
      w.__vbCamera = this.camera;
      w.__vbRenderer = this;
    }

    // 3. Lighting
    this.ambientLight = new THREE.AmbientLight("#dbeafe", 0.70);
    this.scene.add(this.ambientLight);

    const hemiLight = new THREE.HemisphereLight("#e0f2fe", "#475569", 0.65);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight("#fffbeb", 1.85);
    this.dirLight.position.set(60, 120, 80);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 350;
    this.dirLight.shadow.camera.left = -60;
    this.dirLight.shadow.camera.right = 60;
    this.dirLight.shadow.camera.top = 60;
    this.dirLight.shadow.camera.bottom = -60;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // 4. Initialize Scene Graphs & Subsystems
    this.trackGroup = new THREE.Group();
    this.scene.add(this.trackGroup);

    this.cameraController = new ChaseCameraController();
    this.effectsManager = new EffectsManager(this.scene);

    if (this.activeSpline) {
      this.rebuildTrack(this.activeSpline);
    }

    // 5. Build Vehicle 3D Model
    this.carGroup = new THREE.Group();
    this.scene.add(this.carGroup);
    this.rebuildCarMesh();

    // 6. Handle Resize
    window.addEventListener("resize", this.handleResize);
  }

  public rebuildTrack(spline: TrackSpline): void {
    this.activeSpline = spline;
    this.cameraController.reset();

    // Clear existing track meshes
    while (this.trackGroup.children.length > 0) {
      const child = this.trackGroup.children[0];
      this.trackGroup.remove(child);
    }

    // 1. Build RoadMesh (Ribbon + Verges + Guardrails + Props)
    this.roadMesh = new RoadMesh(spline);
    this.trackGroup.add(this.roadMesh.mesh);
    this.trackGroup.add(this.roadMesh.guardrailGroup);
    this.trackGroup.add(this.roadMesh.landmarkGroup);

    // 2. Build Corridor Terrain & Altitude-Banded Vegetation + River + Distant Mountains
    this.terrain = new Terrain(spline);
    this.trackGroup.add(this.terrain.mesh);
    if (this.terrain.riverMesh) this.trackGroup.add(this.terrain.riverMesh);
    if (this.terrain.backdropMesh) this.trackGroup.add(this.terrain.backdropMesh);
    this.trackGroup.add(this.terrain.vegetationGroup);
  }

  private handleResize = (): void => {
    if (!this.canvas) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  public setQualityTier(tier: QualityTier): void {
    const dpr = tier === "high" ? Math.min(window.devicePixelRatio || 1, 2) : tier === "medium" ? 1.25 : 1.0;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = tier !== "low";
  }

  public setCar(car: CarDef, colorIndex: number = 0): void {
    this.activeCar = car;
    this.activeColorIndex = colorIndex;
    this.rebuildCarMesh();
  }

  private rebuildCarMesh(): void {
    while (this.carGroup.children.length > 0) {
      const child = this.carGroup.children[0];
      this.carGroup.remove(child);
    }

    this.carMeshResult = CarMeshBuilder.buildCarModel(this.activeCar, this.activeColorIndex);
    this.carGroup.add(this.carMeshResult.carGroup);
  }

  public start(engine: Engine, onStateUpdate?: (s: EngineRenderState) => void): void {
    this.stop();
    this.lastTime = performance.now();

    const renderLoop = (time: number) => {
      const deltaSeconds = Math.min((time - this.lastTime) / 1000, 0.1);
      this.lastTime = time;

      // 1. Run physics & retrieve interpolated render state
      const s = engine.update(deltaSeconds);
      if (onStateUpdate) {
        onStateUpdate(s);
      }

      // 2. Update Car Position & Orientation with dynamic suspension dive and body roll
      const speedRatio = Math.min(1.0, s.speedMs / 55.0);
      const pitchDive = s.brake > 0.1 ? 0.035 * s.brake : s.throttle > 0.1 ? -0.022 * s.throttle : 0;
      const cornerRoll = -s.steer * speedRatio * 0.042;

      this.carGroup.position.set(s.pos.x, s.pos.y, s.pos.z);
      this.carGroup.rotation.set(s.pitch + pitchDive, s.heading, s.roll + cornerRoll, "YXZ");

      // 3. Update Front Wheel Steering & Camber
      if (this.carMeshResult) {
        const steerAngle = s.steer * (this.activeCar.maxSteerAngle || 0.55);
        const camberAngle = -s.steer * 0.04;
        if (this.carMeshResult.wheelGroups[0]) {
          this.carMeshResult.wheelGroups[0].rotation.y = steerAngle;
          this.carMeshResult.wheelGroups[0].rotation.z = camberAngle;
        }
        if (this.carMeshResult.wheelGroups[1]) {
          this.carMeshResult.wheelGroups[1].rotation.y = steerAngle;
          this.carMeshResult.wheelGroups[1].rotation.z = camberAngle;
        }

        // 4. Update Wheel Spin
        this.wheelAngle += (s.speedMs / 0.33) * deltaSeconds;
        for (let i = 0; i < this.carMeshResult.wheelGroups.length; i++) {
          const spinGroup = this.carMeshResult.wheelGroups[i]?.children[0];
          if (spinGroup) {
            spinGroup.rotation.x = this.wheelAngle;
          }
        }

        // 5. Dynamic Brake Lights
        const isBraking = s.brake > 0.1 || s.handbrake;
        for (const light of this.carMeshResult.brakeLightMeshes) {
          const mat = light.material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.color.set(isBraking ? "#ff0000" : "#7f1d1d");
            mat.emissive.set(isBraking ? "#ff1a1a" : "#450a0a");
            mat.emissiveIntensity = isBraking ? 3.0 : 0.6;
          }
        }

        // 5b. Active Reversing Lights (White LEDs)
        const isReversing = (s.brake > 0.5 && s.speedMs < 0.2) || s.gear === 0;
        for (const rev of this.carMeshResult.reverseLightMeshes) {
          const mat = rev.material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.emissiveIntensity = isReversing ? 2.5 : 0.0;
          }
        }

        // 5c. Brake Disc Glow
        const isHeavyBrake = s.brake > 0.35 || s.handbrake;
        for (const disc of this.carMeshResult.brakeDiscs) {
          (disc.material as THREE.MeshBasicMaterial).color.set(isHeavyBrake ? "#ea580c" : "#475569");
        }

        // 5d. Exhaust Backfire Pop
        if (this.carMeshResult.exhaustFlame) {
          const isBackfire = s.throttle < 0.1 && s.rpm > 5000 && Math.random() < 0.35;
          (this.carMeshResult.exhaustFlame.material as THREE.MeshBasicMaterial).opacity = isBackfire ? 0.9 : 0.0;
        }

        // 6. Perk Aura Glow
        if (this.carMeshResult.perkGlowMesh && this.carMeshResult.perkGlowMesh.material) {
          const glowMat = this.carMeshResult.perkGlowMesh.material as THREE.MeshBasicMaterial;
          const targetGlow = s.perkActive ? 0.7 : 0.0;
          glowMat.opacity += (targetGlow - glowMat.opacity) * Math.min(1, deltaSeconds * 9);
        }
      }

      // 7. Update Smoke & Skid Marks
      this.effectsManager.update(s, deltaSeconds);

      // 8. Update Chase Camera & Sun Light Tracking
      this.cameraController.update(this.camera, this.scene, this.dirLight, s, deltaSeconds);

      // 9. Render Scene
      this.renderer.render(this.scene, this.camera);

      // 10. Dynamic Quality Auto-Scaler
      const currentFps = 1.0 / (deltaSeconds || 0.016);
      if (currentFps < 54 && this.currentDprScale > 0.6) {
        this.lowFpsTimer += deltaSeconds;
        if (this.lowFpsTimer > 2.5) {
          this.currentDprScale = Math.max(0.6, this.currentDprScale - 0.15);
          const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
          this.renderer.setPixelRatio(baseDpr * this.currentDprScale);
          this.lowFpsTimer = 0;
        }
      } else if (currentFps > 58 && this.currentDprScale < 1.0) {
        this.lowFpsTimer = Math.max(0, this.lowFpsTimer - deltaSeconds);
      }

      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    this.animationFrameId = requestAnimationFrame(renderLoop);
  }

  public stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.handleResize);
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
