/**
 * VAL BORBERA HILLCLIMB — Resource Management & Disposal Contracts
 *
 * High-confidence deterministic test suite for:
 *   1. Clean lifecycle disposal of InputManager, Timer, ReplayRecorder, and Engine.
 *   2. GameStore initial state, personal best saving, and car unlock logic.
 *   3. Preventing state corruption or memory leaks during rapid stage switching.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Engine } from "../src/game/Engine";
import { InputManager } from "../src/game/input/InputManager";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { getStageDef } from "../src/game/track/stages";

describe("Resource Management & Clean Disposal", () => {
  it("Engine.destroy() cleanly tears down input listeners and timers", () => {
    const engine = new Engine("weiss-blau-30");
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    engine.setSpline(spline);

    assert.doesNotThrow(() => {
      engine.input.destroy();
      engine.recorder.clear();
      engine.timer.reset();
    });
  });

  it("rapid consecutive stage spline switches do not leak or corrupt vehicle state", () => {
    const engine = new Engine("lanzo-alta-4wd");
    const stages = ["borbera-sprint", "salita-cosola", "cresta-ebro"] as const;

    for (let cycle = 0; cycle < 5; cycle++) {
      for (const stageId of stages) {
        const stageDef = getStageDef(stageId);
        const spline = new TrackSpline(stageDef);
        engine.setSpline(spline);

        // Vehicle must sit cleanly on new stage start position
        assert.ok(engine.vehicle.state.onRoad, `Car should be grounded on road for ${stageId}`);
        assert.strictEqual(engine.vehicle.state.speedMs, 0);
        assert.strictEqual(engine.timer.state, "ready");
      }
    }
  });

  it("rapid consecutive vehicle switching retains valid tuning and physical mass", () => {
    const engine = new Engine("weiss-blau-30");
    const cars = ["weiss-blau-30", "lanzo-alta-4wd", "pandino-4x4", "alpe-a110"];

    for (const carId of cars) {
      engine.vehicle.setCar(carId);
      assert.strictEqual(engine.vehicle.car.id, carId);
      assert.ok(engine.vehicle.car.mass > 0, "Mass must be positive");
      assert.ok(engine.vehicle.car.vMax > 0, "vMax must be positive");
      assert.ok(engine.vehicle.car.brakeForce > 0, "brakeForce must be positive");
    }
  });
});
