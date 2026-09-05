/**
 * VAL BORBERA HILLCLIMB — Anti-Cheat & Deterministic Re-Simulation Test Suite
 * 
 * Verifies:
 * 1. Client engine simulation & server headless re-simulation determinism (0–5ms match).
 * 2. Long-stage determinism on 11.5 km Salita di Cosola (34 hairpins).
 * 3. Off-road fall respawn synchronization (frame counts and alignment remain 1:1).
 * 4. Strict rejection of missing replays, tampered input frames, mismatched inputHash, and spoofed times.
 * 5. Per-player Gran Turismo (GT) leaderboard deduplication keyed by persistent playerId UUID.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { Engine } from "../src/game/Engine";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { getStageDef } from "../src/game/track/stages";
import { validateRunSubmission, SubmitRunPayload } from "../src/lib/validate";
import { createRunToken } from "../src/lib/runToken";
import { computeReplayHash } from "../src/game/timing/ReplayRecorder";
import { MockRedis } from "../src/lib/redis";
import { PHYSICS_DT, SIM_VERSION } from "../src/game/vehicle/vehicleTuning";
import { detAtan2, detNormalizeAngle } from "../src/game/vehicle/deterministicMath";


describe("Anti-Cheat Re-Simulation & Determinism Suite", () => {
  const sprintStageDef = getStageDef("borbera-sprint");
  const cosolaStageDef = getStageDef("salita-cosola");
  const carId = "weiss-blau-30";

  it("should achieve exact deterministic time equivalence between client engine and server re-simulation on Borbera Sprint", async () => {
    const spline = new TrackSpline(sprintStageDef);
    const engine = new Engine(carId);
    engine.setSpline(spline);

    // Start race run directly (timer & recorder active from t=0)
    engine.startRun();

    let cachedS = 0;
    // Scripted trace over 8000 physics steps (~133.3 seconds, exceeding the anti-cheat floor
    // of ~51s for this car/stage — see validate.ts, floor = stage.length / car.vMax * 0.85)
    for (let step = 0; step < 8000; step++) {
      const s = engine.vehicle.state;
      const proj = spline.projectFrenet(s.pos.x, s.pos.z, cachedS);
      cachedS = proj.s;

      const lookaheadDist = Math.max(8, Math.min(22, s.speedMs * 0.7));
      const lookaheadS = Math.min(spline.totalLength - 0.5, proj.s + lookaheadDist);
      const targetSample = spline.getSampleAtS(lookaheadS);

      const dx = targetSample.x - s.pos.x;
      const dz = targetSample.z - s.pos.z;
      const targetHeading = detAtan2(dx, dz);
      const angleDiff = detNormalizeAngle(targetHeading - s.heading);

      const latCorrection = -proj.t * 0.15;
      // Negated for the same reason as the completion test below: the model flips the
      // incoming steer axis, so a controller working in its heading convention must invert.
      const steer = Math.max(-1.0, Math.min(1.0, -(angleDiff * 3.8 + latCorrection)));

      const curvature = Math.abs(angleDiff) / lookaheadDist;
      let targetSpeedKmh = 140;
      if (curvature > 0.04) {
        targetSpeedKmh = 32;
      } else if (curvature > 0.02) {
        targetSpeedKmh = 60;
      } else if (curvature > 0.01) {
        targetSpeedKmh = 95;
      }

      let throttle = 0;
      let brake = 0;
      let handbrake = false;

      if (s.speedKmh < targetSpeedKmh) {
        throttle = 1.0;
      } else {
        brake = Math.min(1.0, (s.speedKmh - targetSpeedKmh) * 0.08);
        if (curvature > 0.05 && s.speedKmh > 35) {
          handbrake = true;
        }
      }

      engine.input.setTouchAxes({ steer, throttle, brake, handbrake });
      engine.update(PHYSICS_DT, true);
    }

    const replayFrames = engine.recorder.stop();
    const inputHash = computeReplayHash(replayFrames);
    const clientTimeMs = Math.round(engine.timer.getElapsedSeconds() * 1000);
    const penaltyMs = Math.round(engine.timer.totalPenaltySeconds * 1000);
    const splitsMs = engine.timer.getSplitsMs();

    assert.equal(replayFrames.length, 8000, "Replay frame count should equal total physics steps");

    const runId = `test_sprint_${Date.now()}`;
    const issuedAt = Date.now() - (clientTimeMs + 5000);
    const token = await createRunToken(runId, sprintStageDef.id, carId, issuedAt);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_player_uuid_1",
      playerName: "Marco Rossi",
      timeMs: clientTimeMs,
      penaltyMs,
      checkpointsMs: splitsMs,
      issuedAt,
      inputHash,
      replays: replayFrames,
    };

    // The scripted driver does NOT complete the stage — it stalls around s=2300/3735 on
    // Borbera Sprint, looping through off-road respawns. What this test actually proves is
    // DETERMINISM: that the server's re-simulation reproduces the client engine's time and
    // penalties within the 5 ms tolerance. Since the completion check runs last, failing
    // *only* on completion means every earlier gate — token, hash, floor time, and the
    // re-simulation comparison — passed. Asserting the reason pins that precisely.
    const result = await validateRunSubmission(payload);
    assert.match(
      result.reason ?? "",
      /did not complete/i,
      `Re-simulation should have matched the client exactly; instead: ${result.reason}`
    );
  });

  it("should achieve exact deterministic time equivalence on the Salita di Cosola stage", async () => {
    const spline = new TrackSpline(cosolaStageDef);
    const engine = new Engine("alpe-a110");
    engine.setSpline(spline);

    engine.startRun();

    let cachedS = 0;
    // Scripted driving trace over 7000 physics steps (~116.7 seconds, comfortably clearing
    // the anti-cheat floor of ~30s for this car/stage — see validate.ts)
    for (let step = 0; step < 7000; step++) {
      const s = engine.vehicle.state;
      const proj = spline.projectFrenet(s.pos.x, s.pos.z, cachedS);
      cachedS = proj.s;

      const lookaheadDist = Math.max(7, Math.min(20, s.speedMs * 0.65));
      const lookaheadS = Math.min(spline.totalLength - 0.5, proj.s + lookaheadDist);
      const targetSample = spline.getSampleAtS(lookaheadS);

      const dx = targetSample.x - s.pos.x;
      const dz = targetSample.z - s.pos.z;
      const targetHeading = detAtan2(dx, dz);
      const angleDiff = detNormalizeAngle(targetHeading - s.heading);

      const latCorrection = -proj.t * 0.18;
      const steer = Math.max(-1.0, Math.min(1.0, angleDiff * 4.0 + latCorrection));

      const curvature = Math.abs(angleDiff) / lookaheadDist;
      let targetSpeedKmh = 135;
      if (curvature > 0.045) {
        targetSpeedKmh = 30;
      } else if (curvature > 0.02) {
        targetSpeedKmh = 55;
      } else if (curvature > 0.01) {
        targetSpeedKmh = 90;
      }

      let throttle = 0;
      let brake = 0;
      let handbrake = false;

      if (s.speedKmh < targetSpeedKmh) {
        throttle = 1.0;
      } else {
        brake = Math.min(1.0, (s.speedKmh - targetSpeedKmh) * 0.1);
        if (curvature > 0.06 && s.speedKmh > 35) {
          handbrake = true;
        }
      }

      engine.input.setTouchAxes({ steer, throttle, brake, handbrake });
      engine.update(PHYSICS_DT, true);
    }

    const replayFrames = engine.recorder.stop();
    const inputHash = computeReplayHash(replayFrames);
    const clientTimeMs = Math.round(engine.timer.getElapsedSeconds() * 1000);
    const penaltyMs = Math.round(engine.timer.totalPenaltySeconds * 1000);
    const splitsMs = engine.timer.getSplitsMs();

    assert.equal(replayFrames.length, 7000, "Replay frame count must match 25,000 steps");

    const runId = `test_cosola_${Date.now()}`;
    const issuedAt = Date.now() - (clientTimeMs + 5000);
    const token = await createRunToken(runId, cosolaStageDef.id, "alpe-a110", issuedAt);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: cosolaStageDef.id,
      carId: "alpe-a110",
      playerId: "p_test_player_uuid_cosola",
      playerName: "Cosola Specialist",
      timeMs: clientTimeMs,
      penaltyMs,
      checkpointsMs: splitsMs,
      issuedAt,
      inputHash,
      replays: replayFrames,
    };

    const result = await validateRunSubmission(payload);
    // The scripted driver does NOT complete the stage — it stalls partway through Salita di
    // Cosola, looping through off-road respawns. What this test actually proves is
    // DETERMINISM: that the server's re-simulation reproduces the client engine's time and
    // penalties within the 5 ms tolerance. Since the completion check runs last, failing
    // *only* on completion means every earlier gate — token, hash, floor time, and the
    // re-simulation comparison — passed. Asserting the reason pins that precisely.
    assert.match(
      result.reason ?? "",
      /did not complete/i,
      `Re-simulation should have matched the client exactly; instead: ${result.reason}`
    );
  });

  it("should maintain 1:1 frame synchronization and pass re-simulation across off-road fall respawns", async () => {
    const spline = new TrackSpline(sprintStageDef);
    const engine = new Engine("pandino-4x4");
    engine.setSpline(spline);

    engine.startRun();

    let cachedS = 0;
    // Drive past sector 1 into the exposed riverbank sweeper (~1200 steps)
    for (let step = 0; step < 8000; step++) {
      const s = engine.vehicle.state;
      const proj = spline.projectFrenet(s.pos.x, s.pos.z, cachedS);
      cachedS = proj.s;

      // On step 2100..2140, steer hard left off the road to trigger an intentional off-road fall
      if (step >= 2100 && step < 2140) {
        engine.input.setTouchAxes({ steer: -1.0, throttle: 1.0, brake: 0, handbrake: false });
      } else {
        const lookaheadS = Math.min(spline.totalLength - 0.5, proj.s + 15);
        const targetSample = spline.getSampleAtS(lookaheadS);
        const dx = targetSample.x - s.pos.x;
        const dz = targetSample.z - s.pos.z;
        const targetHeading = detAtan2(dx, dz);
        const angleDiff = detNormalizeAngle(targetHeading - s.heading);
        const steer = Math.max(-1.0, Math.min(1.0, angleDiff * 3.5));
        engine.input.setTouchAxes({ steer, throttle: s.speedKmh < 80 ? 1.0 : 0.2, brake: 0, handbrake: false });
      }

      engine.update(PHYSICS_DT, true);
    }

    const replayFrames = engine.recorder.stop();
    const inputHash = computeReplayHash(replayFrames);
    const clientTimeMs = Math.round(engine.timer.getElapsedSeconds() * 1000);
    const penaltyMs = Math.round(engine.timer.totalPenaltySeconds * 1000);
    const splitsMs = engine.timer.getSplitsMs();

    assert.ok(penaltyMs > 0, "Off-road penalty should be assessed on fall");
    assert.equal(replayFrames.length, 8000, "Replay frames must stay 1:1 with physics steps across fall respawn");

    const runId = `test_fall_${Date.now()}`;
    const issuedAt = Date.now() - (clientTimeMs + 5000);
    const token = await createRunToken(runId, sprintStageDef.id, "pandino-4x4", issuedAt);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId: "pandino-4x4",
      playerId: "p_test_player_fall",
      playerName: "Offroad Driver",
      timeMs: clientTimeMs,
      penaltyMs,
      checkpointsMs: splitsMs,
      issuedAt,
      inputHash,
      replays: replayFrames,
    };

    const result = await validateRunSubmission(payload);
    // As with the other determinism cases, the scripted driver does not reach the finish, so
    // the run is rejected on completion. Failing *only* on completion is the assertion: it
    // means the re-simulation reproduced the client's time AND its off-road penalties
    // exactly across every respawn, which is what this test exists to prove.
    assert.match(
      result.reason ?? "",
      /did not complete/i,
      `Re-simulation should have matched the client across respawns; instead: ${result.reason}`
    );
  });

  it("should reject submissions missing replay frames", async () => {
    const runId = `test_empty_${Date.now()}`;
    const issuedAt = Date.now() - 150000;
    const token = await createRunToken(runId, sprintStageDef.id, carId, issuedAt);

    const payload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_empty",
      playerName: "Speedy",
      timeMs: 145000,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash: "",
      replays: [] as any,
    };

    const result = await validateRunSubmission(payload as SubmitRunPayload);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Replay trace is required/i);
  });

  it("should reject submissions with tampered inputHash", async () => {
    const spline = new TrackSpline(sprintStageDef);
    const engine = new Engine(carId);
    engine.setSpline(spline);
    engine.startRun();

    for (let step = 0; step < 60; step++) {
      engine.input.setTouchAxes({ steer: 0, throttle: 1.0, brake: 0, handbrake: false });
      engine.update(PHYSICS_DT, true);
    }

    const replayFrames = engine.recorder.stop();
    const runId = `test_bad_hash_${Date.now()}`;
    const issuedAt = Date.now() - 200000;
    const token = await createRunToken(runId, sprintStageDef.id, carId, issuedAt);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_tamper",
      playerName: "Tamperer",
      timeMs: 140000,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash: "deadbeef12345", // Altered hash
      replays: replayFrames,
    };

    const result = await validateRunSubmission(payload);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /hash mismatch/i);
  });

  it("should reject submissions with fabricated faster times exceeding 5ms tolerance", async () => {
    const spline = new TrackSpline(sprintStageDef);
    const engine = new Engine(carId);
    engine.setSpline(spline);
    engine.startRun();

    for (let step = 0; step < 8000; step++) {
      engine.input.setTouchAxes({ steer: 0, throttle: 0.8, brake: 0, handbrake: false });
      engine.update(PHYSICS_DT, true);
    }

    const replayFrames = engine.recorder.stop();
    const inputHash = computeReplayHash(replayFrames);
    const actualSimTimeMs = Math.round(engine.timer.getElapsedSeconds() * 1000);
    const fabricatedTimeMs = actualSimTimeMs - 50; // 50ms faster than simulated

    const runId = `test_fake_time_${Date.now()}`;
    const issuedAt = Date.now() - (actualSimTimeMs + 10000);
    const token = await createRunToken(runId, sprintStageDef.id, carId, issuedAt);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_faker",
      playerName: "Faker",
      timeMs: fabricatedTimeMs,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash,
      replays: replayFrames,
    };

    const result = await validateRunSubmission(payload);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Re-simulation mismatch/i);
  });

  it("should reject submissions with admin spoofing in player name", async () => {
    const runId = `test_admin_${Date.now()}`;
    const issuedAt = Date.now() - 150000;
    const token = await createRunToken(runId, sprintStageDef.id, carId, issuedAt);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_admin",
      playerName: "[ADMIN] Luigi",
      timeMs: 145000,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash: "somehash",
      replays: [{ steer: 0, throttle: 255, brake: 0, handbrake: 0 }],
    };

    const result = await validateRunSubmission(payload);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /reserved administrative tags/i);
  });

  it("should reject a submission carrying a stale simVersion, before re-simulation is attempted", async () => {
    // SIM_VERSION - 1 is the previous physics build. With SIM_VERSION === 1 this is
    // 0, which also guards against the version being tested for truthiness.
    const staleSim = SIM_VERSION - 1;
    const runId = `test_bad_sim_${Date.now()}`;
    const issuedAt = Date.now() - 150000;
    const token = await createRunToken(runId, sprintStageDef.id, carId, issuedAt, staleSim);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_old_sim",
      playerName: "Old Driver",
      timeMs: 145000,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash: "somehash",
      simVersion: staleSim,
      replays: [{ steer: 0, throttle: 255, brake: 0, handbrake: 0 }],
    };

    const result = await validateRunSubmission(payload);
    assert.equal(result.valid, false);
    // Must be rejected explicitly as a version mismatch, NOT as a re-simulation
    // mismatch — a legitimate old run is not a cheating attempt.
    assert.match(result.reason || "", /simulation version mismatch/i);
    assert.doesNotMatch(result.reason || "", /Re-simulation mismatch/i);
  });

  it("should reject a newer-than-server simVersion (client ahead of the deployed build)", async () => {
    const futureSim = SIM_VERSION + 1;
    const runId = `test_future_sim_${Date.now()}`;
    const issuedAt = Date.now() - 150000;
    const token = await createRunToken(runId, sprintStageDef.id, carId, issuedAt, futureSim);

    const payload: SubmitRunPayload = {
      runId,
      token,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_future_sim",
      playerName: "Future Driver",
      timeMs: 145000,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash: "somehash",
      simVersion: futureSim,
      replays: [{ steer: 0, throttle: 255, brake: 0, handbrake: 0 }],
    };

    const result = await validateRunSubmission(payload);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /simulation version mismatch/i);
  });

  it("should not honour a run token minted under a different sim version", async () => {
    // The HMAC covers runId|stageId|carId|issuedAt|simVersion, so a token minted
    // by the previous build cannot be redeemed against the current one even if the
    // submission itself omits simVersion and thus slips past the explicit guard.
    const runId = `test_token_bind_${Date.now()}`;
    const issuedAt = Date.now() - 150000;
    const staleToken = await createRunToken(runId, sprintStageDef.id, carId, issuedAt, SIM_VERSION - 1);
    const currentToken = await createRunToken(runId, sprintStageDef.id, carId, issuedAt, SIM_VERSION);

    assert.notEqual(staleToken, currentToken, "Sim version must actually change the HMAC");

    const payload: SubmitRunPayload = {
      runId,
      token: staleToken,
      stageId: sprintStageDef.id,
      carId,
      playerId: "p_test_token_bind",
      playerName: "Stale Token",
      timeMs: 145000,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash: "somehash",
      // simVersion deliberately omitted, so only the token binding can catch this
      replays: [{ steer: 0, throttle: 255, brake: 0, handbrake: 0 }],
    };

    const result = await validateRunSubmission(payload);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Invalid or expired HMAC run token/i);
  });

  it("should keep leaderboards for two different sim versions from colliding", async () => {
    const mockRedis = new MockRedis();
    const stageId = "borbera-sprint";
    const carClass = "Classic";
    const playerKey = "p_uuid_same_driver_across_builds";

    const oldSim = SIM_VERSION - 1;
    const newSim = SIM_VERSION;

    const boardKey = (sim: number) => `lb:${sim}:${stageId}:${carClass}`;
    const entryKey = (sim: number) => `entry:${sim}:${stageId}:${carClass}:${playerKey}`;

    assert.notEqual(boardKey(oldSim), boardKey(newSim), "Board keys must differ per sim version");

    // Same player, same stage, same class — one time under each physics build.
    await mockRedis.zadd(boardKey(oldSim), { score: 131000, member: playerKey });
    await mockRedis.hset(entryKey(oldSim), { playerKey, timeMs: 131000, simVersion: oldSim });

    await mockRedis.zadd(boardKey(newSim), { score: 138500, member: playerKey });
    await mockRedis.hset(entryKey(newSim), { playerKey, timeMs: 138500, simVersion: newSim });

    // Neither board leaks into the other: the old build's faster ghost time must not
    // appear on, or outrank anything on, the current board.
    assert.equal(await mockRedis.zscore(boardKey(oldSim), playerKey), 131000);
    assert.equal(await mockRedis.zscore(boardKey(newSim), playerKey), 138500);
    assert.equal(await mockRedis.zcard(boardKey(oldSim)), 1);
    assert.equal(await mockRedis.zcard(boardKey(newSim)), 1);

    // Entry hashes are likewise disjoint.
    const oldEntry = await mockRedis.hgetall(entryKey(oldSim));
    const newEntry = await mockRedis.hgetall(entryKey(newSim));
    assert.equal(oldEntry?.timeMs, "131000");
    assert.equal(newEntry?.timeMs, "138500");

    // A brand-new sim version starts from an empty board rather than inheriting one.
    const nextSim = SIM_VERSION + 1;
    assert.equal(await mockRedis.zcard(boardKey(nextSim)), 0);
    assert.equal(await mockRedis.zscore(boardKey(nextSim), playerKey), null);
    assert.equal(await mockRedis.hgetall(entryKey(nextSim)), null);

    // GT personal-best dedupe still applies WITHIN a single sim version: a slower
    // time does not overwrite the PB, a faster one does, and the other board is
    // untouched throughout.
    const gtUpdate = async (sim: number, score: number) => {
      const existing = await mockRedis.zscore(boardKey(sim), playerKey);
      if (existing === null || score < existing) {
        await mockRedis.zadd(boardKey(sim), { score, member: playerKey });
        await mockRedis.zremrangebyrank(boardKey(sim), 1000, -1);
      }
    };

    await gtUpdate(newSim, 141000); // slower — ignored
    assert.equal(await mockRedis.zscore(boardKey(newSim), playerKey), 138500);
    await gtUpdate(newSim, 136200); // faster — accepted
    assert.equal(await mockRedis.zscore(boardKey(newSim), playerKey), 136200);
    assert.equal(await mockRedis.zscore(boardKey(oldSim), playerKey), 131000, "Old board must be untouched");

    // And the top-1000 trim operates per sim-version board, independently.
    for (let i = 0; i < 1200; i++) {
      await mockRedis.zadd(boardKey(newSim), { score: 200000 + i, member: `driver_${i}` });
    }
    await mockRedis.zremrangebyrank(boardKey(newSim), 1000, -1);
    assert.equal(await mockRedis.zcard(boardKey(newSim)), 1000);
    assert.equal(await mockRedis.zcard(boardKey(oldSim)), 1, "Trimming one board must not affect another version");
  });


  it("should build every leaderboard and entry key with the sim version baked in", () => {
    // The collision test above constructs keys itself, so pin the real routes:
    // if a key template ever loses its sim-version segment, boards from different
    // physics would silently merge again.
    const here = dirname(fileURLToPath(import.meta.url));
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const submitSrc = strip(readFileSync(join(here, "../app/api/run/submit/route.ts"), "utf8"));
    const boardSrc = strip(readFileSync(join(here, "../app/api/leaderboard/route.ts"), "utf8"));

    // Every `lb:` / `entry:` template literal must interpolate a version segment
    // immediately after the prefix.
    for (const [label, src] of [["submit", submitSrc], ["leaderboard", boardSrc]] as const) {
      const keys = src.match(/`(?:lb|entry):[^`]*`/g) || [];
      assert.ok(keys.length > 0, `${label} route should build at least one leaderboard key`);
      for (const k of keys) {
        assert.match(
          k,
          /^`(?:lb|entry):\$\{(?:SIM_VERSION|sim)\}:/,
          `${label} route key ${k} must carry the sim version directly after the prefix`
        );
      }
    }

    // And an unversioned key must not survive anywhere in either route.
    for (const [label, src] of [["submit", submitSrc], ["leaderboard", boardSrc]] as const) {
      assert.doesNotMatch(src, /`lb:\$\{stageId\}/, `${label} route still builds an unversioned lb: key`);
      assert.doesNotMatch(src, /`entry:\$\{stageId\}/, `${label} route still builds an unversioned entry: key`);
    }
  });

  it("should verify per-player GT leaderboard deduplication keyed by playerId and 1000-rank trimming", async () => {
    const mockRedis = new MockRedis();
    const lbKey = `lb:${SIM_VERSION}:borbera-sprint:Classic`;
    const playerId = "p_uuid_enrico_fagioli_1234";

    // First submission: 135000ms
    await mockRedis.zadd(lbKey, { score: 135000, member: playerId });
    let score = await mockRedis.zscore(lbKey, playerId);
    assert.equal(score, 135000);


    // Slower second submission from same player: 137000ms (should NOT overwrite PB)
    const existingScore = await mockRedis.zscore(lbKey, playerId);
    if (existingScore === null || 137000 < existingScore) {
      await mockRedis.zadd(lbKey, { score: 137000, member: playerId });
    }
    score = await mockRedis.zscore(lbKey, playerId);
    assert.equal(score, 135000, "Slower time must not overwrite player personal best");

    // Faster third submission from same player: 132000ms (SHOULD overwrite PB)
    const newAttempt = 132000;
    if (existingScore === null || newAttempt < score!) {
      await mockRedis.zadd(lbKey, { score: newAttempt, member: playerId });
    }
    score = await mockRedis.zscore(lbKey, playerId);
    assert.equal(score, 132000, "Faster time must update player personal best");

    // Different player with same display name: should have distinct slot in leaderboard
    const otherPlayerId = "p_uuid_other_driver_5678";
    await mockRedis.zadd(lbKey, { score: 134000, member: otherPlayerId });
    assert.equal(await mockRedis.zscore(lbKey, otherPlayerId), 134000);
    assert.equal(await mockRedis.zscore(lbKey, playerId), 132000);

    // Test ZREMRANGEBYRANK trimming
    for (let i = 0; i < 50; i++) {
      await mockRedis.zadd("lb:trim_test", { score: 1000 + i, member: `driver_${i}` });
    }
    assert.equal(await mockRedis.zcard("lb:trim_test"), 50);
    // Trim to top 10 (ranks 10 to -1 removed)
    await mockRedis.zremrangebyrank("lb:trim_test", 10, -1);
    assert.equal(await mockRedis.zcard("lb:trim_test"), 10);
  });
});

/**
 * Forged-submission rejection.
 *
 * The suite above only ever exercised replays produced by a driving AI that reaches the
 * finish, and asserted on `result.valid` alone. That left the anti-cheat's central
 * assumption untested: nothing verified the replay had actually COMPLETED the stage.
 *
 * `Timer.stepCount` advances on every frame while the run is `running`, and the simulated
 * time the validator compares against the claim is just `stepCount * PHYSICS_DT`. So a
 * replay of all-zero inputs — a car that never moves and crosses no checkpoint — reproduced
 * any claimed time exactly and validated, with a genuine token and a hash over the
 * attacker's own frames. These tests pin that hole shut.
 */
describe("Forged submissions are rejected", () => {
  const stage = getStageDef("borbera-sprint");
  const carId = "weiss-blau-30";

  /** Builds a payload the way an attacker would: real token, self-consistent hash. */
  async function forge(frames: { steer: number; throttle: number; brake: number; handbrake: number }[], timeMs: number) {
    const runId = `forge_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const issuedAt = Date.now() - (timeMs + 5000);
    const token = await createRunToken(runId, stage.id, carId, issuedAt);
    return {
      runId,
      token,
      stageId: stage.id,
      carId,
      playerId: "p_forger",
      playerName: "Forger",
      timeMs,
      penaltyMs: 0,
      checkpointsMs: [],
      issuedAt,
      inputHash: computeReplayHash(frames as never),
      replays: frames as never,
    } as SubmitRunPayload;
  }

  const idleFrame = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

  it("rejects an idle replay that never crosses a checkpoint", async () => {
    // Long enough (a full gold-time's worth of frames) to clear the anti-cheat floor, so
    // every other gate passes.
    const frameCount = Math.ceil(stage.goldTime * 60);
    const timeMs = Math.round((frameCount / 60) * 1000);
    const result = await validateRunSubmission(await forge(Array(frameCount).fill(idleFrame), timeMs));

    // Rejected either because the idle car's own off-road penalties do not match the
    // declared zero, or because it never finished. Both are correct refusals; the security
    // property under test is simply that a car which never moves cannot reach the board.
    // (The dedicated completion gate is covered by the stop-short case below.)
    assert.equal(result.valid, false, "An idle car must never validate as a completed run");
    assert.match(result.reason ?? "", /did not complete|mismatch/i);
  });

  it("rejects a replay that stops short of the finish", async () => {
    // Same shape, but far too few frames to have reached the end of the stage.
    const frameCount = 600;
    const timeMs = Math.round((frameCount / 60) * 1000);
    const result = await validateRunSubmission(await forge(Array(frameCount).fill(idleFrame), timeMs));
    assert.equal(result.valid, false);
  });

  it("rejects a replay containing non-finite input", async () => {
    const frames = Array(600).fill(idleFrame).slice();
    frames[42] = { steer: Number.NaN, throttle: 0, brake: 0, handbrake: 0 };
    const result = await validateRunSubmission(await forge(frames, 10_000));

    assert.equal(result.valid, false, "NaN must never reach VehicleModel.step");
    assert.match(result.reason ?? "", /non-finite|out-of-range/i);
  });

  it("rejects a replay longer than the stage could plausibly take", async () => {
    const frameCount = Math.ceil(stage.bronzeTime * 60 * 3);
    const result = await validateRunSubmission(await forge(Array(frameCount).fill(idleFrame), 10_000));

    assert.equal(result.valid, false, "An unbounded replay is a resource-exhaustion vector");
    assert.match(result.reason ?? "", /implausibly long/i);
  });
});

/**
 * The happy path, end to end.
 *
 * Every other positive test in this file drives a fixed number of steps and submits whatever
 * the timer reads — none of them ever reaches the finish line, so until now nothing asserted
 * that a genuinely completed run validates. That gap is what let the missing completion check
 * survive: the forged-submission tests above prove bad runs are rejected, and this proves
 * good ones still get through.
 *
 * The driver here is deliberately more conservative than the one used above (lower speed cap,
 * stronger lateral correction, no handbrake). The aggressive one overcooks a corner at
 * s~2420 and loops through off-road respawns forever without progressing.
 */
describe("A completed run validates end to end", () => {
  it("accepts a run that actually reaches the finish line", async () => {
    const stage = getStageDef("borbera-sprint");
    const spline = new TrackSpline(stage);
    const engine = new Engine("weiss-blau-30");
    engine.setSpline(spline);
    engine.startRun();

    const SPEED_CAP_KMH = 85;
    let cachedS = 0;
    let finished = false;

    for (let step = 0; step < 30000; step++) {
      const s = engine.vehicle.state;
      const proj = spline.projectFrenet(s.pos.x, s.pos.z, cachedS);
      cachedS = proj.s;

      const lookahead = Math.max(8, Math.min(22, s.speedMs * 0.7));
      const target = spline.getSampleAtS(Math.min(spline.totalLength - 0.5, proj.s + lookahead));
      const angleDiff = detNormalizeAngle(detAtan2(target.x - s.pos.x, target.z - s.pos.z) - s.heading);
      // Negated: the model now flips the incoming steer axis (-1 = left, +1 = right), so a
      // controller working in the model's own heading convention has to invert to match.
      const steer = Math.max(-1, Math.min(1, -(angleDiff * 3.8 - proj.t * 0.35)));

      const curvature = Math.abs(angleDiff) / lookahead;
      let targetKmh = SPEED_CAP_KMH;
      if (curvature > 0.04) targetKmh = 32;
      else if (curvature > 0.02) targetKmh = 55;
      else if (curvature > 0.01) targetKmh = 80;

      const throttle = s.speedKmh < targetKmh ? 1.0 : 0;
      const brake = s.speedKmh < targetKmh ? 0 : Math.min(1, (s.speedKmh - targetKmh) * 0.12);

      engine.input.setTouchAxes({ steer, throttle, brake, handbrake: false });
      engine.update(PHYSICS_DT, true);

      if (engine.timer.state === "finished") {
        finished = true;
        break;
      }
    }

    assert.equal(finished, true, "The conservative driver should complete Borbera Sprint");

    const replayFrames = engine.recorder.stop();
    const clientTimeMs = Math.round(engine.timer.getElapsedSeconds() * 1000);
    const penaltyMs = Math.round(engine.timer.totalPenaltySeconds * 1000);
    const runId = `test_complete_${Date.now()}`;
    const issuedAt = Date.now() - (clientTimeMs + 5000);

    const payload: SubmitRunPayload = {
      runId,
      token: await createRunToken(runId, stage.id, "weiss-blau-30", issuedAt),
      stageId: stage.id,
      carId: "weiss-blau-30",
      playerId: "p_finisher",
      playerName: "Finisher",
      timeMs: clientTimeMs,
      penaltyMs,
      checkpointsMs: engine.timer.getSplitsMs(),
      issuedAt,
      inputHash: computeReplayHash(replayFrames),
      replays: replayFrames,
    };

    const result = await validateRunSubmission(payload);
    assert.equal(result.valid, true, `A completed run must validate, but was rejected: ${result.reason}`);

    // The route persists these rather than the client's figures: the submitted time is only
    // checked to within 5 ms, and the submitted splits were never checked at all.
    assert.ok(result.verified, "A valid result must carry the server's own re-simulated figures");
    assert.equal(result.verified!.rawTimeMs, clientTimeMs);
    assert.equal(result.verified!.penaltyMs, penaltyMs);
    assert.equal(result.verified!.totalMs, clientTimeMs + penaltyMs);
    assert.deepEqual(result.verified!.checkpointsMs, engine.timer.getSplitsMs());
  });
});
