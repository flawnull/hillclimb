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
import { createHeightField, type HeightField } from "../track/terrain/heightField";
import type { BuildingFootprint } from "../track/HamletBuilder";
import { QualityTier } from "@/store/gameStore";
import { pixelRatioFor, shouldAntialias } from "./pixelBudget";
import { CarMeshBuilder, CarMeshResult } from "./CarMeshBuilder";
import { ChaseCameraController } from "./ChaseCameraController";
import { EffectsManager } from "./EffectsManager";

// The terrain height field extends FIELD_PADDING (2500 m, see heightField.ts) beyond the
// route's bounding box, generating ridge relief all the way out there. A 900 m far plane
// clipped every one of those distant ridges before they ever reached the camera frustum —
// this was the "mountains not being there" symptom reported by the user, not a terrain
// generation bug. 6000 m comfortably covers the padded field with headroom to spare.
const CAMERA_FAR = 6000;

/**
 * Frames the quality auto-scaler averages over, and how long it stays deaf after acting.
 *
 * 45 frames is about three quarters of a second at 60 Hz — long enough that the handful of
 * first-draw buffer uploads in any given stretch of road cannot drag the median, short
 * enough that a device which genuinely cannot hold the frame rate is recognised promptly.
 * The cooldown covers the reallocation `setPixelRatio` performs plus the frames either side
 * of it, so the change is never counted as evidence for the next one.
 */
const FPS_WINDOW = 45;
const DPR_CHANGE_COOLDOWN_S = 1.0;

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
  private qualityTier: QualityTier = "high";
  /**
   * Ring buffer of recent frame times, milliseconds. The auto-scaler judges on the MEDIAN of
   * this rather than on the newest frame, so an individual hitch — a chunk's first buffer
   * upload, a GC pause — cannot be mistaken for a slow device. See the auto-scaler block in
   * the render loop.
   */
  private frameMsWindow = new Float32Array(FPS_WINDOW);
  private frameMsWrite = 0;
  private frameMsFilled = 0;
  /** Seconds left before auto-scaler samples count again; see `applyPixelRatio`. */
  private dprCooldown = 0;

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

    // 1. Initialize WebGL Renderer.
    //
    // The pixel ratio is budgeted by AREA, not taken from the display — see pixelBudget.ts.
    // `min(devicePixelRatio, 2)` is the conventional choice and it is why this ran worse on a
    // desktop than on a phone: the same ratio over a 2560x1440 window is 14.7 M device pixels
    // against a phone's 1.3 M, and every one of them is shaded by the same terrain, fog and
    // shadow work.
    const initialRatio = pixelRatioFor(
      canvas.clientWidth,
      canvas.clientHeight,
      window.devicePixelRatio || 1,
      "high"
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Multisampling is decided once, at context creation, so it is decided against the
      // ratio this canvas starts at. A buffer already supersampled 1.5x or more is paying
      // twice for the same edges.
      antialias: shouldAntialias(initialRatio),
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setPixelRatio(initialRatio);
    this.renderer.shadowMap.enabled = true;
    // PCFSoft filters the shadow map per fragment and is the most expensive of the three.
    // At a supersampled ratio the extra softness is being resolved away anyway, so the plain
    // PCF filter buys back fragment work that the resolution is already spending.
    this.renderer.shadowMap.type = shouldAntialias(initialRatio)
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
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

    // The track is NOT built here. Terrain generation blocks for two and a half to three
    // and a half seconds, and doing it in the constructor means the browser cannot paint
    // the loading screen for that whole time — the screen appears, freezes solid, and
    // vanishes. The caller builds it with `rebuildTrackAsync` and gets progress instead.

    // 5. Build Vehicle 3D Model
    this.carGroup = new THREE.Group();
    this.scene.add(this.carGroup);
    this.rebuildCarMesh();

    // 6. Handle Resize
    window.addEventListener("resize", this.handleResize);
  }

  /**
   * Interruptible track build. Same result as `rebuildTrack`, but the terrain surface is
   * generated a slice at a time with `yieldTo` awaited in between, so the page keeps
   * painting. `onProgress` reports 0..1 across the terrain, which is effectively the whole
   * of the load.
   */
  public async rebuildTrackAsync(
    spline: TrackSpline,
    yieldTo: () => Promise<void>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    // The road, its props and the hamlets are ~50 ms on Borbera Sprint and ~95 ms on Salita
    // di Cosola, and they run BEFORE the terrain — so without a yield around them the very
    // first thing the loading screen does is freeze, with the bar still at zero. Measured on
    // the live site in Chromium, every frame over 60 ms fell in that window. It is one
    // uninterruptible call and cannot be sliced from here, but it can be given a painted
    // frame either side of it, and the bar can say something other than nothing.
    onProgress?.(0.01);
    await yieldTo();
    const prepared = this.prepareTrack(spline);
    onProgress?.(0.04);
    await yieldTo();

    this.terrain = await TerrainSystem.createAsync(
      spline,
      prepared.field,
      prepared.buildings,
      yieldTo,
      // The terrain is the remaining 95% — it is 30 times the work of everything above.
      onProgress ? (f) => onProgress(0.04 + f * 0.94) : undefined
    );
    this.attachTerrain();

    // COMPILE THE SHADERS NOW, not on first sight.
    //
    // WebGL compiles a program the first time a material is drawn with a given light setup,
    // and that compile blocks. Everything in this scene is therefore paid for at the moment
    // it first enters the frustum — which is the first few seconds of driving, one stall per
    // material as the car reaches it. That is the stutter at the start of a run: not loading,
    // but the last of the loading arriving late.
    //
    // `compileAsync` walks the whole scene and does it up front, where there is already a
    // loading screen to do it behind. It yields internally, so the bar keeps moving.
    const renderer = this.renderer as THREE.WebGLRenderer & {
      compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>;
    };
    onProgress?.(0.98);
    if (typeof renderer.compileAsync === "function") {
      await renderer.compileAsync(this.scene, this.camera);
    } else {
      await yieldTo();
      this.renderer.compile(this.scene, this.camera);
    }
    onProgress?.(1);
  }

  /** True once a track has been built into the scene. */
  public hasTrack(): boolean {
    return this.terrain !== null;
  }

  public rebuildTrack(spline: TrackSpline): void {
    const prepared = this.prepareTrack(spline);
    this.terrain = new TerrainSystem(spline, prepared.field, prepared.buildings);
    this.attachTerrain();
  }

  /** Everything up to the terrain: the shared height field, the road, and its props. */
  private prepareTrack(spline: TrackSpline): { field: HeightField; buildings: BuildingFootprint[] } {
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

    // The road mesh is built first (above), so its hamlet footprints are available to the
    // terrain and the vegetation scatter can avoid growing trees through the houses.
    this.terrain?.dispose();
    return { field, buildings: this.roadMesh.buildingFootprints };
  }

  /**
   * 2. Attach the unified terrain surface, river and vegetation. There is no separate
   * backdrop mesh: near ground and distant mountains are one continuous surface.
   */
  private attachTerrain(): void {
    if (!this.terrain) return;
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
    // The budget is an area, so resizing the window changes the ratio it allows.
    this.renderer.setPixelRatio(this.targetPixelRatio() * this.currentDprScale);
  };

  public setQualityTier(tier: QualityTier): void {
    this.qualityTier = tier;
    this.renderer.setPixelRatio(this.targetPixelRatio() * this.currentDprScale);
    this.renderer.shadowMap.enabled = tier !== "low";
  }

  /**
   * Changes the pixel ratio and blinds the auto-scaler for a moment afterwards.
   *
   * `setPixelRatio` reallocates the drawing buffer, which costs a stalled frame or two. Left
   * to itself the controller measures that stall, concludes the device is struggling and
   * steps down again — the remedy proving its own necessity, which is what ratcheted the
   * scale to its 0.6 floor within a few seconds of every run. Discarding the window and
   * sitting out DPR_CHANGE_COOLDOWN_S breaks that loop: the next decision is made only on
   * frames drawn at the new resolution.
   */
  private applyPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    this.frameMsFilled = 0;
    this.frameMsWrite = 0;
    this.dprCooldown = DPR_CHANGE_COOLDOWN_S;
  }

  /** Median of the frame-time window. 0 until the window has filled at least once. */
  private medianFrameMs(): number {
    if (this.frameMsFilled === 0) return 0;
    const sorted = Array.from(this.frameMsWindow.subarray(0, this.frameMsFilled)).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /** The unscaled ratio for the current tier and canvas size. */
  private targetPixelRatio(): number {
    return pixelRatioFor(
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      window.devicePixelRatio || 1,
      this.qualityTier
    );
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
    // SEEDED FROM THE FIRST rAF TIMESTAMP, NOT performance.now().
    //
    // These are the same epoch but not the same instant: rAF hands the callback the time the
    // FRAME BEGAN, while performance.now() reads the clock right now, part-way through the
    // frame's script. Seeding from the latter and subtracting it from the former makes the
    // first delta `frameStart - somewhereInsideThatFrame`, which is negative whenever the
    // calling script ran longer than a vsync — and `start()` is called straight out of the
    // terrain build, so it always does. Measured on the dev server: the first delta handed
    // to Engine.update was -0.0499 s.
    //
    // That is not cosmetic. Engine.update adds the delta to its fixed-step accumulator, so a
    // negative one drives the accumulator below zero: no physics step runs until real time
    // pays the deficit back (~50 ms of frozen car), and `alpha`, the accumulator divided by
    // the step, goes to about -3. getInterpolatedState extrapolates on that alpha, so the car
    // is DRAWN roughly three steps behind where it actually is — at speed, over a metre
    // backwards — and then snaps forward once stepping resumes. A freeze plus a lurch
    // backwards plus a recovery, which is exactly what "it goes back as if something loaded,
    // then normal drive" looks like.
    //
    // -1 means unseeded; the first frame then measures zero elapsed instead of a negative.
    this.lastTime = -1;

    // The frames right after the track is built are all first-draw buffer uploads, which say
    // nothing about what the device can sustain. Start the auto-scaler's window empty and
    // hold it off for a beat so those do not decide the resolution for the whole session.
    this.frameMsFilled = 0;
    this.frameMsWrite = 0;
    this.dprCooldown = DPR_CHANGE_COOLDOWN_S;

    const renderLoop = (time: number) => {
      if (this.lastTime < 0) this.lastTime = time;
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
      // MEASURED OVER A WINDOW, AND DEAF FOR A MOMENT AFTER IT ACTS.
      //
      // The controller used to judge on ONE frame: `1 / deltaSeconds`. Two things follow
      // from that, and both were visible in the first seconds of a run.
      //
      // First, the opening seconds are exactly when frame times are transiently bad for
      // reasons that have nothing to do with the device's capability: three.js uploads each
      // chunk's buffers the first time it is actually drawn, so every new stretch of terrain
      // and vegetation entering the frustum costs an upload. Single-frame sampling counts
      // each of those hitches as evidence of a slow GPU.
      //
      // Second, and worse, `setPixelRatio` REALLOCATES THE DRAWING BUFFER — the change is
      // itself a stalled frame. That stall was measured on the very next frame and fed
      // straight back into the timer that triggers the next downscale, so the remedy kept
      // proving its own necessity. Instrumented on the dev server, the scale ratcheted
      // 1.0 -> 0.85 -> 0.70 -> 0.60 in three steps and parked on the floor, each step a
      // buffer reallocation the player feels as a stutter — a burst of them a few seconds
      // into the run, then quiet once the floor is reached and there is nothing left to
      // step down to.
      //
      // So: judge on the MEDIAN of a window of recent frames, which a handful of upload
      // hitches cannot move but a genuinely slow device sits squarely on top of; ignore
      // samples for a beat after any change, so the reallocation is never its own evidence;
      // and ignore the first stretch after the loop starts, which is all upload cost. None
      // of this stops a weak device downscaling — it only requires that the slowness outlast
      // the transients.
      this.frameMsWindow[this.frameMsWrite] = deltaSeconds * 1000;
      this.frameMsWrite = (this.frameMsWrite + 1) % FPS_WINDOW;
      if (this.frameMsFilled < FPS_WINDOW) this.frameMsFilled++;
      if (this.dprCooldown > 0) this.dprCooldown -= deltaSeconds;

      const baseDpr = this.targetPixelRatio();
      // Median frame time over the window, or Infinity fps while still filling it / cooling
      // down, which lands in neither branch and leaves both timers untouched.
      const medianMs = this.medianFrameMs();
      const currentFps = medianMs > 0 ? 1000 / medianMs : Infinity;
      // Until the window has filled and any cooldown has run out, neither timer moves at
      // all: an unsettled reading is not evidence in either direction.
      const settled = this.frameMsFilled >= FPS_WINDOW && this.dprCooldown <= 0;

      if (settled && currentFps < 54 && this.currentDprScale > 0.6) {
        this.lowFpsTimer += deltaSeconds;
        this.highFpsTimer = 0;
        // 2.5 s was too patient: two and a half seconds of dropped frames is most of a
        // corner, and the player feels all of it before anything is done. Scaling UP stays
        // reluctant at 10 s, because raising resolution is what caused the stall in the
        // first place and oscillating between the two is worse than either.
        if (this.lowFpsTimer > 1.2) {
          this.currentDprScale = Math.max(0.6, this.currentDprScale - 0.15);
          this.applyPixelRatio(baseDpr * this.currentDprScale);
          this.lowFpsTimer = 0;
        }
      } else if (settled && currentFps > 58) {
        this.lowFpsTimer = Math.max(0, this.lowFpsTimer - deltaSeconds);
        if (this.currentDprScale < 1.0) {
          this.highFpsTimer += deltaSeconds;
          if (this.highFpsTimer > 10.0) {
            this.currentDprScale = Math.min(1.0, this.currentDprScale + 0.15);
            this.applyPixelRatio(baseDpr * this.currentDprScale);
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
