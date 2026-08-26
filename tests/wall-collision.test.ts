/**
 * VAL BORBERA HILLCLIMB — Wall Contact Regression Suite
 *
 * The wall-collision rule was level-triggered: `timer.addPenalty('wall', 2.0)` ran on
 * EVERY physics step the car spent past the road edge. At 60 Hz that is 120 seconds of
 * penalty per second of contact — a 0.7 s brush against the rock face cost 84 s. And
 * `applyWallCollision` only applied an impulse; it never moved the car back, so the wall
 * did not actually contain anything. The car coasted on into the field and stopped there,
 * off the road, with the run destroyed.
 *
 * These tests pin both halves: charged once per contact, and genuinely solid.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VehicleModel } from "../src/game/vehicle/VehicleModel";
import { PHYSICS_DT, WALL_PENALTY_COOLDOWN_STEPS } from "../src/game/vehicle/vehicleTuning";
import type { GroundQuery } from "../src/game/vehicle/VehicleModel";

const FLAT_GROUND: GroundQuery = {
  groundY: 560,
  roadPitch: 0,
  roadBank: 0,
  surface: "asphalt",
  onRoad: true,
  baseAltitude: 560,
};

function driveStep(v: VehicleModel, throttle = 1) {
  v.step(PHYSICS_DT, { steer: 0, throttle, brake: 0, handbrake: false, reverse: false }, FLAT_GROUND, true);
}

describe("Wall contact", () => {
  it("charges a penalty on entering contact, not on every step held against it", () => {
    const v = new VehicleModel("weiss-blau-30");
    v.reset({ x: 0, y: 560, z: 0 }, 0, 560);

    let charged = 0;
    // Hold the car against the wall for a full second of physics.
    for (let i = 0; i < 60; i++) {
      if (v.applyWallCollision(-1, 0, 0, 0)) charged++;
      driveStep(v);
    }

    // 60 steps at a 45-step cooldown => entry plus at most one re-trigger.
    assert.ok(
      charged <= 2,
      `wall penalty charged ${charged} times in 1 s of contact; level-triggered code charged 60`
    );
    assert.ok(charged >= 1, "entering contact must charge exactly one penalty");
  });

  it("re-charges only after the cooldown elapses", () => {
    const v = new VehicleModel("weiss-blau-30");
    v.reset({ x: 0, y: 560, z: 0 }, 0, 560);

    assert.equal(v.applyWallCollision(-1, 0, 0, 0), true, "first contact should charge");
    assert.equal(v.applyWallCollision(-1, 0, 0, 0), false, "immediate re-contact must not charge");

    for (let i = 0; i < WALL_PENALTY_COOLDOWN_STEPS; i++) driveStep(v, 0);

    assert.equal(v.applyWallCollision(-1, 0, 0, 0), true, "should charge again once the cooldown expires");
  });

  it("clamps the car back to the road edge so the wall is solid", () => {
    const v = new VehicleModel("weiss-blau-30");
    v.reset({ x: 0, y: 560, z: 0 }, 0, 560);

    // Car is 3 m beyond a wall whose edge lies at x = 4; correction pulls it back.
    v.state.pos.x = 7;
    const correction = -3;
    v.applyWallCollision(-1, 0, correction, 0);

    assert.equal(v.state.pos.x, 4, "position must be corrected onto the wall limit");
  });

  it("bleeds speed on impact rather than letting the car carry through", () => {
    const v = new VehicleModel("weiss-blau-30");
    v.reset({ x: 0, y: 560, z: 0 }, 0, 560);
    v.state.vel.x = 30;
    v.state.vel.z = 0;

    v.applyWallCollision(-1, 0, 0, 0);

    assert.ok(v.state.vel.x < 30 * 0.6, `expected a large speed loss, got vx=${v.state.vel.x}`);
    assert.equal(v.state.cleanRun, false, "a wall hit must end the clean-run bonus");
  });
});
