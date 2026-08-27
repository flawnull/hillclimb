/**
 * VAL BORBERA HILLCLIMB — Deterministic Math Golden-Vector Suite
 *
 * The re-simulation suite (anti-cheat-resim.test.ts) proves that the client and
 * the server AGREE. It cannot prove they agree on the RIGHT answer, because both
 * sides call the same functions — a systematically wrong approximation passes it
 * perfectly. This suite closes that gap with three independent kinds of check:
 *
 *   1. ACCURACY  — deviation from libm is inside a pinned bound.
 *   2. CONTINUITY — no jump across an internal range-reduction branch boundary.
 *   3. GOLDEN CHECKSUM — a hash over a fixed input grid, pinned as a literal.
 *
 * The checksum is the cross-engine parity probe. It is derived from
 * Number.prototype.toPrecision, whose output ECMA-262 specifies exactly, so it is
 * engine-independent by construction. Run this file under Node (V8) and under a
 * WebKit/Hermes target: an identical GOLDEN_CHECKSUM in both is direct evidence
 * that an iOS run and an Edge re-simulation see the same numbers.
 *
 * If a change to deterministicMath.ts makes this fail, that is the intended alarm.
 * Update the golden value ONLY together with a SIM_VERSION bump, because changing
 * these functions invalidates every leaderboard time recorded under the old ones.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  DET_PI,
  DET_HALF_PI,
  detSin,
  detCos,
  detTan,
  detAtan,
  detAtan2,
  detNormalizeAngle,
} from "../src/game/vehicle/deterministicMath";

/** Pinned accuracy bounds. Tighten if the approximations improve; never loosen silently. */
const TOL_SIN = 1e-7;
const TOL_COS = 1e-7;
const TOL_TAN = 1e-6;
const TOL_ATAN = 1e-8;
const TOL_ATAN2 = 1e-8;

/** Largest tolerated jump across an internal branch boundary, in radians (~6e-6 degrees). */
const TOL_CONTINUITY = 1e-7;

function maxErr(f: (x: number) => number, ref: (x: number) => number, lo: number, hi: number, n: number, skip?: (x: number) => boolean) {
  let worst = 0;
  let at = lo;
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    if (skip && skip(x)) continue;
    const e = Math.abs(f(x) - ref(x));
    if (e > worst) {
      worst = e;
      at = x;
    }
  }
  return { worst, at };
}

describe("Deterministic Math — accuracy", () => {
  it("detSin matches Math.sin across [-4PI, 4PI]", () => {
    const { worst, at } = maxErr(detSin, Math.sin, -4 * DET_PI, 4 * DET_PI, 200000);
    assert.ok(worst < TOL_SIN, `max |detSin - sin| = ${worst.toExponential(3)} at x=${at} (bound ${TOL_SIN})`);
  });

  it("detCos matches Math.cos across [-4PI, 4PI]", () => {
    const { worst, at } = maxErr(detCos, Math.cos, -4 * DET_PI, 4 * DET_PI, 200000);
    assert.ok(worst < TOL_COS, `max |detCos - cos| = ${worst.toExponential(3)} at x=${at} (bound ${TOL_COS})`);
  });

  it("detTan matches Math.tan away from the poles", () => {
    const { worst, at } = maxErr(detTan, Math.tan, -1.3, 1.3, 200000);
    assert.ok(worst < TOL_TAN, `max |detTan - tan| = ${worst.toExponential(3)} at x=${at} (bound ${TOL_TAN})`);
  });

  it("detAtan matches Math.atan across [-8, 8] including the |x|=1 reduction boundary", () => {
    // Regression guard: without two-stage range reduction this peaked at 2.96e-2
    // (1.70 degrees) exactly at |x| = 1, and the re-simulation suite still passed.
    const { worst, at } = maxErr(detAtan, Math.atan, -8, 8, 400000);
    assert.ok(worst < TOL_ATAN, `max |detAtan - atan| = ${worst.toExponential(3)} at x=${at} (bound ${TOL_ATAN})`);
  });

  it("detAtan stays accurate far from the origin", () => {
    for (const x of [-1e6, -1e3, -50, 50, 1e3, 1e6]) {
      const e = Math.abs(detAtan(x) - Math.atan(x));
      assert.ok(e < TOL_ATAN, `|detAtan(${x}) - atan(${x})| = ${e.toExponential(3)}`);
    }
  });

  it("detAtan2 matches Math.atan2 around the full circle", () => {
    let worst = 0;
    let at = 0;
    for (let i = 0; i <= 200000; i++) {
      const theta = -DET_PI + (2 * DET_PI * i) / 200000;
      const y = Math.sin(theta);
      const x = Math.cos(theta);
      const e = Math.abs(detAtan2(y, x) - Math.atan2(y, x));
      if (e > worst) {
        worst = e;
        at = theta;
      }
    }
    assert.ok(worst < TOL_ATAN2, `max |detAtan2 - atan2| = ${worst.toExponential(3)} at theta=${at} (bound ${TOL_ATAN2})`);
  });

  it("detAtan2 handles the quadrant and axis edge cases", () => {
    const cases: Array<[number, number]> = [
      [0, 1], [1, 0], [0, -1], [-1, 0],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
      [0, 0], [-0, 1], [1e-12, -1],
    ];
    for (const [y, x] of cases) {
      const got = detAtan2(y, x);
      const want = y === 0 && x === 0 ? 0 : Math.atan2(y, x);
      assert.ok(Math.abs(got - want) < TOL_ATAN2, `detAtan2(${y}, ${x}) = ${got}, expected ~${want}`);
    }
  });
});

describe("Deterministic Math — continuity across branch boundaries", () => {
  const EPS = 1e-9;

  it("detAtan is continuous across |x| = 1 (the 1/x reflection)", () => {
    // The pre-fix implementation jumped 3.39 degrees here.
    for (const b of [1, -1]) {
      const jump = Math.abs(detAtan(b + EPS) - detAtan(b - EPS));
      assert.ok(jump < TOL_CONTINUITY, `detAtan jumped ${jump.toExponential(3)} rad across x=${b}`);
    }
  });

  it("detAtan is continuous across |x| = tan(PI/12) (the PI/6 shift)", () => {
    const b = 0.26794919243112270647;
    for (const s of [1, -1]) {
      const jump = Math.abs(detAtan(s * (b + EPS)) - detAtan(s * (b - EPS)));
      assert.ok(jump < TOL_CONTINUITY, `detAtan jumped ${jump.toExponential(3)} rad across x=${s * b}`);
    }
  });

  it("detSin is continuous across |x| = PI/2 (the PI - x reflection)", () => {
    for (const b of [DET_HALF_PI, -DET_HALF_PI]) {
      const jump = Math.abs(detSin(b + EPS) - detSin(b - EPS));
      assert.ok(jump < TOL_CONTINUITY, `detSin jumped ${jump.toExponential(3)} across x=${b}`);
    }
  });

  it("detNormalizeAngle is continuous and idempotent", () => {
    for (let i = 0; i <= 10000; i++) {
      const x = -20 + (40 * i) / 10000;
      const a = detNormalizeAngle(x);
      assert.ok(a >= -DET_PI - 1e-12 && a <= DET_PI + 1e-12, `out of range: ${a}`);
      assert.ok(Math.abs(detNormalizeAngle(a) - a) < 1e-12, `not idempotent at ${x}`);
    }
  });
});

describe("Deterministic Math — trigonometric identities", () => {
  it("sin^2 + cos^2 = 1", () => {
    let worst = 0;
    for (let i = 0; i <= 100000; i++) {
      const x = -4 * DET_PI + (8 * DET_PI * i) / 100000;
      worst = Math.max(worst, Math.abs(detSin(x) * detSin(x) + detCos(x) * detCos(x) - 1));
    }
    assert.ok(worst < 5e-7, `max |sin^2 + cos^2 - 1| = ${worst.toExponential(3)}`);
  });

  it("detAtan2(sin t, cos t) recovers t", () => {
    let worst = 0;
    for (let i = 0; i <= 100000; i++) {
      const t = -DET_PI + 1e-6 + ((2 * DET_PI - 2e-6) * i) / 100000;
      worst = Math.max(worst, Math.abs(detNormalizeAngle(detAtan2(detSin(t), detCos(t)) - t)));
    }
    assert.ok(worst < 1e-6, `max round-trip error = ${worst.toExponential(3)}`);
  });
});

describe("Deterministic Math — engine parity", () => {
  /**
   * Hash built from toPrecision(17), whose output ECMA-262 pins exactly.
   * Any single-ulp change in any sampled value changes this string.
   */
  function goldenChecksum(): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const feed = (v: number) => {
      const s = Number.isFinite(v) ? v.toPrecision(17) : String(v);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = ((h1 ^ c) >>> 0) * 16777619 >>> 0;
        h2 = ((h2 + c) >>> 0) * 2246822519 >>> 0;
        h2 = (h2 ^ (h2 >>> 13)) >>> 0;
      }
    };

    const N = 2048;
    for (let i = 0; i <= N; i++) {
      const t = -4 * DET_PI + (8 * DET_PI * i) / N;
      feed(detSin(t));
      feed(detCos(t));
      feed(detNormalizeAngle(t * 3.7));
    }
    for (let i = 0; i <= N; i++) {
      const t = -1.3 + (2.6 * i) / N;
      feed(detTan(t));
    }
    for (let i = 0; i <= N; i++) {
      const x = -8 + (16 * i) / N;
      feed(detAtan(x));
    }
    for (let i = 0; i <= N; i++) {
      const th = -DET_PI + (2 * DET_PI * i) / N;
      feed(detAtan2(detSin(th), detCos(th)));
    }
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }

  it("golden checksum is unchanged (bump SIM_VERSION if this must change)", () => {
    const GOLDEN_CHECKSUM = "0ad945747dc6ce29";
    assert.equal(
      goldenChecksum(),
      GOLDEN_CHECKSUM,
      "Deterministic math output changed. Every recorded leaderboard time was produced " +
        "under the old functions and is no longer reproducible. Bump SIM_VERSION and " +
        "re-key the leaderboards before updating this constant."
    );
  });
});

describe("Deterministic Math — source purity guard", () => {
  it("deterministicMath.ts uses no engine-dependent Math functions", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../src/game/vehicle/deterministicMath.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const forbidden = ["sin", "cos", "tan", "atan", "atan2", "pow", "exp", "log", "log2", "log10", "hypot", "cbrt", "fround", "random"];
    for (const name of forbidden) {
      const re = new RegExp(`Math\\.${name}\\s*\\(`);
      assert.ok(!re.test(code), `deterministicMath.ts must not call Math.${name}() — it is not bit-identical across JS engines`);
    }
    assert.ok(!/\*\*/.test(code), "deterministicMath.ts must not use the ** operator (Math.pow semantics)");
  });

  it("the simulation path calls no engine-dependent Math functions", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // The guard previously covered only the three files below the comment line. It missed
    // trackBuilder.ts, which lays out every road control point with trig — and that geometry
    // feeds TrackSpline's Frenet projection on both the client and the Edge re-simulation, so
    // a single ULP of divergence there compounds across a 40,000-step run exactly the way the
    // vehicle math would. The stage files are included for the same reason: SIM_VERSION's own
    // bump list already names stages/* as simulation-affecting.
    const files = [
      "../src/game/vehicle/VehicleModel.ts",
      "../src/game/track/TrackSpline.ts",
      "../src/game/timing/Timer.ts",
      "../src/game/track/authoring/trackBuilder.ts",
      "../src/game/track/stages/borberaSprint.ts",
      "../src/game/track/stages/salitaCosola.ts",
      "../src/game/track/stages/crestaEbro.ts",
      "../src/game/track/stages/index.ts",
    ];
    const forbidden = ["sin", "cos", "tan", "atan", "atan2", "pow", "exp", "log", "hypot", "cbrt", "fround", "random"];
    for (const rel of files) {
      const src = readFileSync(join(here, rel), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const name of forbidden) {
        const re = new RegExp(`Math\\.${name}\\s*\\(`);
        assert.ok(!re.test(code), `${rel} must not call Math.${name}() — use the det* equivalent`);
      }
      // Math.PI is a property, not a call, so the loop above cannot see it. It seeds the
      // arguments to the trig above, so it belongs to the same kernel.
      assert.ok(!/Math\.PI/.test(code), `${rel} must not use Math.PI — use DET_PI`);
    }
  });
});
