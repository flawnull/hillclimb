/**
 * VAL BORBERA HILLCLIMB — Body Attitude Suite
 *
 * A car has two quite different tilts and they must not be added together.
 *
 * The ROAD's camber and gradient are the surface the tyres stand on, so the wheels follow
 * them. The BODY's lean on its suspension is the shell moving relative to those wheels, and
 * the wheels must not follow it at all — rotating them with it pivots the car about its
 * contact plane and drives the inside pair through the asphalt.
 *
 * `Engine` used to sum both into `renderState.roll`, which reads as one number and is two
 * things. Measured with the wheels' actual vertices at full lock, the inside pair sat 62-65 mm
 * below the contact plane while the outside pair floated 25-53 mm above it. A first attempt at
 * the fix moved only the renderer's own steering lean, on the strength of a comment claiming
 * `roll` was road attitude, and left the larger term — the yaw-rate lean — still turning the
 * wheels.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Engine } from "../src/game/Engine";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { getStageDef, STAGE_LIST } from "../src/game/track/stages";

const FRAME = 1 / 60;

describe("Body attitude", () => {
  it("reports the body's lean separately from the road's camber", () => {
    const engine = new Engine("weiss-blau-30");
    const spline = new TrackSpline(getStageDef(STAGE_LIST[0].id));
    engine.setSpline(spline);
    engine.startRun();

    // Straight ahead, no yaw: whatever roll there is belongs entirely to the road.
    const still = engine.update(FRAME);
    assert.ok(Math.abs(still.bodyRoll) < 1e-9, "a car that is not yawing has no body lean");
    const roadRoll = still.roll;

    // Now yaw it, as cornering does.
    engine.vehicle.state.yawRate = 1.5;
    const cornering = engine.update(FRAME);

    assert.ok(
      Math.abs(cornering.bodyRoll) > 0.01,
      `yawing at 1.5 rad/s should lean the body, got ${cornering.bodyRoll}`
    );
    assert.ok(
      Math.abs(cornering.roll - roadRoll) < 1e-6,
      `the body's lean leaked into \`roll\`, which the WHEELS follow: ${cornering.roll} vs ` +
        `${roadRoll} on the same piece of road. Rotating the wheels by a suspension lean puts ` +
        `the inside pair under the road surface.`
    );
  });

  it("body lean scales with yaw rate and reverses with it", () => {
    const engine = new Engine("weiss-blau-30");
    engine.setSpline(new TrackSpline(getStageDef(STAGE_LIST[0].id)));
    engine.startRun();

    engine.vehicle.state.yawRate = 1.0;
    const left = engine.update(FRAME).bodyRoll;
    engine.vehicle.state.yawRate = -1.0;
    const right = engine.update(FRAME).bodyRoll;
    engine.vehicle.state.yawRate = 2.0;
    const harder = engine.update(FRAME).bodyRoll;

    assert.ok(left * right < 0, "leaning should reverse with the direction of the turn");
    assert.ok(
      Math.abs(harder) > Math.abs(left),
      "a faster yaw should lean the body further"
    );
  });
});
