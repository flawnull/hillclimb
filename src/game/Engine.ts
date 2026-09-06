/**
 * VAL BORBERA HILLCLIMB — Core Game Engine
 * Coordinates fixed-step physics accumulator, input sampling, track projection,
 * boundary collision resolution, deterministic timing, audio, and render state.
 */

import { VehicleModel, GroundQuery, Vec3 } from "./vehicle/VehicleModel";
import { InputManager, InputAxes } from "./input/InputManager";
import { TrackSpline, SplineSample, FrenetProjection } from "./track/TrackSpline";
import { Timer, RunState, SplitRecord, PenaltyEvent } from "./timing/Timer";
import { ReplayRecorder } from "./timing/ReplayRecorder";
import { EngineAudio } from "./audio/EngineAudio";
import { WALL_CONTACT_MARGIN, PHYSICS_DT } from "./vehicle/vehicleTuning";

/** Run-off allowed beyond either end of the timed stage, in metres, before the car is held.
 *  Enough to back off the grid or coast past the finish line; not enough to drive out of the
 *  built world, whose terrain and scenery stop not far past each end. */
const STAGE_APRON_M = 12;
import { PersonalBest } from "@/store/gameStore";

export interface EngineRenderState {
  pos: Vec3;
  heading: number;
  pitch: number;
  roll: number;
  speedKmh: number;
  speedMs: number;
  rpm: number;
  gear: number;
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  isSliding: boolean;
  slipAngle: number;
  perkActive: boolean;
  altitude: number;
  airborne: boolean;
  driftScore: number;
  currentS: number;
  currentT: number;
  exposure: 'left' | 'right' | 'both' | 'none';
  dropDepth: number;
  runState: RunState;
  elapsedSeconds: number;
  totalPenaltySeconds: number;
  lastSplit?: SplitRecord;
  lastPenalty?: PenaltyEvent;
  currentHairpin: number;
  /**
   * Monotonically increasing count of checkpoint-respawn teleports (off-road penalty).
   * The renderer compares this against the last value it saw and snaps the chase camera
   * with `ChaseCameraController.reset()` on any change, rather than lerping across the
   * map. A counter — not a boolean flag — is used deliberately: a flag can be missed or
   * cleared incorrectly if two respawns land in the same render frame (multiple physics
   * substeps can run per frame), and it must never fire on an ordinary frame where no
   * teleport happened. An always-increasing count read-and-compared each frame satisfies
   * both: any change, by any amount, means "at least one teleport happened," and no
   * change ever means "none did."
   */
  respawnCount: number;
}

export class Engine {
  public vehicle: VehicleModel;
  public input: InputManager;
  public timer: Timer;
  public recorder: ReplayRecorder;
  public audio: EngineAudio;
  public spline?: TrackSpline;

  private accumulator: number = 0;
  private totalSteps: number = 0;
  private isRunning: boolean = true;
  private lastCheckpointPos: Vec3 = { x: 0, y: 560, z: 0 };
  private lastCheckpointHeading: number = 0;
  private lastCheckpointS: number = 0;
  private cachedS: number = 0;
  private lastSplit?: SplitRecord;
  private lastPenalty?: PenaltyEvent;
  private currentHairpin: number = 0;
  private hairpinSValues: number[] = [];
  private respawnCount: number = 0;
  /** The last ground the car was on, so the post-finish coast-down has a surface. */
  private lastGround: GroundQuery = {
    groundY: 0,
    roadPitch: 0,
    roadBank: 0,
    surface: 'asphalt',
    onRoad: true,
    baseAltitude: 560,
  };
  /** Mirrors VehicleModel's own previous position, for the settle check above. */
  private prevPos: { x: number; z: number } = { x: 0, z: 0 };
  private onFinishCallback?: (totalTimeSec: number, splits: SplitRecord[]) => void;

  private renderState: EngineRenderState = {
    pos: { x: 0, y: 560, z: 0 },
    heading: 0,
    pitch: 0,
    roll: 0,
    speedKmh: 0,
    speedMs: 0,
    rpm: 900,
    gear: 1,
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    isSliding: false,
    slipAngle: 0,
    perkActive: false,
    altitude: 560,
    airborne: false,
    driftScore: 0,
    currentS: 0,
    currentT: 0,
    exposure: 'none',
    dropDepth: 0,
    runState: 'ready',
    elapsedSeconds: 0,
    totalPenaltySeconds: 0,
    currentHairpin: 0,
    respawnCount: 0,
  };

  private hasTriggeredFinish: boolean = false;

  constructor(carId?: string, initialPos?: Vec3, initialHeading?: number) {
    this.vehicle = new VehicleModel(carId, initialPos, initialHeading);
    this.input = new InputManager();
    this.timer = new Timer();
    this.recorder = new ReplayRecorder();
    this.audio = new EngineAudio();
    this.audio.setCar(this.vehicle.car.id);
  }

  public setCar(carId: string): void {
    this.vehicle = new VehicleModel(carId, this.vehicle.state.pos, this.vehicle.state.heading);
    this.audio.setCar(carId);
  }

  public setSpline(spline: TrackSpline, pb?: PersonalBest): void {
    this.spline = spline;
    // Collapse each hairpin's flagged samples into ONE entry.
    //
    // The spline samples every 2 m and carries `isHairpinApex` across every sample spanning a
    // flagged control point, so a 38-hairpin stage produced 380 flagged samples. The counter
    // below counts entries passed, so it read up to 380 against a declared total of 38 —
    // hence displays like "50 / 38" after only a handful of corners. Consecutive flagged
    // samples closer together than this gap belong to the same corner.
    const APEX_GROUP_GAP_M = 40;
    const flagged = spline.getAllSamples().filter((s) => s.isHairpinApex).map((s) => s.s);
    this.hairpinSValues = flagged.filter(
      (sVal, i) => i === 0 || sVal - flagged[i - 1] > APEX_GROUP_GAP_M
    );
    this.timer.setCheckpoints(spline.stage.checkpoints, pb);
    this.resetToStart();
  }

  public onFinish(cb: (totalTimeSec: number, splits: SplitRecord[]) => void): void {
    this.onFinishCallback = cb;
  }

  public resetToStart(): void {
    this.hasTriggeredFinish = false;
    this.audio.reset();
    if (this.spline) {
      const firstSample = this.spline.getSampleAtS(0);
      const startPos: Vec3 = { x: firstSample.x, y: firstSample.y, z: firstSample.z };
      this.vehicle.reset(startPos, firstSample.heading, firstSample.altitude);
      this.lastCheckpointPos = { ...startPos };
      this.lastCheckpointHeading = firstSample.heading;
      this.lastCheckpointS = 0;
      this.cachedS = 0;
    } else {
      this.vehicle.reset({ x: 0, y: 0, z: 0 }, 0, 560);
      this.lastCheckpointPos = { x: 0, y: 0, z: 0 };
      this.lastCheckpointHeading = 0;
      this.lastCheckpointS = 0;
      this.cachedS = 0;
    }
    this.accumulator = 0;
    this.totalSteps = 0;
    this.lastSplit = undefined;
    this.lastPenalty = undefined;
    this.currentHairpin = 0;
    this.timer.reset();
    this.recorder.clear();
  }

  public startCountdown(): void {
    this.audio.init();
    this.audio.resume();
    this.resetToStart();
    this.timer.startCountdown();
  }

  public startRun(): void {
    this.resetToStart();
    this.timer.start();
    this.recorder.start();
  }

  /**
   * Called every animation frame.
   * Runs the fixed-step physics loop with accumulator clamp.
   */
  public update(frameDeltaSeconds: number, enableAssist: boolean = true): EngineRenderState {
    if (!this.isRunning) {
      return this.renderState;
    }

    // Clamped at BOTH ends. The upper bound stops a long stall from being simulated in one
    // go; the lower bound of zero is what keeps `alpha` inside [0, 1), where it means
    // interpolation. A negative delta (see the timebase note in GameRenderer.start) drives
    // the accumulator below zero, which both stalls stepping until real time pays the
    // deficit back and sends `alpha` negative, so getInterpolatedState EXTRAPOLATES the car
    // backwards down its own velocity instead of interpolating between two real states.
    // Guarded here as well as at the caller because the accumulator invariant — never
    // negative, so alpha stays in [0, 1) — belongs to this loop, not to whoever drives it.
    const clampedDelta = Math.min(Math.max(frameDeltaSeconds, 0), 0.25);
    this.accumulator += clampedDelta;

    const inputAxes = this.input.getAxes();

    while (this.accumulator >= PHYSICS_DT) {
      this.stepPhysics(PHYSICS_DT, inputAxes, enableAssist);
      this.accumulator -= PHYSICS_DT;
      this.totalSteps++;
    }

    const alpha = this.accumulator / PHYSICS_DT;
    const interpolated = this.vehicle.getInterpolatedState(alpha);
    const s = this.vehicle.state;

    // Track Spline Sampling for visuals
    let pitch = 0;
    let roll = -s.yawRate * 0.04;
    let exposure: 'left' | 'right' | 'both' | 'none' = 'none';
    let dropDepth = 0;

    if (this.spline) {
      const proj = this.spline.projectFrenet(interpolated.pos.x, interpolated.pos.z, this.cachedS);
      pitch = proj.sample.pitch;
      roll += proj.sample.bank;
      exposure = proj.sample.exposure;
      dropDepth = proj.sample.dropDepth;
      interpolated.pos.y = proj.sample.y;
    }

    // Audio Update
    if (this.timer.state === 'running' || this.timer.state.startsWith('countdown_')) {
      this.audio.update(s.rpm, s.throttle, s.isSliding, s.speedMs);
    } else {
      this.audio.reset();
    }

    this.renderState.pos.x = interpolated.pos.x;
    this.renderState.pos.y = interpolated.pos.y;
    this.renderState.pos.z = interpolated.pos.z;

    this.renderState.heading = interpolated.heading;
    this.renderState.pitch = pitch;
    this.renderState.roll = roll;
    this.renderState.speedKmh = s.speedKmh;
    this.renderState.speedMs = s.speedMs;
    this.renderState.rpm = s.rpm;
    this.renderState.gear = s.gear;
    this.renderState.steer = s.steer;
    this.renderState.throttle = s.throttle;
    this.renderState.brake = s.brake;
    this.renderState.handbrake = s.handbrake;
    this.renderState.isSliding = s.isSliding;
    this.renderState.slipAngle = s.slipAngle;
    this.renderState.perkActive = s.perkActive;
    this.renderState.altitude = s.altitude;
    this.renderState.airborne = s.airborne;
    this.renderState.driftScore = s.driftScore;
    this.renderState.currentS = this.cachedS;
    this.renderState.exposure = exposure;
    this.renderState.dropDepth = dropDepth;
    this.renderState.runState = this.timer.state;
    this.renderState.elapsedSeconds = this.timer.getElapsedSeconds();
    this.renderState.totalPenaltySeconds = this.timer.totalPenaltySeconds;
    this.renderState.lastSplit = this.lastSplit;
    this.renderState.lastPenalty = this.lastPenalty;
    this.renderState.currentHairpin = this.currentHairpin;
    this.renderState.respawnCount = this.respawnCount;

    return this.renderState;
  }

  /**
   * Holds the car inside the built world along the ROAD AXIS.
   *
   * Everything in the boundary code below this is LATERAL. `projectFrenet` reports `t` across
   * the road and clamps `s` to the stage, so a car reversing straight back off the start line
   * keeps t ~ 0 and s pinned at 0: it reads as dead centre on the road while it is a hundred
   * metres outside the world, with the terrain skirts hanging in the sky above it. Measured
   * before this existed, 144 m out in 25 s of reverse with the wall silent the whole way — a
   * wall that only measures sideways cannot see a car leaving endways.
   *
   * IT LIVES HERE, NOT IN THE BOUNDARY BLOCK, because `stepPhysics` returns early for every
   * timer state except 'running'. An earlier attempt at this removed the `running` gate from
   * the two boundary branches, which changed nothing at all: that code is unreachable when
   * the timer is not running regardless, so the gate was never what was stopping it. Called
   * from the top of the step, it also covers the post-finish coast, where the car is still
   * moving and the boundary code is likewise skipped.
   *
   * Deliberately unscored. This is the edge of the map, not a rock face: a player who backs
   * off the grid should be stopped, not billed.
   */
  private applyStageBounds(p: FrenetProjection): boolean {
    if (!this.spline) return false;
    const overBehind = -p.sUnclamped;
    const overPast = p.sUnclamped - this.spline.totalLength;
    const overshoot = Math.max(overBehind, overPast);
    if (overshoot <= STAGE_APRON_M) return false;

    const end = p.sample;
    const tanLen = Math.hypot(end.tangentX, end.tangentZ) || 1;
    // Points back INTO the stage: forward at the start, backward at the finish.
    const inward = overBehind > overPast ? 1 : -1;
    const tx = (end.tangentX / tanLen) * inward;
    const tz = (end.tangentZ / tanLen) * inward;
    const push = overshoot - STAGE_APRON_M;
    this.vehicle.applyWallCollision(tx, tz, tx * push, tz * push, false);
    return true;
  }

  private stepPhysics(dt: number, inputAxes: InputAxes, enableAssist: boolean): void {
    // Handle countdown phase
    if (this.timer.state.startsWith('countdown_')) {
      const timerResult = this.timer.step(this.cachedS);
      if (timerResult.countdownBeep) {
        this.audio.playCountdownBeep(timerResult.countdownBeep);
        if (timerResult.countdownBeep === 'go') {
          this.recorder.start();
        }
      }
      return;
    }

    // Before anything else: the car must be inside the world in every state where it can
    // still move, which includes the post-finish coast below.
    //
    // ONE PROJECTION PER STEP, SHARED. `projectFrenet` walks the sample list, and with no
    // usable cache (cachedS is 0 on the start line) that walk is the whole stage — thousands
    // of samples. Giving the bounds check its own call doubled that on every physics step for
    // a value the boundary code below was about to compute anyway.
    const stepProj = this.spline
      ? this.spline.projectFrenet(this.vehicle.state.pos.x, this.vehicle.state.pos.z, this.cachedS)
      : null;
    const boundsMovedCar = stepProj ? this.applyStageBounds(stepProj) : false;

    // AFTER THE FINISH the car rolls to a halt rather than being abandoned mid-stride.
    //
    // Physics used to stop dead here, and that is what produced the car twitching on the
    // spot past the line: `prevPos` stays one step behind `pos` forever while the render
    // accumulator keeps cycling alpha from 0 to 1 every frame, so `getInterpolatedState`
    // slides back and forth over the last 0.6 m at frame rate. The speedometer was frozen
    // at whatever it read as the line went by — 133 km/h on a stationary car.
    //
    // Coasting to a stop fixes the readouts as a side effect and is what actually happens
    // at the end of a run. It cannot affect the leaderboard: the replay recorder stops at
    // the finish frame, and the server re-simulation in validate.ts drives VehicleModel and
    // Timer directly and never runs this file at all.
    if (this.timer.state === 'finished') {
      const s = this.vehicle.state;
      if (s.speedMs > 0.15) {
        this.vehicle.step(
          dt,
          { steer: 0, throttle: 0, brake: 0.45, handbrake: false, reverse: false },
          this.lastGround,
          false
        );
      } else if (this.prevPos.x !== s.pos.x || this.prevPos.z !== s.pos.z) {
        this.prevPos = { x: s.pos.x, z: s.pos.z };
        // Stopped. One more step with everything off settles `prevPos` onto `pos`, so the
        // interpolation has nothing left to slide between.
        this.vehicle.step(
          dt,
          { steer: 0, throttle: 0, brake: 1, handbrake: true, reverse: false },
          this.lastGround,
          false
        );
      }
      return;
    }

    if (this.timer.state !== 'running') {
      return;
    }

    let ground: GroundQuery = {
      groundY: 0,
      roadPitch: 0,
      roadBank: 0,
      surface: 'asphalt',
      onRoad: true,
      baseAltitude: 560,
    };

    let projSample: SplineSample | undefined;

    if (this.spline && stepProj) {
      // `applyStageBounds` only moves the car in the rare case that it left the map, so the
      // shared projection is still accurate on every ordinary step; re-derive only when it is
      // not.
      const proj = boundsMovedCar
        ? this.spline.projectFrenet(this.vehicle.state.pos.x, this.vehicle.state.pos.z, this.cachedS)
        : stepProj;
      this.cachedS = proj.s;
      projSample = proj.sample;

      if (this.hairpinSValues.length > 0) {
        let passed = 0;
        for (let i = 0; i < this.hairpinSValues.length; i++) {
          if (this.cachedS >= this.hairpinSValues[i]) {
            passed++;
          }
        }
        this.currentHairpin = passed;
      }

      const t = proj.t;
      const hw = proj.sample.halfWidth;
      const onRoad = Math.abs(t) <= hw;
      let surface = proj.sample.surface;

      if (!onRoad) {
        surface = Math.abs(t) <= hw + 0.85 ? 'gravel' : 'grass';
      }

      this.lastGround = {
        groundY: proj.sample.y,
        roadPitch: proj.sample.pitch,
        roadBank: proj.sample.bank,
        roadTangentHeading: proj.sample.heading,
        surface,
        onRoad,
        baseAltitude: proj.sample.altitude,
      };
      ground = this.lastGround;

      // Frenet Boundary Collision & Penalties (§6.6)
      const isLeft = t < 0;
      const isExposed =
        (isLeft && (proj.sample.exposure === 'left' || proj.sample.exposure === 'both')) ||
        (!isLeft && (proj.sample.exposure === 'right' || proj.sample.exposure === 'both'));

      // THE BOUNDARY IS NOT PART OF THE SCORING RULES — it is what keeps the car in the world.
      //
      // Both branches below used to be gated on `timer.state === 'running'`, which meant that
      // on the start line, and again after the finish, the road had no edges at all: the
      // player could simply drive off the corridor and out past the terrain, where there is
      // nothing to see but the underside of the ground and a black void. The gate belongs on
      // the PENALTY, not on the containment.
      const scoring = this.timer.state === 'running';

      if (isExposed && !proj.sample.guardrail) {
        // Drop Side: Off-Road Fall trigger
        if (Math.abs(t) > hw + 1.2) {
          if (scoring) {
            // Perk: Pandino 4x4 Nonna's Nerve (+3s instead of +8s)
            const penaltySec = this.vehicle.car.perk.id === "nonnas-nerve" ? 3.0 : 8.0;
            this.lastPenalty = this.timer.addPenalty('offroad', penaltySec);
            this.respawnCount++;
          }
          this.audio.playWallScrape();

          // Respawn at last checkpoint and sync cachedS. Before the run that checkpoint is
          // the start line, so wandering off simply puts the car back on the grid.
          this.vehicle.reset(this.lastCheckpointPos, this.lastCheckpointHeading, ground.baseAltitude);
          this.cachedS = this.lastCheckpointS;
        }
      } else {
        // Wall Side or Guardrail: solid contact. The car is clamped back to the road
        // edge, and the penalty is charged once per contact (VehicleModel owns the
        // cooldown, so client and server agree without duplicating the rule).
        const wallLimit = hw + WALL_CONTACT_MARGIN;
        if (Math.abs(t) > wallLimit) {
          const clampedT = (t > 0 ? 1 : -1) * wallLimit;
          const correctionX = proj.sample.normalX * (clampedT - t);
          const correctionZ = proj.sample.normalZ * (clampedT - t);
          const normalSign = t > 0 ? -1 : 1;
          const charged = this.vehicle.applyWallCollision(
            proj.sample.normalX * normalSign,
            proj.sample.normalZ * normalSign,
            correctionX,
            correctionZ,
            scoring
          );
          if (charged) {
            this.lastPenalty = this.timer.addPenalty('wall', 2.0);
            this.audio.playWallScrape();
          }
        }
      }
    }

    const steer = Math.round(Math.max(-1, Math.min(1, inputAxes.steer)) * 127) / 127;
    const throttle = Math.round(Math.max(0, Math.min(1, inputAxes.throttle)) * 255) / 255;
    const brake = Math.round(Math.max(0, Math.min(1, inputAxes.brake)) * 255) / 255;
    const handbrake = !!inputAxes.handbrake;
    const reverse = brake > 0.5 && throttle === 0;

    const prevGear = this.vehicle.state.gear;

    // Step Vehicle Model
    this.vehicle.step(
      dt,
      {
        steer,
        throttle,
        brake,
        handbrake,
        reverse,
      },
      ground,
      enableAssist
    );

    const nextGear = this.vehicle.state.gear;
    if (nextGear !== prevGear && nextGear > 0 && prevGear > 0) {
      this.audio.playGearShift(nextGear > prevGear);
    }

    // Step Timer
    const timerResult = this.timer.step(this.cachedS);

    if (timerResult.countdownBeep === 'go') {
      this.recorder.start();
    }

    // Record every step the timer counted, including the one that crosses the finish line.
    //
    // `timer.step()` above has already flipped the state to 'finished' on that last frame, so
    // testing `state === 'running'` alone dropped it — leaving the replay exactly one frame
    // shorter than the time it claims. The server re-simulation then reproduced a time
    // 16.67 ms lower than the client's and rejected it against the 5 ms tolerance, which
    // meant no legitimately completed run could ever validate.
    const countedThisStep =
      this.timer.state === 'running' || (timerResult.state === 'finished' && !this.hasTriggeredFinish);
    if (countedThisStep) {
      this.recorder.recordStep({ steer, throttle, brake, handbrake, reverse });
    }

    if (timerResult.newSplit) {
      this.lastSplit = timerResult.newSplit;
      this.audio.playCheckpointChime();
      // Update last checkpoint respawn anchor
      if (projSample) {
        this.lastCheckpointPos = { x: projSample.x, y: projSample.y, z: projSample.z };
        this.lastCheckpointHeading = projSample.heading;
        this.lastCheckpointS = projSample.s;
      }
    }

    if (timerResult.state === 'finished' && !this.hasTriggeredFinish) {
      this.hasTriggeredFinish = true;
      this.recorder.stop();
      if (this.onFinishCallback) {
        this.onFinishCallback(this.timer.getTotalTimeSeconds(), this.timer.splits);
      }
    }
  }


  public destroy(): void {
    this.input.destroy();
    this.audio.destroy();
  }
}
