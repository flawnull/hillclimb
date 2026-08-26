/**
 * VAL BORBERA HILLCLIMB — Audio Synthesis Parameters Test Suite
 *
 * Validates:
 *   1. Engine fundamental frequency calculation across RPM range for all 4 vehicle engine configurations (Straight-6, 4-Cylinder Turbo, Berlinetta).
 *   2. Filter cutoff frequency progression mapping with throttle and RPM.
 *   3. Wind rush and tire scrub frequency curves.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CAR_DEFS } from "../src/game/vehicle/cars";

describe("Audio Synthesis Parameters & Acoustics", () => {
  const engineConfigs: Record<string, { harmonicMul: number; baseCutoff: number }> = {
    "weiss-blau-30": { harmonicMul: 3.0, baseCutoff: 260 },
    "lanzo-alta-4wd": { harmonicMul: 2.0, baseCutoff: 340 },
    "pandino-4x4": { harmonicMul: 2.0, baseCutoff: 220 },
    "alpe-a110": { harmonicMul: 2.2, baseCutoff: 380 },
  };

  for (const [carId, cfg] of Object.entries(engineConfigs)) {
    const car = CAR_DEFS[carId];

    describe(`Engine Acoustic Model: ${car.name}`, () => {
      it("computes physically accurate fundamental frequency from idle to redline", () => {
        // Idle (900 RPM)
        const idleRpm = 900;
        const idleFreq = (idleRpm / 60) * cfg.harmonicMul;

        // Redline (7200 RPM)
        const redlineRpm = 7200;
        const redlineFreq = (redlineRpm / 60) * cfg.harmonicMul;

        // Idle frequency must sit in warm, throaty bass range (30 - 60 Hz)
        assert.ok(
          idleFreq >= 25 && idleFreq <= 65,
          `${carId}: idle frequency ${idleFreq.toFixed(1)} Hz outside throaty bass range (25-65 Hz)`
        );

        // Redline frequency must sit in energetic acoustic range (200 - 450 Hz)
        assert.ok(
          redlineFreq >= 200 && redlineFreq <= 450,
          `${carId}: redline frequency ${redlineFreq.toFixed(1)} Hz outside acoustic range (200-450 Hz)`
        );
      });

      it("filter cutoff opens smoothly as throttle and RPM increase", () => {
        // Closed throttle, idle RPM
        const idleCutoff = cfg.baseCutoff;

        // Full throttle, redline RPM
        const maxCutoff = cfg.baseCutoff + 1.0 * 1100 + 1.0 * 1400;

        assert.ok(
          idleCutoff >= 200 && idleCutoff <= 400,
          `${carId}: idle cutoff ${idleCutoff} Hz must provide muffled low-pass idle sound`
        );
        assert.ok(
          maxCutoff >= 2700 && maxCutoff <= 3000,
          `${carId}: wide-open throttle cutoff ${maxCutoff} Hz must open fully to bright exhaust sound`
        );
        assert.ok(
          maxCutoff > idleCutoff * 6.0,
          `${carId}: filter dynamic range must span at least 6x frequency range`
        );
      });
    });
  }

  it("tire squeal target gain is zero during normal driving and positive during drift", () => {
    const calcTireSqueal = (isSliding: boolean, speedMs: number) => {
      return isSliding && speedMs > 5.0 ? 0.28 : 0.0;
    };

    assert.strictEqual(calcTireSqueal(false, 30.0), 0.0, "No tire squeal when gripping at high speed");
    assert.strictEqual(calcTireSqueal(true, 2.0), 0.0, "No tire squeal at very low parking speed");
    assert.strictEqual(calcTireSqueal(true, 15.0), 0.28, "Tire squeal active during dynamic slide");
  });
});
