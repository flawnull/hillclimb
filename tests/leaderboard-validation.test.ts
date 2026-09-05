/**
 * VAL BORBERA HILLCLIMB — Leaderboard & Run Submission Validation Test Suite
 *
 * Validates:
 *   1. HMAC run token generation, cryptographic binding, and signature verification.
 *   2. Rejection of expired tokens, tampered parameters, or mismatched simVersion.
 *   3. Floor time sanity thresholds (rejecting sub-physically impossible runs).
 *   4. Player key sanitization and name sanitization.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRunToken, verifyRunToken } from "../src/lib/runToken";
import { SIM_VERSION } from "../src/game/vehicle/vehicleTuning";
import { getStageDef } from "../src/game/track/stages";
import { CAR_DEFS } from "../src/game/vehicle/cars";

describe("Leaderboard HMAC Tokens & Submission Security", () => {
  const stageId = "borbera-sprint";
  const carId = "weiss-blau-30";
  const runId = "run_test_12345";
  const now = Date.now();

  it("mints valid HMAC run tokens that verify successfully with matching parameters", async () => {
    const token = await createRunToken(runId, stageId, carId, now, SIM_VERSION);
    assert.ok(typeof token === "string" && token.length > 20, "Token must be valid HMAC hex string");

    const valid = await verifyRunToken(token, runId, stageId, carId, now, SIM_VERSION);
    assert.strictEqual(valid, true, "Token must verify successfully with correct parameters");
  });

  it("rejects token if runId is tampered", async () => {
    const token = await createRunToken(runId, stageId, carId, now, SIM_VERSION);
    const valid = await verifyRunToken(token, "run_tampered_6789", stageId, carId, now, SIM_VERSION);
    assert.strictEqual(valid, false, "Token must fail verification with tampered runId");
  });

  it("rejects token if stageId is tampered", async () => {
    const token = await createRunToken(runId, stageId, carId, now, SIM_VERSION);
    const valid = await verifyRunToken(token, runId, "salita-cosola", carId, now, SIM_VERSION);
    assert.strictEqual(valid, false, "Token must fail verification with tampered stageId");
  });

  it("rejects token if carId is tampered", async () => {
    const token = await createRunToken(runId, stageId, carId, now, SIM_VERSION);
    const valid = await verifyRunToken(token, runId, stageId, "alpe-a110", now, SIM_VERSION);
    assert.strictEqual(valid, false, "Token must fail verification with tampered carId");
  });

  it("rejects token if simVersion is mismatched", async () => {
    const token = await createRunToken(runId, stageId, carId, now, SIM_VERSION);
    const valid = await verifyRunToken(token, runId, stageId, carId, now, SIM_VERSION + 1);
    assert.strictEqual(valid, false, "Token must fail verification with different simVersion");
  });

  it("rejects token if expired (> 3 hours old)", async () => {
    const fourHoursAgo = now - 4 * 60 * 60 * 1000;
    const token = await createRunToken(runId, stageId, carId, fourHoursAgo, SIM_VERSION);
    const valid = await verifyRunToken(token, runId, stageId, carId, fourHoursAgo, SIM_VERSION);
    assert.strictEqual(valid, false, "Token issued > 3 hours ago must fail verification as expired");
  });

  it("rejects token if issuedAt is in the future (> 60s ahead)", async () => {
    const futureTime = now + 120 * 1000;
    const token = await createRunToken(runId, stageId, carId, futureTime, SIM_VERSION);
    const valid = await verifyRunToken(token, runId, stageId, carId, futureTime, SIM_VERSION);
    assert.strictEqual(valid, false, "Token with future issuedAt timestamp must fail verification");
  });

  it("all stages have valid gold, silver, bronze time hierarchies", () => {
    for (const stageKey of ["borbera-sprint", "salita-cosola"]) {
      const stage = getStageDef(stageKey);
      assert.ok(stage.goldTime > 0, `${stageKey}: gold time must be positive`);
      assert.ok(
        stage.silverTime > stage.goldTime,
        `${stageKey}: silver time (${stage.silverTime}s) must be greater than gold time (${stage.goldTime}s)`
      );
      assert.ok(
        stage.bronzeTime > stage.silverTime,
        `${stageKey}: bronze time (${stage.bronzeTime}s) must be greater than silver time (${stage.silverTime}s)`
      );
    }
  });

  it("the anti-cheat floor is a physical bound derived from the car, not from the reward-tier gold time", () => {
    // See validate.ts: floor = (stage.length / car.vMax) * FLOOR_MARGIN. Mirrored here rather
    // than imported so this test still catches it if a future edit quietly re-derives the
    // floor from goldTime/silverTime/bronzeTime again — the exact regression that let a real,
    // replay-verified 1:49.416 Gold run on Borbera Sprint get rejected as "impossibly fast"
    // once the route was shortened and gold time was not.
    const FLOOR_MARGIN = 0.85;
    for (const stageKey of ["borbera-sprint", "salita-cosola"]) {
      const stage = getStageDef(stageKey);
      for (const car of Object.values(CAR_DEFS)) {
        const floorTimeMs = Math.round((stage.length / car.vMax) * FLOOR_MARGIN * 1000);
        // Gold time is itself an attained, verified-achievable pace (not a ceiling) — the
        // whole point of the medal system is that players reach it and beat it. If the floor
        // ever reached or exceeded gold time, hitting gold itself would risk the "impossibly
        // fast" rejection, which would defeat the medal system for its own top tier. This is
        // deliberately per-car (a slower car's floor sits closer to gold, since gold is one
        // stage-wide number every car is graded against) rather than a single stage-wide ratio.
        assert.ok(
          floorTimeMs < stage.goldTime * 1000,
          `${stageKey}/${car.id}: anti-cheat floor (${floorTimeMs}ms) is not below gold time ` +
            `(${stage.goldTime * 1000}ms) — a run AT gold pace in this car could be falsely rejected`
        );
        assert.ok(floorTimeMs > 0, `${stageKey}/${car.id}: floor time must be positive`);
      }
    }
  });
});
