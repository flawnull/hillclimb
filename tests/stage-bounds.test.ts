/**
 * VAL BORBERA HILLCLIMB — Stage Boundary Suite
 *
 * The corridor's containment was, twice over, not what it looked like.
 *
 * First it was gated on `timer.state === 'running'`, so on the start line and again after
 * the finish the road simply had no edges. That was real, and is fixed.
 *
 * But it was not how a player actually leaves. `projectFrenet` reports `t` as the LATERAL
 * offset and clamps `s` to [0, totalLength], so a car reversing straight back from the start
 * keeps t ~ 0 and s pinned at 0: it is a hundred metres outside the world while every
 * containment check reads "dead centre on the road". The corridor had no LONGITUDINAL bound
 * at all, and the previous fix -- verified only by unit-testing the wall impulse, never by
 * driving -- could not have caught it.
 *
 * These tests drive the actual Engine.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Engine } from "../src/game/Engine";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { getStageDef, STAGE_LIST } from "../src/game/track/stages";

const FRAME = 1 / 60;

/** How far outside the timed stage a car is allowed to get, in metres. */
const ALLOWED_OVERSHOOT = 20;

describe("Stage bounds", () => {
  for (const entry of STAGE_LIST) {
    it(`${entry.id}: reversing off the start line cannot leave the world`, () => {
      const engine = new Engine("weiss-blau-30");
      const spline = new TrackSpline(getStageDef(entry.id));
      engine.setSpline(spline);
      // THE RUN HAS TO BE STARTED or this test proves nothing: `stepPhysics` returns before
      // any boundary code for every timer state except 'running', so an unstarted engine
      // simply never simulates and the car only moves because the loop below steps the
      // vehicle by hand.
      engine.startRun();

      // Drive ONLY through the engine. Stepping `engine.vehicle` by hand alongside
      // `engine.update` proves nothing: the engine's own step runs with whatever input it
      // reads and immediately cancels the hand-applied motion, so the car never moves and
      // the test passes without exercising anything. `setTouchAxes` with brake and no
      // throttle is the reverse control.
      engine.input.setTouchAxes({ throttle: 0, brake: 1 });

      let worst = 0;
      for (let i = 0; i < 60 * 30; i++) {
        engine.update(FRAME);
        const p = spline.projectFrenet(engine.vehicle.state.pos.x, engine.vehicle.state.pos.z);
        // How far beyond either end, measured ALONG the road rather than across it.
        worst = Math.max(worst, -p.sUnclamped, p.sUnclamped - spline.totalLength);
      }

      assert.ok(
        worst <= ALLOWED_OVERSHOOT,
        `${entry.id}: the car reached ${worst.toFixed(1)} m beyond the end of the stage ` +
          `(limit ${ALLOWED_OVERSHOOT} m). The corridor needs a longitudinal bound — the ` +
          `lateral wall cannot see this, because reversing straight back keeps t at zero.`
      );
    });
  }

  it("projectFrenet reports how far past an end a point is, not just a clamped s", () => {
    const spline = new TrackSpline(getStageDef(STAGE_LIST[0].id));
    const start = spline.getSampleAtS(0);
    // 50 m back along the start tangent.
    const len = Math.hypot(start.tangentX, start.tangentZ) || 1;
    const behind = spline.projectFrenet(
      start.x - (start.tangentX / len) * 50,
      start.z - (start.tangentZ / len) * 50
    );

    assert.equal(behind.s, 0, "s is still clamped to the stage");
    assert.ok(
      behind.sUnclamped < -40,
      `a point 50 m behind the start should report sUnclamped near -50, got ${behind.sUnclamped.toFixed(1)}`
    );
    assert.ok(
      Math.abs(behind.t) < 2,
      `and its LATERAL offset should be ~0 — which is exactly why the wall never fired ` +
        `(got t = ${behind.t.toFixed(2)})`
    );
  });
});
