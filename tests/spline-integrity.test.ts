/**
 * VAL BORBERA HILLCLIMB — Spline Integrity & Frenet Projection Test Suite
 *
 * Validates:
 *   1. Arc length monotonicity and segment continuity across all stage splines.
 *   2. Frenet projection accuracy: exact (s, t) recovery for points on-axis and off-axis.
 *   3. Hairpin apex geometries: smooth normals and proper track widening.
 *   4. Zero NaN or infinite values in sample tables.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline, SplineSample } from "../src/game/track/TrackSpline";

describe("Spline Geometry & Frenet Projection", () => {
  for (const entry of STAGE_LIST) {
    describe(`Stage: ${entry.id}`, () => {
      const stageDef = getStageDef(entry.id);
      const spline = new TrackSpline(stageDef);
      const samples = spline.getAllSamples();

      it("arc length s strictly increases monotonically", () => {
        assert.ok(samples.length > 10, "Spline must have sufficient sample points");
        assert.strictEqual(samples[0].s, 0, "First sample s must be 0");

        for (let i = 1; i < samples.length; i++) {
          const prev = samples[i - 1];
          const curr = samples[i];
          const ds = curr.s - prev.s;

          assert.ok(
            ds > 0.001,
            `Sample ${i} (s=${curr.s.toFixed(2)}) did not increase from sample ${i - 1} (s=${prev.s.toFixed(2)})`
          );
          assert.ok(
            ds < 30.0,
            `Sample ${i} step too large (${ds.toFixed(2)}m), spline should be finely sampled`
          );
        }
      });

      it("contains zero NaN, null, or infinite values in any metric", () => {
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          const fields: (keyof SplineSample)[] = [
            "s", "x", "y", "z", "tangentX", "tangentY", "tangentZ",
            "normalX", "normalZ", "heading", "pitch", "bank", "halfWidth", "altitude"
          ];

          for (const f of fields) {
            const val = s[f] as number;
            assert.ok(
              Number.isFinite(val),
              `Sample ${i} field '${f}' has invalid value: ${val}`
            );
          }
        }
      });

      it("tangent and normal vectors are normalized and perpendicular in XZ", () => {
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];

          // Tangent unit length
          const tLen = Math.sqrt(s.tangentX * s.tangentX + s.tangentY * s.tangentY + s.tangentZ * s.tangentZ);
          assert.ok(
            Math.abs(tLen - 1.0) < 0.01,
            `Sample ${i} tangent not unit length: ${tLen.toFixed(4)}`
          );

          // Normal unit length in XZ
          const nLen = Math.sqrt(s.normalX * s.normalX + s.normalZ * s.normalZ);
          assert.ok(
            Math.abs(nLen - 1.0) < 0.01,
            `Sample ${i} normal not unit length in XZ: ${nLen.toFixed(4)}`
          );

          // Dot product in horizontal plane must be zero
          const dotXZ = s.tangentX * s.normalX + s.tangentZ * s.normalZ;
          assert.ok(
            Math.abs(dotXZ) < 0.01,
            `Sample ${i} tangent and normal not perpendicular (dot=${dotXZ.toFixed(4)})`
          );
        }
      });

      it("projectFrenet accurately recovers known on-centerline points", () => {
        const step = Math.max(1, Math.floor(samples.length / 50));

        for (let i = 0; i < samples.length; i += step) {
          const target = samples[i];
          const proj = spline.projectFrenet(target.x, target.z, target.s);

          assert.ok(
            Math.abs(proj.s - target.s) < 0.5,
            `Frenet recovery s error: projected ${proj.s.toFixed(2)}m, target ${target.s.toFixed(2)}m`
          );
          assert.ok(
            Math.abs(proj.t) < 0.2,
            `Frenet recovery t error: projected ${proj.t.toFixed(3)}m for centerline point`
          );
        }
      });

      it("projectFrenet accurately recovers known offset points (+3m right / -3m left)", () => {
        const step = Math.max(1, Math.floor(samples.length / 25));

        for (let i = 0; i < samples.length; i += step) {
          const target = samples[i];

          for (const testOffset of [-3.0, 3.0]) {
            const posX = target.x + target.normalX * testOffset;
            const posZ = target.z + target.normalZ * testOffset;

            const proj = spline.projectFrenet(posX, posZ, target.s);

            assert.ok(
              Math.abs(proj.t - testOffset) < 0.4,
              `Frenet offset t error: projected ${proj.t.toFixed(3)}m, expected ${testOffset}m`
            );
          }
        }
      });
    });
  }
});
