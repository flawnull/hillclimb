/**
 * VAL BORBERA HILLCLIMB — Anti-Cheat Submission Validation
 * Pure TypeScript logic for validating runs and headless re-simulation on Edge API routes.
 */

import { verifyRunToken } from "./runToken";
import { getStageDef } from "@/game/track/stages";
import { CAR_DEFS } from "@/game/vehicle/cars";
import { VehicleModel, GroundQuery } from "@/game/vehicle/VehicleModel";
import { TrackSpline } from "@/game/track/TrackSpline";
import { Timer } from "@/game/timing/Timer";
import { ReplayFrame, computeReplayHash } from "@/game/timing/ReplayRecorder";
import { WALL_CONTACT_MARGIN, PHYSICS_DT, SIM_VERSION } from "@/game/vehicle/vehicleTuning";

export interface SubmitRunPayload {
  runId: string;
  token: string;
  stageId: string;
  carId: string;
  playerId?: string;
  playerName: string;
  timeMs: number;
  penaltyMs: number;
  checkpointsMs: number[];
  issuedAt: number;
  inputHash: string;
  simVersion?: number;
  replays: ReplayFrame[];
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  /**
   * Values produced by the server's own re-simulation, present only when `valid`.
   *
   * Callers should persist THESE rather than the client's figures. The submitted time is
   * only checked to within a 5 ms tolerance, so trusting it lets every submission shave up
   * to 5 ms off its real result, and the submitted splits were never checked at all — they
   * were stored verbatim. Since the authoritative numbers are computed here anyway,
   * returning them removes both gaps at no cost.
   */
  verified?: {
    rawTimeMs: number;
    penaltyMs: number;
    totalMs: number;
    checkpointsMs: number[];
  };
}

export async function validateRunSubmission(payload: SubmitRunPayload): Promise<ValidationResult> {
  const { runId, token, stageId, carId, playerId, playerName, timeMs, penaltyMs, issuedAt, inputHash, simVersion, replays } = payload;

  // 1. Sanitize Player Name (2-24 chars, no profanity or admin spoofing)
  if (!playerName || playerName.trim().length < 2 || playerName.trim().length > 24) {
    return { valid: false, reason: "Invalid player name length (2-24 characters required)" };
  }
  const cleanName = playerName.trim();
  if (cleanName.toUpperCase().includes("[ADMIN]") || cleanName.toUpperCase().includes("MODERATOR")) {
    return { valid: false, reason: "Name contains reserved administrative tags" };
  }
  if (playerId && (typeof playerId !== "string" || playerId.length > 128)) {
    return { valid: false, reason: "Invalid playerId format" };
  }
  // 1b. Cross-version guard. A replay recorded under different physics will not
  // reproduce its time, so reject it here with a clear reason rather than letting
  // it surface later as an opaque "re-simulation mismatch" that reads as cheating.
  // Compared with `!== undefined` so that sim version 0 is not treated as absent.
  if (simVersion !== undefined && simVersion !== SIM_VERSION) {
    return {
      valid: false,
      reason: `Simulation version mismatch (server is ${SIM_VERSION}, submission is ${simVersion}). This run was recorded under different physics and cannot be verified against the current build.`,
    };
  }

  // 2. Validate HMAC Token (binds runId|stageId|carId|issuedAt|simVersion)
  const tokenValid = await verifyRunToken(token, runId, stageId, carId, issuedAt, simVersion ?? SIM_VERSION);
  if (!tokenValid) {
    return { valid: false, reason: "Invalid or expired HMAC run token" };
  }


  // 3. Wall-Clock Sanity: serverNow - issuedAt >= timeMs * 0.82
  const serverNow = Date.now();
  const elapsedRealTimeMs = serverNow - issuedAt;
  if (elapsedRealTimeMs < timeMs * 0.82) {
    return { valid: false, reason: "Wall-clock sanity check failed (submission faster than real time)" };
  }

  // 4. Plausibility Bounds per Stage
  const stage = getStageDef(stageId);
  const car = CAR_DEFS[carId];
  if (!stage || !car) {
    return { valid: false, reason: "Unknown stage or car definition" };
  }

  // 5. Mandatory Replay Trace Check (§12.5)
  if (!replays || !Array.isArray(replays) || replays.length === 0) {
    return { valid: false, reason: "Replay trace is required for verification" };
  }

  // 5b. Replay length ceiling. Without one, a submission can hand the Edge function an
  // arbitrarily long array and make it run the full physics + Frenet projection loop over
  // every frame of it. Bronze is the slowest time the stage recognises, so 1.5x bronze is
  // generous for any real run while still bounding the work an attacker can demand.
  const maxFrames = Math.ceil(stage.bronzeTime * 1.5 / PHYSICS_DT);
  if (replays.length > maxFrames) {
    return { valid: false, reason: `Replay trace is implausibly long (${replays.length} frames, max ${maxFrames})` };
  }

  // 5c. Frame field validation. These values are divided and fed straight into the
  // simulation, so a non-finite or out-of-range entry would poison the vehicle state with
  // NaN and make every downstream comparison meaningless.
  for (let i = 0; i < replays.length; i++) {
    const f = replays[i];
    if (
      !f ||
      !Number.isFinite(f.steer) || f.steer < -127 || f.steer > 127 ||
      !Number.isFinite(f.throttle) || f.throttle < 0 || f.throttle > 255 ||
      !Number.isFinite(f.brake) || f.brake < 0 || f.brake > 255 ||
      !Number.isFinite(f.handbrake) || (f.handbrake !== 0 && f.handbrake !== 1)
    ) {
      return { valid: false, reason: `Replay frame ${i} contains out-of-range or non-finite input` };
    }
  }

  // 6. Replay Integrity Hash Check (§12.5.4)
  if (!inputHash || typeof inputHash !== "string") {
    return { valid: false, reason: "Missing replay integrity hash" };
  }
  const expectedHash = computeReplayHash(replays);
  if (inputHash !== expectedHash) {
    return { valid: false, reason: "Replay integrity hash mismatch" };
  }

  // 7. Headless Re-Simulation (§12.5.5)
  const spline = new TrackSpline(stage);
  const vehicle = new VehicleModel(carId);
  const timer = new Timer(stage.checkpoints);

  const firstSample = spline.getSampleAtS(0);
  vehicle.reset({ x: firstSample.x, y: firstSample.y, z: firstSample.z }, firstSample.heading, firstSample.altitude);

  let cachedS = 0;
  let lastCheckpointPos = { x: firstSample.x, y: firstSample.y, z: firstSample.z };
  let lastCheckpointHeading = firstSample.heading;
  let lastCheckpointS = 0;

  // Replay stream starts at GO (race start)
  timer.start();

  for (let i = 0; i < replays.length; i++) {
    const f = replays[i];
    const steer = f.steer / 127;
    const throttle = f.throttle / 255;
    const brake = f.brake / 255;
    const handbrake = f.handbrake === 1;
    const reverse = brake > 0.5 && throttle === 0;

    const proj = spline.projectFrenet(vehicle.state.pos.x, vehicle.state.pos.z, cachedS);
    cachedS = proj.s;

    const t = proj.t;
    const hw = proj.sample.halfWidth;
    const onRoad = Math.abs(t) <= hw;
    let surface = proj.sample.surface;
    if (!onRoad) {
      surface = Math.abs(t) <= hw + 0.85 ? "gravel" : "grass";
    }

    const ground: GroundQuery = {
      groundY: proj.sample.y,
      roadPitch: proj.sample.pitch,
      roadBank: proj.sample.bank,
      roadTangentHeading: proj.sample.heading,
      surface,
      onRoad,
      baseAltitude: proj.sample.altitude,
    };

    // Frenet Boundary Collision & Penalties
    const isLeft = t < 0;
    const isExposed =
      (isLeft && (proj.sample.exposure === "left" || proj.sample.exposure === "both")) ||
      (!isLeft && (proj.sample.exposure === "right" || proj.sample.exposure === "both"));

    if (isExposed && !proj.sample.guardrail) {
      if (Math.abs(t) > hw + 1.2 && timer.state === "running") {
        const penaltySec = vehicle.car.perk.id === "nonnas-nerve" ? 3.0 : 8.0;
        timer.addPenalty("offroad", penaltySec);
        vehicle.reset(lastCheckpointPos, lastCheckpointHeading, ground.baseAltitude);
        cachedS = lastCheckpointS;
      }
    } else {
      // Wall Side or Guardrail: solid contact. The car is clamped back to the road
      // edge, and the penalty is charged once per contact (VehicleModel owns the
      // cooldown, so client and server agree without duplicating the rule).
      const wallLimit = hw + WALL_CONTACT_MARGIN;
      if (Math.abs(t) > wallLimit && timer.state === 'running') {
        const clampedT = (t > 0 ? 1 : -1) * wallLimit;
        const correctionX = proj.sample.normalX * (clampedT - t);
        const correctionZ = proj.sample.normalZ * (clampedT - t);
        const normalSign = t > 0 ? -1 : 1;
        const charged = vehicle.applyWallCollision(
          proj.sample.normalX * normalSign,
          proj.sample.normalZ * normalSign,
          correctionX,
          correctionZ
        );
        if (charged) {
          timer.addPenalty("wall", 2.0);
        }
      }
    }

    vehicle.step(PHYSICS_DT, { steer, throttle, brake, handbrake, reverse }, ground, true);
    const res = timer.step(cachedS);

    if (res.newSplit) {
      lastCheckpointPos = { x: proj.sample.x, y: proj.sample.y, z: proj.sample.z };
      lastCheckpointHeading = proj.sample.heading;
      lastCheckpointS = proj.sample.s;
    }

    if (res.state === "finished") {
      break;
    }
  }

  // Floor time is 80% of gold time
  const floorTimeMs = Math.round(stage.goldTime * 0.8 * 1000);
  const submittedTotalMs = timeMs + (penaltyMs || 0);
  if (submittedTotalMs < floorTimeMs) {
    return { valid: false, reason: `Time is impossibly fast for this stage (floor: ${floorTimeMs}ms)` };
  }

  const simRawTimeMs = Math.round(timer.getElapsedSeconds() * 1000);
  const simPenaltyMs = Math.round(timer.totalPenaltySeconds * 1000);
  const rawDiffMs = Math.abs(simRawTimeMs - timeMs);
  const penaltyDiffMs = Math.abs(simPenaltyMs - (penaltyMs || 0));

  // Strict 5ms tolerance for deterministic re-simulation
  if (rawDiffMs > 5 || penaltyDiffMs > 5) {
    return {
      valid: false,
      reason: `Re-simulation mismatch (submitted: raw ${timeMs}ms / penalty ${penaltyMs || 0}ms, simulated: raw ${simRawTimeMs}ms / penalty ${simPenaltyMs}ms, raw diff: ${rawDiffMs}ms, penalty diff: ${penaltyDiffMs}ms)`,
    };
  }

  // The replay must actually have completed the stage.
  //
  // Without this check the anti-cheat is trivially bypassable. `Timer.stepCount` advances on
  // every frame while the run is `running`, and the simulated time compared just above is
  // only `stepCount * PHYSICS_DT`. So a replay of all-zero inputs — a car that never moves
  // and crosses no checkpoint — reproduces any claimed time exactly, and clears every other
  // gate here: the token is genuine, the integrity hash is computed over the attacker's own
  // frames, and the wall-clock check only requires that enough real time has passed.
  // Reaching the final checkpoint is the one thing a forged replay cannot fake.
  //
  // Deliberately checked LAST, after the re-simulation comparison. A run that reproduces its
  // claimed time to the millisecond but never finished is a different failure from one whose
  // physics diverged, and keeping this last means the reason reported distinguishes them.
  if (timer.state !== "finished") {
    return { valid: false, reason: "Replay did not complete the stage (final checkpoint never reached)" };
  }

  return {
    valid: true,
    verified: {
      rawTimeMs: simRawTimeMs,
      penaltyMs: simPenaltyMs,
      totalMs: simRawTimeMs + simPenaltyMs,
      checkpointsMs: timer.getSplitsMs(),
    },
  };
}



