/**
 * VAL BORBERA HILLCLIMB — What happens after the line
 *
 * Reported from a finished run: "the car starts going back and forth on the spot pretty
 * fast but doesn't move much". It was not the physics. Physics STOPPED at the finish —
 * `stepPhysics` returned early for any state that is not `running` — which left the
 * vehicle's `prevPos` permanently one step behind `pos` while the render accumulator kept
 * cycling alpha from 0 to 1 every frame. `getInterpolatedState` therefore slid back and
 * forth across the last physics step, about 0.6 m at racing speed, at frame rate. The
 * speedometer showed 133 km/h on a car that was not moving, because nothing was updating it.
 *
 * The car now coasts to a halt, which fixes the readouts as a consequence and is what
 * actually happens at the end of a run.
 *
 * This cannot affect the leaderboard, and that is worth stating precisely rather than
 * assuming: the replay recorder stops on the finish frame, and the server's re-simulation
 * (src/lib/validate.ts) drives VehicleModel and Timer directly and never constructs an
 * Engine at all. Nothing below runs on the verification path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Engine } from "../src/game/Engine";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { getStageDef } from "../src/game/track/stages";
import { PHYSICS_DT } from "../src/game/vehicle/vehicleTuning";

/**
 * Brings the engine to a finished run with the car moving.
 *
 * The finish line is moved to 120 m rather than a stage being driven end to end. Two earlier
 * attempts did it the other way and both were worse than useless: full throttle in a straight
 * line went off the road in seconds, and a lookahead driver still collected ten to twenty
 * off-road respawns and never reached the line inside ten minutes of simulated time — so the
 * tests returned early and asserted nothing while reporting green.
 *
 * What is under test here is what happens AFTER `timer.state` becomes `finished`, and that is
 * reached just as truthfully by a short course as by a long one. Completing a real stage is
 * the finish-flow browser test's job, and it does it in a real browser.
 */
function finishedRun(): Engine {
  const engine = new Engine("weiss-blau-30");
  const spline = new TrackSpline(getStageDef("borbera-sprint"));
  engine.setSpline(spline);
  // Borbera Sprint opens with a straight, so full throttle crosses this cleanly.
  engine.timer.setCheckpoints([120]);
  engine.timer.start();

  engine.input.setTouchAxes({ steer: 0, throttle: 1, brake: 0, handbrake: false });
  for (let i = 0; i < 60 * 60 && engine.timer.state !== "finished"; i++) {
    engine.update(PHYSICS_DT);
  }
  return engine;
}

describe("The car comes to rest after the finish", () => {
  it("stops instead of twitching on the spot", () => {
    const engine = finishedRun();
    assert.strictEqual(
      engine.timer.state,
      "finished",
      "the driver did not complete the stage, so this test would assert nothing"
    );

    const speedAtLine = engine.vehicle.state.speedKmh;
    assert.ok(speedAtLine > 5, `expected to cross the line moving, got ${speedAtLine.toFixed(1)} km/h`);

    // Ten seconds of frames after the finish with the throttle still held down — a player's
    // hand does not leave the key just because the timer stopped.
    engine.input.setTouchAxes({ steer: 0.4, throttle: 1, brake: 0, handbrake: false });

    // JITTERED frame deltas, not a fixed timestep. The oscillation is a rendering artefact
    // of the interpolation alpha, and feeding exactly PHYSICS_DT every frame makes the
    // accumulator land on zero every time, so alpha is always 0 and the defect is invisible.
    // A browser never does that. This is what caught it.
    let seed = 12345;
    const frame = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return 0.0167 + (seed / 4294967296) * 0.008;
    };

    const positions: { x: number; z: number }[] = [];
    for (let i = 0; i < 600; i++) {
      const s = engine.update(frame());
      positions.push({ x: s.pos.x, z: s.pos.z });
    }

    // The REPORTED symptom first: the rendered car sliding on the spot. Measured against the
    // old behaviour this is 8.64 m of travel in the last second on a car that is not moving;
    // with the coast-down it is 0.00. Asserting it before the speed matters, because the
    // speed assertion below would otherwise throw first and this one would never run — which
    // is exactly what happened the first time and left it looking like a passing check.
    const tail = positions.slice(-60);
    let wobble = 0;
    for (let i = 1; i < tail.length; i++) {
      wobble += Math.hypot(tail[i].x - tail[i - 1].x, tail[i].z - tail[i - 1].z);
    }
    assert.ok(
      wobble < 0.05,
      `the rendered car moved ${wobble.toFixed(2)} m over the last second while stationary — ` +
        `this is the reported back-and-forth`
    );

    const finalSpeed = engine.vehicle.state.speedKmh;
    assert.ok(
      finalSpeed < 1.0,
      `car still doing ${finalSpeed.toFixed(1)} km/h ten seconds after the line — it should have ` +
        `rolled to a stop, and the speedometer should not be showing a stale reading`
    );
  });

  it("does not keep counting time or hairpins after the line", () => {
    const engine = finishedRun();
    assert.strictEqual(engine.timer.state, "finished");

    const timeAtLine = engine.timer.getTotalTimeSeconds();
    const hairpinsAtLine = engine.update(PHYSICS_DT).currentHairpin;
    for (let i = 0; i < 300; i++) engine.update(PHYSICS_DT);

    assert.strictEqual(
      engine.timer.getTotalTimeSeconds(),
      timeAtLine,
      "the clock kept running after the finish"
    );
    assert.strictEqual(engine.update(PHYSICS_DT).currentHairpin, hairpinsAtLine);
    assert.strictEqual(engine.timer.state, "finished");
  });
});
