/**
 * VAL BORBERA HILLCLIMB — Raw Three.js High-Performance Renderer
 * Orchestrates 3D mountain stages, corridor terrain, instanced vegetation, road ribbon, and vehicles.
 */

import * as THREE from "three";
import { Engine, EngineRenderState } from "../Engine";
import { CarDef } from "../vehicle/cars";
import { TrackSpline } from "../track/TrackSpline";
import { RoadMesh } from "../track/RoadMesh";
import { TerrainSystem } from "../track/terrain/TerrainSystem";
import { createHeightField } from "../track/terrain/heightField";
import { QualityTier } from "@/store/gameStore";
import { CarMeshBuilder, CarMeshResult } from "./CarMeshBuilder";
import { ChaseCameraController } from "./ChaseCameraController";
import { EffectsManager } from "./EffectsManager";

// The terrain height field extends FIELD_PADDING (2500 m, see heightField.ts) beyond the
// route's bounding box, generating ridge relief all the way out there. A 900 m far plane
// clipped every one of those distant ridges before they ever reached the camera frustum —
// this was the "mountains not being there" symptom reported by the user, not a terrain
// generation bug. 6000 m comfortably covers the padded field with headroom to spare.
const CAMERA_FAR = 6000;

// Hoisted so the render loop never parses a colour string. `Color.set("#rrggbb")` runs a
// full hex parse on every call, and these were previously assigned once per light per frame.
const BRAKE_LIGHT_ON = new THREE.Color("#ff0000");
const BRAKE_LIGHT_OFF = new THREE.Color("#7f1d1d");
const BRAKE_EMISSIVE_ON = new THREE.Color("#ff1a1a");
const BRAKE_EMISSIVE_OFF = new THREE.Color("#450a0a");
const DISC_HOT = new THREE.Color("#ea580c");
const DISC_COLD = new THREE.Color("#475569");

/**
 * Disposes every material under `root`, along with the textures those materials own.
 *
 * Only for subtrees whose materials are NOT shared — `batchStatics.ts` hands out materials
 * from a module-level cache keyed by content signature, and disposing one of those would
 * break every later stage that reuses the same signature. Deduplicates because chunked
 * meshes share one material instance across all their chunks.
 */
function disposeOwnedMaterials(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material)) continue;
      seen.add(material);
      const standard = material as THREE.MeshStandardMaterial;
      standard.map?.dispose();
      standard.bumpMap?.dispose();
      standard.normalMap?.dispose();
      standard.roughnessMap?.dispose();
      material.dispose();
    }
  });
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;

  // Track & Terrain Scene Graph
  private roadMesh: RoadMesh | null = null;
  private terrain: TerrainSystem | null = null;
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
  private highFpsTimer = 0;
  private currentDprScale = 1.0;

  // Latched light states, so the render loop only writes materials on an actual change.
  private lastBrakingState: boolean | null = null;
  private lastReversingState: boolean | null = null;
  private lastHeavyBrakeState: boolean | null = null;

  // Checkpoint respawn tracking, see the render loop's cameraController.reset() call.
  private lastSeenRespawnCount = 0;

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
    //
    // Background and fog share one colour ("#7891a8", a deeper, warmer haze blue than the
    // old very-light slate) so the horizon closes seamlessly instead of showing a hard edge
    // where the terrain mesh ends and the flat background colour begins.
    //
    // FogExp2 attenuates as F(d) = exp(-(d * density)^2), where F is the fraction of the
    // fog colour mixed in (1 = fully fogged, 0 = clear). At CAMERA_FAR = 6000 the old
    // density of 0.0021 (tuned for a 900 m world) gives F(900) = exp(-(900*0.0021)^2) =
    // exp(-3.57) ≈ 0.028 — already almost opaque white by the old far plane, and completely
    // opaque long before 6000 m, so the distant ridges would be fogged out solid rather than
    // fading in as haze. We want the far ridges (4000-5000 m out) to sit at roughly
    // F ≈ 0.05-0.10: visible through haze, not popping out of clear air and not vanishing
    // into a wall of fog. Solving exp(-(d*density)^2) = 0.075 at the midpoint d = 4500:
    //   (4500 * density)^2 = -ln(0.075) = 2.590
    //   4500 * density = sqrt(2.590) = 1.609
    //   density = 1.609 / 4500 ≈ 0.000358
    // Rounding to density = 0.00035 and checking the endpoints of the 4000-5000 m band:
    //   F(4000) = exp(-(4000*0.00035)^2) = exp(-1.96)  ≈ 0.141
    //   F(4500) = exp(-(4500*0.00035)^2) = exp(-2.481) ≈ 0.084
    //   F(5000) = exp(-(5000*0.00035)^2) = exp(-3.0625) ≈ 0.047
    // which brackets the 0.05-0.10 target around the 4000-5000 m band the far ridges live in.
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#7891a8");
    this.scene.fog = new THREE.FogExp2("#7891a8", 0.00035);

    const aspect = canvas.clientWidth / canvas.clientHeight || 16 / 9;
    // Near plane raised from 0.1 to 0.5: against a 6000 m far plane, 0.1 wastes almost all
    // of the depth buffer's precision on a range the chase camera never uses — it never gets
    // closer than roughly half a metre to the car body it is chasing.
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.5, CAMERA_FAR);
    this.camera.position.set(0, 4, -8);

    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      const w = window as unknown as {
        __vbScene?: THREE.Scene;
        __vbCamera?: THREE.Camera;
        __vbRenderer?: GameRenderer;
        __vbSpline?: TrackSpline;
      };
      w.__vbScene = this.scene;
      w.__vbCamera = this.camera;
      w.__vbRenderer = this;
      w.__vbSpline = this.activeSpline;
    }

    // 3. Lighting
    // Fill light was doing too much: ambient 0.70 plus hemisphere 0.65 is ~1.35 of
    // direction-less light against a 1.85 sun, so slopes facing away from the sun were
    // almost as bright as slopes facing it. Terrain read as flat paper regardless of how
    // much relief the height field actually produced. Cutting the fill roughly in half and
    // lifting the sun restores the light-and-shade that gives landforms their shape, while
    // the hemisphere's ground tint still keeps shadowed faces from going black.
    this.ambientLight = new THREE.AmbientLight("#dbeafe", 0.34);
    this.scene.add(this.ambientLight);

    const hemiLight = new THREE.HemisphereLight("#e0f2fe", "#4a5568", 0.42);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight("#fffbeb", 2.35);
    this.dirLight.position.set(60, 120, 80);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    // Depth bias. Without it the terrain self-shadows: a 1024 map stretched over a 120 m
    // shadow camera gives texels several centimetres across, so sloped ground samples its own
    // depth and renders thin dark streaks following the contours — which read as cracks or
    // see-through seams in the hillside rather than as a lighting artifact. Raising the sun
    // intensity made them more obvious. normalBias offsets along the surface normal, which is
    // what large sloped meshes need; the small negative constant bias handles the rest.
    this.dirLight.shadow.bias = -0.0006;
    this.dirLight.shadow.normalBias = 0.8;
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

    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      const w = window as unknown as { __vbSpline?: TrackSpline };
      w.__vbSpline = spline;
    }

    // Clear existing track meshes
    while (this.trackGroup.children.length > 0) {
      const child = this.trackGroup.children[0];
      this.trackGroup.remove(child);
    }

    // 1. Build RoadMesh (Ribbon + Verges + Guardrails + Props)
    //
    // Dispose the OUTGOING road meshes' geometries, but deliberately leave their materials
    // alone. `mesh`, `guardrailGroup`, and `landmarkGroup` are removed from `trackGroup`
    // above, but that only unlinks them from the scene graph — their GPU buffers stay
    // allocated until disposed. `guardrailGroup` and `landmarkGroup` in particular are built
    // by `batchStaticGroup` (batchStatics.ts), which hands out materials from a
    // module-level `canonicalMaterials` cache keyed by content signature so that, e.g.,
    // every stage's guardrail posts share one material instance instead of one each.
    // Disposing a material here would dispose that SHARED instance and break rendering for
    // every later stage that reuses the same signature, not just this one. Geometries carry
    // no such sharing (each RoadMesh build produces its own fresh geometry, merged or not),
    // so disposing only geometries is safe and plugs the leak without touching the cache.
    // The road ribbon itself is the exception to that rule: `RoadMesh.mesh` is built by
    // `chunkMeshBySpace(buildRoadGeometry())`, which never routes through `batchStaticGroup`,
    // so its MeshStandardMaterial and the 1024x1024 CanvasTexture it wraps are freshly
    // constructed per RoadMesh and owned by nobody else. Those must be disposed too, or every
    // stage change leaks a full asphalt texture.
    if (this.roadMesh) {
      this.disposeRoadMesh(this.roadMesh);
    }
    // Build the height field FIRST: roadside buildings stand well back from the carriageway
    // and must sit on the terrain, not at road height. The field is handed to both consumers
    // so it is only constructed once.
    const field = createHeightField(spline);

    this.roadMesh = new RoadMesh(spline, (x, z) => field.heightAt(x, z));
    this.trackGroup.add(this.roadMesh.mesh);
    this.trackGroup.add(this.roadMesh.guardrailGroup);
    this.trackGroup.add(this.roadMesh.landmarkGroup);

    // 2. Build the unified terrain surface, river and vegetation. There is no separate
    // backdrop mesh: near ground and distant mountains are one continuous surface.
    this.terrain?.dispose();
    // The road mesh is built first (above), so its hamlet footprints are available here and
    // the vegetation scatter can avoid growing trees through the houses.
    this.terrain = new TerrainSystem(spline, field, this.roadMesh.buildingFootprints);
    this.trackGroup.add(this.terrain.mesh);
    this.trackGroup.add(this.terrain.riverMesh);
    this.trackGroup.add(this.terrain.vegetationGroup);
    this.trackGroup.add(this.terrain.embankmentMesh);
  }

  /**
   * Disposes an outgoing RoadMesh's GPU resources along the same safe path `rebuildTrack`
   * has always used: geometries everywhere (never shared), but materials ONLY on
   * `roadMesh.mesh` (the road ribbon, freshly built and owned by nobody else). Deliberately
   * skips materials on `guardrailGroup` and `landmarkGroup` — see the comment on
   * `disposeOwnedMaterials` and in `rebuildTrack` above: those come from `batchStatics.ts`'s
   * shared `canonicalMaterials` cache, and disposing one would break every later stage that
   * reuses the same signature.
   */
  private disposeRoadMesh(roadMesh: RoadMesh): void {
    for (const root of [roadMesh.mesh, roadMesh.guardrailGroup, roadMesh.landmarkGroup]) {
      root.traverse((node) => {
        const m = node as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
    }
    disposeOwnedMaterials(roadMesh.mesh);
  }

  /**
   * Disposes an outgoing car mesh's geometries and (unshared, freshly-built) materials.
   * Extracted from `rebuildCarMesh` so `destroy()` can reuse the exact same path.
   */
  private disposeCarMesh(result: CarMeshResult): void {
    result.carGroup.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
    disposeOwnedMaterials(result.carGroup);
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
    // Dispose the outgoing car before replacing it. `CarMeshBuilder.buildCarModel` constructs
    // roughly a dozen geometries and fifteen materials per call — body, glass, trim, chrome,
    // lights, tyres, rims, hubs, calipers, discs — none of them cached or shared. Removing
    // the group from the scene only unlinks it; without this every car or colourway change
    // in the garage leaked the whole previous model's GPU memory.
    if (this.carMeshResult) {
      this.disposeCarMesh(this.carMeshResult);
    }

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
        //
        // Only touched when the state actually changes. This used to run every frame, and
        // `Color.set("#ff0000")` PARSES THE STRING each time — a hex parse per light per
        // frame, plus a uniform rewrite, to assign a value that is identical to the one
        // already there for all but a couple of frames per braking event. The colours are
        // hoisted to module constants so nothing is parsed at runtime at all.
        const isBraking = s.brake > 0.1 || s.handbrake;
        if (isBraking !== this.lastBrakingState) {
          this.lastBrakingState = isBraking;
          for (const light of this.carMeshResult.brakeLightMeshes) {
            const mat = light.material as THREE.MeshStandardMaterial;
            if (mat) {
              mat.color.copy(isBraking ? BRAKE_LIGHT_ON : BRAKE_LIGHT_OFF);
              mat.emissive.copy(isBraking ? BRAKE_EMISSIVE_ON : BRAKE_EMISSIVE_OFF);
              mat.emissiveIntensity = isBraking ? 3.0 : 0.6;
            }
          }
        }

        // 5b. Active Reversing Lights (White LEDs)
        const isReversing = (s.brake > 0.5 && s.speedMs < 0.2) || s.gear === 0;
        if (isReversing !== this.lastReversingState) {
          this.lastReversingState = isReversing;
          for (const rev of this.carMeshResult.reverseLightMeshes) {
            const mat = rev.material as THREE.MeshStandardMaterial;
            if (mat) {
              mat.emissiveIntensity = isReversing ? 2.5 : 0.0;
            }
          }
        }

        // 5c. Brake Disc Glow
        const isHeavyBrake = s.brake > 0.35 || s.handbrake;
        if (isHeavyBrake !== this.lastHeavyBrakeState) {
          this.lastHeavyBrakeState = isHeavyBrake;
          for (const disc of this.carMeshResult.brakeDiscs) {
            (disc.material as THREE.MeshBasicMaterial).color.copy(isHeavyBrake ? DISC_HOT : DISC_COLD);
          }
        }

        // 5d. Exhaust Backfire Pop
        if (this.carMeshResult.exhaustFlame) {
          const isBackfire = s.throttle < 0.1 && s.rpm > 5000 && Math.random() < 0.35;
          const flameMat = this.carMeshResult.exhaustFlame.material as THREE.MeshBasicMaterial;
          if (flameMat.opacity !== (isBackfire ? 0.9 : 0.0)) {
            flameMat.opacity = isBackfire ? 0.9 : 0.0;
          }
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

      // 7b. Snap the chase camera on checkpoint respawn instead of lerping across the map.
      // `s.respawnCount` only ever increases, and only from Engine's off-road-penalty
      // teleport, so any change here (even a jump of 2+, if two respawns landed inside
      // the physics substeps of a single render frame) means at least one teleport
      // happened this frame and none is missed; an unchanged count never fires spuriously.
      if (s.respawnCount !== this.lastSeenRespawnCount) {
        this.lastSeenRespawnCount = s.respawnCount;
        this.cameraController.reset();
      }

      // 8. Update Chase Camera & Sun Light Tracking
      this.cameraController.update(this.camera, this.scene, this.dirLight, s, deltaSeconds);

      // 9. Render Scene
      this.renderer.render(this.scene, this.camera);

      // 10. Dynamic Quality Auto-Scaler
      //
      // Scaling down and scaling back up are NOT symmetric. A sustained low-FPS period
      // (2.5s under 54 fps) drops resolution in 0.15 steps, same as before. But recovery
      // used to only decay `lowFpsTimer` and never actually raise the scale back up or
      // call `setPixelRatio` again — one transient stall (first-frame shader compile, a
      // GC pause) permanently degraded resolution for the rest of the session.
      //
      // The fix mirrors the down-scale logic with its own timer (`highFpsTimer`, kept
      // separate from `lowFpsTimer` so the two can't fight over the same accumulator from
      // frame to frame) but requires a much longer sustained good-FPS window — 10s vs
      // 2.5s — before stepping back up. Raising resolution is what caused the stall in the
      // first place: more pixels means more GPU work, so re-raising it the moment FPS
      // recovers risks immediately re-triggering the downscale and oscillating between
      // the two. Being reluctant to scale up avoids that thrash.
      const currentFps = 1.0 / (deltaSeconds || 0.016);
      const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (currentFps < 54 && this.currentDprScale > 0.6) {
        this.lowFpsTimer += deltaSeconds;
        this.highFpsTimer = 0;
        if (this.lowFpsTimer > 2.5) {
          this.currentDprScale = Math.max(0.6, this.currentDprScale - 0.15);
          this.renderer.setPixelRatio(baseDpr * this.currentDprScale);
          this.lowFpsTimer = 0;
        }
      } else if (currentFps > 58) {
        this.lowFpsTimer = Math.max(0, this.lowFpsTimer - deltaSeconds);
        if (this.currentDprScale < 1.0) {
          this.highFpsTimer += deltaSeconds;
          if (this.highFpsTimer > 10.0) {
            this.currentDprScale = Math.min(1.0, this.currentDprScale + 0.15);
            this.renderer.setPixelRatio(baseDpr * this.currentDprScale);
            this.highFpsTimer = 0;
          }
        } else {
          this.highFpsTimer = 0;
        }
      }

      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    this.animationFrameId = requestAnimationFrame(renderLoop);
  }

  /** Render a single frame without advancing physics. Used by visual diagnostics. */
  public renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
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

    // `WebGLRenderer.dispose()` below only frees the renderer's own GPU-side program and
    // state caches — it does NOT touch geometries, materials, or textures, which are owned
    // by the scene objects that reference them. Without disposing those explicitly, every
    // full unmount/remount of the game view leaks the whole scene: road ribbon, terrain,
    // vegetation, car model, and the effects buffers.
    if (this.carMeshResult) {
      this.disposeCarMesh(this.carMeshResult);
      this.carMeshResult = null;
    }
    this.effectsManager.dispose();
    this.terrain?.dispose();
    if (this.roadMesh) {
      this.disposeRoadMesh(this.roadMesh);
      this.roadMesh = null;
    }

    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
