/**
 * VAL BORBERA HILLCLIMB — Vehicle Physics Model
 * 
 * Strict architectural rule (§12.5 & §15.3):
 * ZERO imports from Three.js, React, or browser globals (window, document).
 * Pure deterministic TypeScript for client-side gameplay and Edge anti-cheat verification.
 */

import { CarDef, CAR_DEFS, DEFAULT_CAR_ID } from "./cars";
import { detSin, detCos, detTan, detAtan2, detNormalizeAngle, DET_PI } from "./deterministicMath";
import {
  WALL_PENALTY_COOLDOWN_STEPS,
  PHYSICS_DT,

  GRAVITY,
  DRAG_COEFF,
  ROLL_RESIST,
  GRADE_SCALE,
  CORNER_STIFFNESS,
  DOWNFORCE_K,
  MAX_DOWNFORCE_BOOST,
  YAW_RESPONSE,
  STEER_SPEED_SENSITIVITY,
  MIN_STEER_RATIO,
  DIGITAL_STEER_RAMP,
  STEER_RETURN_RATE,
  PEDAL_RAMP_RATE,
  HANDBRAKE_YAW_MUL,
  HANDBRAKE_GRIP_MUL,
  RWD_OVERSTEER_POWER_PENALTY,
  STEERING_ASSIST_BLEND,
  STEERING_ASSIST_SPEED_THRESHOLD,
  SLIP_SMOKE_THRESHOLD_RAD,
  SURFACE_PROPERTIES,
  SurfaceType,
  REVERSE_MAX_SPEED,
} from "./vehicleTuning";

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface VehicleState {
  pos: Vec3;
  heading: number;       // radians (0 = +Z forward, positive = clockwise / right)
  vel: Vec2;             // world velocity in m/s
  yawRate: number;       // rad/s
  steer: number;         // -1..1 smoothed input
  throttle: number;      // 0..1 smoothed input
  brake: number;         // 0..1 smoothed input
  handbrake: boolean;
  gear: number;          // 1..6 (visual/audio)
  /** True once the car has stopped with the brake released: reverse may now be selected. */
  reverseArmed: boolean;
  rpm: number;           // 800..7500
  speedKmh: number;      // km/h
  speedMs: number;       // m/s
  vForward: number;      // forward speed along car heading
  vLateral: number;      // lateral speed (drift component)
  slipAngle: number;     // radians
  isSliding: boolean;
  onRoad: boolean;
  surface: SurfaceType;
  airborne: boolean;
  altitude: number;      // metres ASL
  perkActive: boolean;
  /** Physics steps remaining before another wall penalty may be charged. */
  wallPenaltyCooldown: number;
  cleanRun: boolean;     // true if no wall collisions
  driftScore: number;    // accumulated drift style points
}

export interface InputState {
  steer: number;         // -1 (left) to +1 (right)
  throttle: number;      // 0 to 1
  brake: number;         // 0 to 1
  handbrake: boolean;
  reverse?: boolean;
}

export interface GroundQuery {
  groundY: number;
  roadPitch: number;     // radians, positive = uphill
  roadBank: number;      // radians, positive = banked right
  roadTangentHeading?: number;
  surface: SurfaceType;
  onRoad: boolean;
  baseAltitude: number;
}

const BASE_ENGINE_FORCE = 3800; // Newtons

export class VehicleModel {
  public car: CarDef;
  public state: VehicleState;
  private prevPos: Vec3 = { x: 0, y: 0, z: 0 };
  private prevHeading: number = 0;

  constructor(carId: string = DEFAULT_CAR_ID, initialPos: Vec3 = { x: 0, y: 0, z: 0 }, initialHeading: number = 0) {
    this.car = CAR_DEFS[carId] || CAR_DEFS[DEFAULT_CAR_ID];
    this.state = this.createInitialState(initialPos, initialHeading);
    this.prevPos = { ...initialPos };
    this.prevHeading = initialHeading;
  }

  public setCar(carId: string): void {
    if (CAR_DEFS[carId]) {
      this.car = CAR_DEFS[carId];
    }
  }

  public reset(pos: Vec3 = { x: 0, y: 0, z: 0 }, heading: number = 0, altitude: number = 560): void {
    this.state = this.createInitialState(pos, heading, altitude);
    this.prevPos = { ...pos };
    this.prevHeading = heading;
  }

  private createInitialState(pos: Vec3, heading: number, altitude: number = 560): VehicleState {
    return {
      pos: { ...pos },
      heading,
      vel: { x: 0, z: 0 },
      yawRate: 0,
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: false,
      gear: 1,
      // A car that is already stationary with the brake released is legitimately ready for
      // reverse: stop, press brake, reverse. What must never happen is rolling INTO reverse
      // while braking from speed, and that is prevented by the throttle/brake conditions in
      // step() rather than by starting disarmed.
      reverseArmed: true,
      rpm: 900,
      speedKmh: 0,
      speedMs: 0,
      vForward: 0,
      vLateral: 0,
      slipAngle: 0,
      isSliding: false,
      onRoad: true,
      surface: 'asphalt',
      airborne: false,
      altitude,
      perkActive: false,
      wallPenaltyCooldown: 0,
      cleanRun: true,
      driftScore: 0,
    };
  }

  /**
   * Evaluates engine power based on velocity and torque curve.
   * Full power up to 45% vMax, tapering down to 25% at vMax.
   */
  private getEnginePower(vForward: number): number {
    const vMax = this.car.vMax;
    const vAbs = Math.max(0, vForward);

    if (vAbs >= vMax) {
      return 0;
    }

    const knee = 0.45 * vMax;
    if (vAbs <= knee) {
      return 1.0;
    }

    // Linear drop from 1.0 at knee to 0.25 at vMax
    const t = (vAbs - knee) / (vMax - knee);
    return 1.0 - t * 0.75;
  }

  /**
   * Fixed-timestep physics step (DT = 1/60).
   * Pure deterministic computation.
   */
  public step(
    dt: number = PHYSICS_DT,
    input: InputState,
    ground: GroundQuery,
    enableAssist: boolean = true
  ): void {
    const s = this.state;
    const car = this.car;

    // 1. Smooth input axes
    //
    // The steering command is NEGATED relative to the input axis. The input layer follows the
    // usual convention (-1 = left, +1 = right), but this model's heading convention is the
    // other way round: forward is (sin h, cos h), so an increasing heading rotates the car
    // toward +X, and with the chase camera behind the car +X is screen-LEFT. Feeding the axis
    // straight in therefore steered the car opposite to the key pressed.
    //
    // This was reported repeatedly and I twice "verified" it as correct using bad method:
    // the spline's `t` value, whose documented sign convention turned out not to be
    // dependable, and a camera-relative measurement taken AFTER the chase camera had already
    // rotated with the car — which is self-referential and always looks right. The honest
    // test is displacement against the camera basis sampled BEFORE the input, which showed
    // A moving the car +0.50 to screen-right and D moving it -0.49 to screen-left.
    //
    // Negating here rather than deeper keeps the road-tangent steering assist correct: that
    // works in this model's own heading convention and is added downstream, so it must not
    // be flipped.
    const steerCommand = -input.steer;
    if (steerCommand !== 0) {
      const step = DIGITAL_STEER_RAMP * dt;
      if (steerCommand > s.steer) {
        s.steer = Math.min(steerCommand, s.steer + step);
      } else {
        s.steer = Math.max(steerCommand, s.steer - step);
      }
    } else {
      // Auto-center
      if (s.steer > 0) {
        s.steer = Math.max(0, s.steer - STEER_RETURN_RATE * dt);
      } else if (s.steer < 0) {
        s.steer = Math.min(0, s.steer + STEER_RETURN_RATE * dt);
      }
    }

    // Throttle & brake ramp
    s.throttle += (input.throttle - s.throttle) * Math.min(1.0, PEDAL_RAMP_RATE * dt);
    s.brake += (input.brake - s.brake) * Math.min(1.0, PEDAL_RAMP_RATE * dt);
    s.handbrake = !!input.handbrake;

    // 2. Decompose velocity into Forward and Right components
    const sinH = detSin(s.heading);
    const cosH = detCos(s.heading);
    const forwardX = sinH;
    const forwardZ = cosH;
    const rightX = cosH;
    const rightZ = -sinH;

    const vForward = s.vel.x * forwardX + s.vel.z * forwardZ;
    const vLateral = s.vel.x * rightX + s.vel.z * rightZ;
    const speed = Math.sqrt(s.vel.x * s.vel.x + s.vel.z * s.vel.z);

    // 3. Surface grip and rolling resistance
    s.surface = ground.surface;
    s.onRoad = ground.onRoad;
    const surfProp = SURFACE_PROPERTIES[s.surface] || SURFACE_PROPERTIES.asphalt;

    let surfaceGrip = surfProp.gripMul * (car.surfaceBias[s.surface] ?? 1.0);

    // Perk: Lanzo Alta All-Surface perk (cuts 45% offroad penalty)
    if (car.perk.id === 'all-surface' && s.surface !== 'asphalt') {
      const penalty = 1.0 - surfaceGrip;
      surfaceGrip = 1.0 - penalty * 0.55;
    }

    // 4. Longitudinal Forces
    let enginePowerCoeff = this.getEnginePower(vForward);
    let engineMultiplier = car.powerMul;

    // Check slip angle for drift / perks
    const slipAngle = detAtan2(vLateral, Math.abs(vForward) + 0.5);
    s.slipAngle = slipAngle;
    const absSlip = Math.abs(slipAngle);

    // Perk: Weiss-Blau Momentum Six (+12% power in 6°..14° slip angle window)
    let perkActive = false;
    const slipDeg = (absSlip * 180) / DET_PI;
    if (car.perk.id === 'momentum-six' && slipDeg >= 6.0 && slipDeg <= 14.0 && vForward > 5.0) {
      engineMultiplier *= 1.12;
      perkActive = true;
    }

    // RWD power-on oversteer penalty if sliding heavily
    if (car.drive === 'RWD' && s.isSliding && s.throttle > 0.4) {
      engineMultiplier *= (1.0 - RWD_OVERSTEER_POWER_PENALTY);
    }

    // Reverse gear handling.
    //
    // Reverse must be SELECTED, not fallen into. The previous condition engaged reverse
    // whenever the brake was held below 0.35 m/s — so braking into a hairpin rolled straight
    // through zero and started accelerating backwards while the player was still holding what
    // they believed was the brake. And because `vForward` is then negative, the condition
    // stayed true indefinitely: the car accelerated backwards without limit, reaching 30 km/h
    // in reverse. Steering then appears inverted on screen, because the front wheels still
    // turn the way you asked but the car is travelling the other way.
    //
    // The rule now: come to a stop, RELEASE the brake, then hold it again. Touching the
    // throttle always cancels reverse. This is the standard arcade convention and it makes
    // reverse impossible to enter by accident while braking.
    if (input.throttle > 0.05) {
      s.reverseArmed = false;
    } else if (vForward < 0.3 && s.brake < 0.05) {
      s.reverseArmed = true;
    }

    let F_engine = 0;
    const isReversing = s.reverseArmed && s.brake > 0.1 && input.throttle === 0 && vForward <= 0.35;
    if (isReversing) {
      const reverseDemand = Math.max(s.throttle, s.brake);
      F_engine = -reverseDemand * BASE_ENGINE_FORCE * 1.15 * car.powerMul * surfaceGrip;
    } else {
      F_engine = s.throttle * BASE_ENGINE_FORCE * engineMultiplier * enginePowerCoeff * surfaceGrip;
      if (s.handbrake && s.throttle < 0.7) {
        F_engine *= 0.25; // Handbrake retards engine drive
      }
    }

    // Braking force (with Featherweight perk check for Alpe A-110)
    let brakeCapacity = car.brakeForce;
    if (car.perk.id === 'featherweight') {
      brakeCapacity *= 1.22; // ~18% shorter braking distance
      if (s.brake > 0.3) perkActive = true;
    }
    const effectiveBrake = isReversing ? 0.0 : Math.max(s.brake, s.handbrake ? 0.72 : 0.0);
    const F_brake = -Math.sign(vForward || 1) * effectiveBrake * (brakeCapacity * car.mass) * surfaceGrip;

    // Aerodynamic Drag & Rolling Resistance
    const F_drag = -0.5 * DRAG_COEFF * vForward * Math.abs(vForward);
    const F_roll = -ROLL_RESIST * vForward * surfProp.rollMul;

    // Grade force (uphill saps speed, downhill accelerates)
    const pitch = ground.roadPitch;
    const F_grade = -GRAVITY * car.mass * detSin(pitch) * GRADE_SCALE;

    const F_longitudinal = F_engine + F_brake + F_drag + F_roll + F_grade;
    const a_longitudinal = F_longitudinal / car.mass;

    // 5. Lateral / Cornering Forces
    const downforce = 1.0 + Math.min(DOWNFORCE_K * speed * speed, MAX_DOWNFORCE_BOOST);
    let gripLimit = car.grip * surfaceGrip * downforce * (car.mass * GRAVITY * 0.95);
    /** Grip before the handbrake reduction — the yaw cap below is built from this. */
    const gripLimitBeforeHandbrake = gripLimit;

    if (s.handbrake) {
      gripLimit *= HANDBRAKE_GRIP_MUL;
      // NOTE: no perkActive here. The handbrake is available to every car and is not a
      // perk; setting it lit the perk badge and the ground aura on all four cars, so the
      // signature-ability indicator meant nothing.
    }

    const F_lat_raw = -slipAngle * CORNER_STIFFNESS * (car.mass * GRAVITY * 0.12);
    const F_lateral = Math.max(-gripLimit, Math.min(gripLimit, F_lat_raw));

    s.isSliding = Math.abs(F_lat_raw) > gripLimit || absSlip > SLIP_SMOKE_THRESHOLD_RAD;

    // Accumulate drift score if sliding at speed
    if (s.isSliding && speed > 8.0) {
      s.driftScore += Math.min(absSlip, 0.45) * speed * dt * 50;
    }

    // 6. Steering & Yaw Dynamics
    // Speed-sensitive steering ratio
    const speedRatio = Math.min(1.0, speed / STEER_SPEED_SENSITIVITY);
    const steerScale = 1.0 - speedRatio * (1.0 - MIN_STEER_RATIO);
    const effectiveSteerAngle = s.steer * car.maxSteerAngle * steerScale;

    // Steering assist blend toward road tangent at high speed when no manual steer
    let targetSteerAngle = effectiveSteerAngle;
    if (enableAssist && Math.abs(s.steer) < 0.05 && speed > STEERING_ASSIST_SPEED_THRESHOLD && ground.roadTangentHeading !== undefined) {
      const headingDiff = detNormalizeAngle(ground.roadTangentHeading - s.heading);
      targetSteerAngle += headingDiff * STEERING_ASSIST_BLEND;
    }

    // Target yaw rate based on Ackerman-like kinematic curvature, LIMITED BY GRIP.
    //
    // The kinematic term alone is what the steering geometry asks for, and it grows without
    // bound with speed: at 60 km/h with full lock it demands 4.2 rad/s, about 240 deg/s, a
    // rate no tyre could ever deliver. The car duly pivoted to that rate while its velocity
    // carried straight on, so the slip angle reached 80 degrees within a second and the
    // whole car scrubbed sideways to a halt. This was invisible while the integrator was
    // feeding energy back in (see the Coriolis note below); closing that leak exposed it.
    //
    // A steady turn needs lateral acceleration `v * w`, and the tyres can supply at most
    // `gripLimit / mass`, so `w <= (gripLimit / mass) / v`. The cap is computed from the
    // grip BEFORE the handbrake reduction and given a little headroom, because a car can
    // transiently rotate faster than its steady-state limit — and because the handbrake is
    // supposed to rotate the car MORE, not less. Deliberate oversteer still arrives through
    // HANDBRAKE_YAW_MUL and the locked-axle impulse below, which act on top of this.
    const YAW_CAP_HEADROOM = 1.15;
    const maxLatAccel = (gripLimitBeforeHandbrake / car.mass) * YAW_CAP_HEADROOM;
    const yawCap = maxLatAccel / Math.max(2.0, Math.abs(vForward));
    const kinematicYawRate = (vForward / car.wheelbase) * detTan(targetSteerAngle);
    const targetYawRate = Math.max(-yawCap, Math.min(yawCap, kinematicYawRate));
    let yawBlend = (targetYawRate - s.yawRate) * YAW_RESPONSE * dt;

    if (s.handbrake) {
      yawBlend *= HANDBRAKE_YAW_MUL;
      // Direct rotational impulse from locked rear axle when steering into a corner
      if (Math.abs(s.steer) > 0.05 && speed > 3.0) {
        s.yawRate += s.steer * 4.2 * dt;
      }
    }

    s.yawRate += yawBlend;
    s.heading = detNormalizeAngle(s.heading + s.yawRate * dt);

    // 7. Integrate Velocity in Local Coordinates (with rotating body-frame centripetal term)
    //
    // BOTH rotating-frame terms, not just the lateral one.
    //
    // Velocity is carried in world coordinates, decomposed into body components against the
    // OLD heading here, integrated, and recomposed below against the NEW heading. That
    // recomposition is itself a rotation of the velocity vector by `yawRate * dt`, so the
    // body-frame derivative has to cancel it: writing R for body-to-world and J for the
    // body-frame rotation generator, `R(h + w dt)(u + f dt) ~ R(h)(u + f dt + w dt J u)`, so
    // the world acceleration only equals the intended `a` if `f = a - w J u`. With this
    // model's basis (forward = (sin h, cos h), right = (cos h, -sin h)) that generator is
    // `J u = (-u_lateral, u_forward)`, giving `+ yawRate * vLateral` on the forward axis and
    // `- yawRate * vForward` on the lateral one.
    //
    // Only the lateral half was here. The pair together is a pure rotation and preserves
    // speed; half of it is not, and it does work on the car every step: to first order the
    // speed changes by `-2 * vForward * vLateral * yawRate * dt` per step, which in a drift
    // (nose rotated into the corner ahead of the velocity, so `vLateral` opposes `yawRate`)
    // is POSITIVE and compounds at 60 Hz. Measured on the Panda GT with the throttle fully
    // released and nothing but steering input: 30 km/h became 74.6 km/h in five seconds, and
    // 60 km/h became 365.8. That is the reported "drifting multiplies your speed" — the car
    // was manufacturing kinetic energy out of the integrator.
    let newVForward = vForward + (a_longitudinal + vLateral * s.yawRate) * dt;

    // Reverse is speed-limited. Nothing capped it before, so holding the brake accelerated
    // the car backwards indefinitely.
    if (newVForward < -REVERSE_MAX_SPEED) {
      newVForward = -REVERSE_MAX_SPEED;
    }
    let newVLateral = vLateral + (F_lateral / car.mass - vForward * s.yawRate) * dt;

    // Low-speed damping and parking brake hold
    if (s.handbrake && Math.abs(newVForward) < 0.8 && s.throttle < 0.2) {
      newVForward = 0;
      newVLateral = 0;
    } else if (!input.reverse && Math.abs(newVForward) < 0.2 && s.throttle < 0.05 && s.brake > 0.1) {
      newVForward = 0;
    }
    if (!s.isSliding && Math.abs(newVLateral) < 0.5) {
      newVLateral *= 0.85; // fast lateral damping
    }

    // 8. Convert local velocity back to world coordinates

    const newSinH = detSin(s.heading);
    const newCosH = detCos(s.heading);


    s.vel.x = newVForward * newSinH + newVLateral * newCosH;
    s.vel.z = newVForward * newCosH - newVLateral * newSinH;

    s.vForward = newVForward;
    s.vLateral = newVLateral;
    s.speedMs = Math.sqrt(s.vel.x * s.vel.x + s.vel.z * s.vel.z);
    s.speedKmh = s.speedMs * 3.6;

    // 9. Update Position
    this.prevPos = { ...s.pos };
    this.prevHeading = s.heading;

    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    s.pos.y = ground.groundY;
    // The world is modelled directly in metres above sea level: a spline sample's y IS
    // its altitude, and groundY comes from that same sample. Adding the two double-counted
    // it — the HUD read 1113 m on a road at 560 m, and the climb delta showed +553 m on a
    // stage that descends. Display-only; nothing in the physics reads this.
    s.altitude = ground.baseAltitude;
    s.perkActive = perkActive;
    if (s.wallPenaltyCooldown > 0) s.wallPenaltyCooldown--;

    // 10. Update Cosmetic Gear and RPM
    this.updateGearsAndRpm(newVForward);
  }

  private updateGearsAndRpm(vForward: number): void {
    const s = this.state;
    if (vForward < -0.15) {
      s.gear = 0; // Reverse (R)
      const revProgress = Math.min(1.0, Math.abs(vForward) / 14.0);
      s.rpm = 900 + revProgress * 4200 * (0.8 + 0.2 * s.brake);
      return;
    }

    const vAbs = Math.abs(vForward);
    const vMax = this.car.vMax;

    // 6-speed stepped distribution
    const gearRatios = [0.18, 0.32, 0.50, 0.68, 0.85, 1.0];
    let currentGear = 1;

    for (let i = 0; i < gearRatios.length; i++) {
      if (vAbs >= gearRatios[i] * vMax * 0.92 && i < gearRatios.length - 1) {
        currentGear = i + 2;
      }
    }

    s.gear = currentGear;

    const prevGearSpeed = currentGear === 1 ? 0 : gearRatios[currentGear - 2] * vMax;
    const currentGearSpeed = gearRatios[currentGear - 1] * vMax;
    const gearProgress = Math.max(0, Math.min(1.0, (vAbs - prevGearSpeed) / (currentGearSpeed - prevGearSpeed || 1)));

    const idleRpm = 900;
    const redlineRpm = 7200;
    s.rpm = idleRpm + gearProgress * (redlineRpm - idleRpm) * (0.8 + 0.2 * s.throttle);
  }

  /**
   * Interpolate between previous state and current state for 60fps+ smooth rendering.
   */
  public getInterpolatedState(alpha: number): { pos: Vec3; heading: number } {
    const dHeading = detNormalizeAngle(this.state.heading - this.prevHeading);
    return {
      pos: {
        x: this.prevPos.x + (this.state.pos.x - this.prevPos.x) * alpha,
        y: this.prevPos.y + (this.state.pos.y - this.prevPos.y) * alpha,
        z: this.prevPos.z + (this.state.pos.z - this.prevPos.z) * alpha,
      },
      heading: detNormalizeAngle(this.prevHeading + dHeading * alpha),
    };
  }

  /**
   * Apply a collision impulse against a rock wall
   */
  /**
   * Resolves contact with the rock wall on the non-exposed side of the road.
   *
   * `correctionX/Z` push the car back onto the road edge. Without that the wall applied
   * an impulse but never actually stopped anything: the car carried on into the field
   * while the caller charged a penalty on every step it spent out there.
   *
   * @returns true if the caller should charge a penalty — i.e. this is the START of a
   *          contact, not a continuation of one already being billed.
   */
  public applyWallCollision(
    normalX: number,
    normalZ: number,
    correctionX: number = 0,
    correctionZ: number = 0
  ): boolean {
    const s = this.state;
    s.cleanRun = false;

    // Put the car back on the road edge. This is what makes the wall solid.
    s.pos.x += correctionX;
    s.pos.z += correctionZ;

    // Kill 55% speed (70% for Alpe A-110)
    const speedRetention = this.car.perk.id === 'featherweight' ? 0.30 : 0.45;
    s.vel.x *= speedRetention;
    s.vel.z *= speedRetention;

    // Apply impulse along normal
    const impulse = 4.0;
    s.vel.x += normalX * impulse;
    s.vel.z += normalZ * impulse;
    s.yawRate *= -0.5;

    if (s.wallPenaltyCooldown > 0) return false;
    s.wallPenaltyCooldown = WALL_PENALTY_COOLDOWN_STEPS;
    return true;
  }
}
