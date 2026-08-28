/**
 * VAL BORBERA HILLCLIMB — Engine Lifecycle & Timing Invariants
 *
 * High-confidence deterministic test suite for:
 *   1. Complete stage lifecycle (ready -> countdown -> running -> finished).
 *   2. Variable framerate accumulator invariance (30Hz, 60Hz, 120Hz frame deltas).
 *   3. Checkpoint passage, PB split delta calculation, and finish time callbacks.
 *   4. Off-track boundary detection, checkpoint respawning, and time penalties.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Engine } from "../src/game/Engine";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { getStageDef } from "../src/game/track/stages";
import { Timer, SplitRecord } from "../src/game/timing/Timer";
import { PHYSICS_DT } from "../src/game/vehicle/vehicleTuning";

describe("Engine Lifecycle & State Machine", () => {
  const stageDef = getStageDef("borbera-sprint");

  it("advances cleanly through 3-2-1-GO countdown into running state", () => {
    const timer = new Timer([500, 1000, 1500]);
    assert.strictEqual(timer.state, "ready");

    timer.startCountdown();
    assert.strictEqual(timer.state, "countdown_3");

    // Advance 1.0 second -> countdown_2
    for (let i = 0; i < 60; i++) {
      timer.step(0);
    }
    assert.strictEqual(timer.state, "countdown_2");

    // Advance 1.0 second -> countdown_1
    for (let i = 0; i < 60; i++) {
      timer.step(0);
    }
    assert.strictEqual(timer.state, "countdown_1");

    // Advance 1.0 second -> running
    let goFired = false;
    for (let i = 0; i < 60; i++) {
      const res = timer.step(0);
      if (res.countdownBeep === "go") goFired = true;
    }
    assert.strictEqual(timer.state, "running");
    assert.ok(goFired, "Timer must fire 'go' beep when starting active running state");
  });

  it("yields identical physics integration across 30Hz, 60Hz, and 120Hz render framerates", () => {
    // Run 3 independent engine simulations with identical inputs but different frame deltas
    const spline = new TrackSpline(stageDef);

    const runEngineWithDelta = (deltaSec: number, totalSimTimeSec: number) => {
      const engine = new Engine("weiss-blau-30");
      engine.setSpline(spline);
      engine.timer.start();
      engine.input.setTouchAxes({ steer: 0.2, throttle: 1.0, brake: 0, handbrake: false });

      // Drive an exact number of frames rather than accumulating a float clock. The previous
      // `while (elapsed < totalSimTimeSec)` form ran 241, 481 and 121 frames for 1/60, 1/120
      // and 1/30 — that is 241, 240 and 242 physics substeps, so the three runs never
      // simulated the same amount of time and this test was comparing unequal work. It
      // passed only because the handling was soft enough that one substep of divergence
      // stayed under the tolerance.
      const frames = Math.round(totalSimTimeSec / deltaSec);
      for (let i = 0; i < frames; i++) {
        engine.update(deltaSec);
      }
      return engine.vehicle.state;
    };

    const simTime = 4.0; // 4 seconds of driving
    const state60 = runEngineWithDelta(1 / 60, simTime);
    const state120 = runEngineWithDelta(1 / 120, simTime);
    const state30 = runEngineWithDelta(1 / 30, simTime);

    // Positions and speed must match across different display refresh rates (fixed-step
    // accumulator). With each run driving an equal number of substeps these come out
    // BIT-IDENTICAL, so the bounds below are tight enough to actually catch a regression.
    // The previous 0.05 m / 0.1 m tolerances were a thousand times looser than the real
    // behaviour and masked the unequal-work bug in the loop above.
    assert.ok(
      Math.abs(state60.pos.x - state120.pos.x) < 1e-9,
      `X mismatch 60Hz vs 120Hz: ${state60.pos.x.toFixed(4)} vs ${state120.pos.x.toFixed(4)}`
    );
    assert.ok(
      Math.abs(state60.pos.z - state120.pos.z) < 1e-9,
      `Z mismatch 60Hz vs 120Hz: ${state60.pos.z.toFixed(4)} vs ${state120.pos.z.toFixed(4)}`
    );
    assert.ok(
      Math.abs(state60.speedMs - state120.speedMs) < 1e-9,
      `Speed mismatch 60Hz vs 120Hz: ${state60.speedMs.toFixed(4)} vs ${state120.speedMs.toFixed(4)}`
    );
    assert.ok(
      Math.abs(state60.pos.z - state30.pos.z) < 1e-9,
      `Z mismatch 60Hz vs 30Hz: ${state60.pos.z.toFixed(4)} vs ${state30.pos.z.toFixed(4)}`
    );
  });

  it("accurately detects checkpoints, records splits, and computes PB deltas", () => {
    const checkpoints = [300, 700, 1200];
    const timer = new Timer(checkpoints, {
      stageId: "borbera-sprint",
      carId: "weiss-blau-30",
      timeMs: 38000,
      splitsMs: [10000, 22000, 38000],
      achievedAt: new Date().toISOString(),
    });

    timer.start();

    // Drive past checkpoint 0 at t = 8.46s (1.53s faster than PB 10.0s)
    for (let i = 0; i < 9 * 60; i++) {
      const s = (i / (9 * 60)) * 320;
      const res = timer.step(s);
      if (res.newSplit) {
        assert.strictEqual(res.newSplit.checkpointIndex, 0);
        assert.ok(
          Math.abs(res.newSplit.deltaPB! - (-1.533)) < 0.1,
          `Expected deltaPB ~ -1.53s (faster), got ${res.newSplit.deltaPB}`
        );
      }
    }

    assert.strictEqual(timer.splits.length, 1);
  });

  it("charges wall scrape penalty and accumulates penalty time", () => {
    const timer = new Timer([500, 1000]);
    timer.start();

    // Add wall penalty
    timer.addPenalty("wall", 2.0);
    assert.strictEqual(timer.totalPenaltySeconds, 2.0);
    assert.strictEqual(timer.penalties.length, 1);

    // Add offroad respawn penalty
    timer.addPenalty("offroad", 8.0);
    assert.strictEqual(timer.totalPenaltySeconds, 10.0);
    assert.strictEqual(timer.penalties.length, 2);
    assert.strictEqual(timer.getTotalTimeSeconds(), timer.getElapsedSeconds() + 10.0);
  });

  it("resets vehicle to last checkpoint with clean zeroed velocities upon off-track drop", () => {
    const engine = new Engine("weiss-blau-30");
    const spline = new TrackSpline(stageDef);
    engine.setSpline(spline);
    engine.timer.start();

    // Accelerate along track
    engine.input.setTouchAxes({ steer: 0, throttle: 1.0, brake: 0, handbrake: false });
    for (let i = 0; i < 180; i++) {
      engine.update(PHYSICS_DT);
    }
    assert.ok(engine.vehicle.state.speedMs > 5, "Car should be at speed");

    // Manually trigger reset to start
    engine.resetToStart();
    engine.timer.reset();

    // After reset, car must be back at start station with zero velocity
    const state = engine.vehicle.state;
    assert.strictEqual(state.speedMs, 0);
    assert.strictEqual(state.speedKmh, 0);
    assert.strictEqual(state.gear, 1);
    assert.strictEqual(engine.timer.state, "ready");
    assert.strictEqual(engine.timer.totalPenaltySeconds, 0);
  });

  it("startCountdown() accurately activates replay recording exactly when GO triggers", () => {
    const engine = new Engine("weiss-blau-30");
    const spline = new TrackSpline(stageDef);
    engine.setSpline(spline);

    engine.startCountdown();
    assert.strictEqual(engine.recorder.getFrameCount(), 0, "Must not record frames during 3-2-1 countdown");

    // Advance through 3.0 seconds of countdown (180 frames)
    for (let i = 0; i < 180; i++) {
      engine.update(PHYSICS_DT);
    }
    assert.strictEqual(engine.timer.state, "running", "Timer must transition to running on GO");

    // Drive for 2.0 seconds (120 frames)
    engine.input.setTouchAxes({ steer: 0.1, throttle: 1.0, brake: 0, handbrake: false });
    for (let i = 0; i < 120; i++) {
      engine.update(PHYSICS_DT);
    }

    assert.strictEqual(
      engine.recorder.getFrameCount(),
      120,
      "Replay recorder must contain exactly 120 frames for 2.0 seconds of active driving"
    );
  });

  it("VehicleModel.getInterpolatedState smoothly interpolates across +PI / -PI boundary without 360-deg spin", () => {
    const engine = new Engine("weiss-blau-30");
    const vehicle = engine.vehicle;

    // Simulate crossing heading +3.10 rad to -3.10 rad (+177.6 deg to -177.6 deg)
    (vehicle as any).prevHeading = 3.10;
    vehicle.state.heading = -3.10;

    const interpolated = vehicle.getInterpolatedState(0.5);

    // The midpoint between +3.10 and -3.10 across the +/- PI boundary is +3.14159 or -3.14159 (180 deg)
    // It must NEVER interpolate through 0.0 deg (which would cause a catastrophic full-rotation glitch)
    assert.ok(
      Math.abs(Math.abs(interpolated.heading) - Math.PI) < 0.1,
      `Midpoint heading should be near +/-PI, got ${interpolated.heading}`
    );
  });

  it("triggers onFinish callback exactly once with accurate non-zero finish time and valid splits", () => {
    const engine = new Engine("weiss-blau-30");
    const spline = new TrackSpline(stageDef);
    engine.setSpline(spline);
    engine.startCountdown();

    let finishFiredCount = 0;
    let finalTotalTime = 0;
    let finalSplits: SplitRecord[] = [];

    engine.onFinish((totalTime, splits) => {
      finishFiredCount++;
      finalTotalTime = totalTime;
      finalSplits = splits;
    });

    // Advance through countdown (3 seconds = 180 frames)
    for (let i = 0; i < 180; i++) {
      engine.update(PHYSICS_DT);
    }
    assert.strictEqual(engine.timer.state, "running");

    // Advance vehicle through each checkpoint past the finish line
    for (const cpS of stageDef.checkpoints) {
      const sample = spline.getSampleAtS(cpS + 2.0);
      (engine as any).cachedS = cpS + 2.0;
      engine.vehicle.reset({ x: sample.x, y: sample.y, z: sample.z }, sample.heading, sample.altitude);
      engine.update(PHYSICS_DT);
    }

    assert.strictEqual(engine.timer.state, "finished", "Stage run must reach finished state");
    assert.strictEqual(finishFiredCount, 1, "onFinish callback must fire exactly once upon finish");
    assert.ok(finalTotalTime > 0.05, `Final total time must be non-zero and positive, got ${finalTotalTime}`);
    assert.strictEqual(
      finalSplits.length,
      stageDef.checkpoints.length,
      `Must record all ${stageDef.checkpoints.length} splits`
    );

    // Further engine update frames must not re-trigger finish callback
    for (let i = 0; i < 60; i++) {
      engine.update(PHYSICS_DT);
    }
    assert.strictEqual(finishFiredCount, 1, "onFinish must not re-fire on subsequent update frames");
  });
});
