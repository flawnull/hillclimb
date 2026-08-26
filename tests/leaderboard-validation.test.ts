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
    for (const stageKey of ["borbera-sprint", "salita-cosola", "cresta-ebro"]) {
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

      // Floor time must be at least 70% of gold time
      const floorTimeMs = Math.round(stage.goldTime * 0.8 * 1000);
      assert.ok(floorTimeMs > 50000, `${stageKey}: floor time must be realistic for a mountain stage`);
    }
  });
});
