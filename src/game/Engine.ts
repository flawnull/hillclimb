/**
 * VAL BORBERA HILLCLIMB — Core Game Engine
 * Coordinates fixed-step physics accumulator, input sampling, track projection,
 * boundary collision resolution, deterministic timing, audio, and render state.
 */

import { VehicleModel, GroundQuery, Vec3 } from "./vehicle/VehicleModel";
import { InputManager, InputAxes } from "./input/InputManager";
import { TrackSpline, SplineSample } from "./track/TrackSpline";
import { Timer, RunState, SplitRecord, PenaltyEvent } from "./timing/Timer";
import { ReplayRecorder } from "./timing/ReplayRecorder";
import { EngineAudio } from "./audio/EngineAudio";
import { WALL_CONTACT_MARGIN, PHYSICS_DT } from "./vehicle/vehicleTuning";
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
    this.hairpinSValues = spline.getAllSamples().filter((s) => s.isHairpinApex).map((s) => s.s);
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

    const clampedDelta = Math.min(frameDeltaSeconds, 0.25);
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

    return this.renderState;
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

    if (this.spline) {
      const proj = this.spline.projectFrenet(this.vehicle.state.pos.x, this.vehicle.state.pos.z, this.cachedS);
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

      ground = {
        groundY: proj.sample.y,
        roadPitch: proj.sample.pitch,
        roadBank: proj.sample.bank,
        roadTangentHeading: proj.sample.heading,
        surface,
        onRoad,
        baseAltitude: proj.sample.altitude,
      };

      // Frenet Boundary Collision & Penalties (§6.6)
      const isLeft = t < 0;
      const isExposed =
        (isLeft && (proj.sample.exposure === 'left' || proj.sample.exposure === 'both')) ||
        (!isLeft && (proj.sample.exposure === 'right' || proj.sample.exposure === 'both'));

      if (isExposed && !proj.sample.guardrail) {
        // Drop Side: Off-Road Fall trigger
        if (Math.abs(t) > hw + 1.2 && this.timer.state === 'running') {
          // Perk: Pandino 4x4 Nonna's Nerve (+3s instead of +8s)
          const penaltySec = this.vehicle.car.perk.id === "nonnas-nerve" ? 3.0 : 8.0;
          this.lastPenalty = this.timer.addPenalty('offroad', penaltySec);
          this.audio.playWallScrape();

          // Respawn at last checkpoint and sync cachedS
          this.vehicle.reset(this.lastCheckpointPos, this.lastCheckpointHeading, ground.baseAltitude);
          this.cachedS = this.lastCheckpointS;
        }
      } else {
        // Wall Side or Guardrail: solid contact. The car is clamped back to the road
        // edge, and the penalty is charged once per contact (VehicleModel owns the
        // cooldown, so client and server agree without duplicating the rule).
        const wallLimit = hw + WALL_CONTACT_MARGIN;
        if (Math.abs(t) > wallLimit && this.timer.state === 'running') {
          const clampedT = (t > 0 ? 1 : -1) * wallLimit;
          const correctionX = proj.sample.normalX * (clampedT - t);
          const correctionZ = proj.sample.normalZ * (clampedT - t);
          const normalSign = t > 0 ? -1 : 1;
          const charged = this.vehicle.applyWallCollision(
            proj.sample.normalX * normalSign,
            proj.sample.normalZ * normalSign,
            correctionX,
            correctionZ
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
