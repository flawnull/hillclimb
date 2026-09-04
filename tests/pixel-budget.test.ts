/**
 * VAL BORBERA HILLCLIMB — Device-pixel budget
 *
 * The game ran worse on a desktop than on a phone, which is the opposite of what the
 * hardware suggests. The cause was `min(devicePixelRatio, 2)` — the conventional choice,
 * and one that says nothing about how many pixels there actually are. Same ratio, same
 * fragment work per pixel, wildly different pixel counts:
 *
 *     phone    390 x  844 -> 1.3 M device pixels
 *     laptop  1440 x  900 -> 5.2 M   (4x)
 *     27-inch 2560 x 1440 -> 14.7 M  (11x)
 *
 * A desktop GPU is not eleven times a modern phone's. The phone was never fast; it was
 * small. These tests pin the property that replaced it: whatever the window, the buffer
 * stays inside one budget.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pixelRatioFor,
  shouldAntialias,
  HIGH_TIER_PIXELS,
  MEDIUM_TIER_PIXELS,
  MIN_PIXEL_RATIO,
} from "../src/game/renderer/pixelBudget";

/** Viewports worth caring about, with the display ratio each usually comes with. */
const SHAPES: [string, number, number, number][] = [
  ["phone portrait", 390, 844, 3],
  ["phone landscape", 844, 390, 3],
  ["small laptop", 1280, 720, 2],
  ["laptop", 1440, 900, 2],
  ["large laptop", 1728, 1080, 2],
  ["1440p desktop", 2560, 1440, 2],
  ["4K desktop", 3840, 2160, 2],
  ["ultrawide", 3440, 1440, 1],
];

describe("Device-pixel budget", () => {
  for (const [name, w, h, dpr] of SHAPES) {
    it(`${name} stays inside the high-tier budget`, () => {
      const ratio = pixelRatioFor(w, h, dpr, "high");
      const pixels = w * h * ratio * ratio;
      // The floor can push a very large window over budget — that is deliberate, since
      // below MIN_PIXEL_RATIO the image stops being worth rendering — so the assertion is
      // the budget or the floor, whichever binds.
      const atFloor = ratio <= MIN_PIXEL_RATIO + 1e-9;
      assert.ok(
        pixels <= HIGH_TIER_PIXELS * 1.02 || atFloor,
        `${name}: ${(pixels / 1e6).toFixed(1)} M pixels at ratio ${ratio.toFixed(2)} exceeds the ` +
          `${(HIGH_TIER_PIXELS / 1e6).toFixed(1)} M budget without being at the floor`
      );
    });
  }

  it("never asks for more than the display can show", () => {
    for (const [name, w, h, dpr] of SHAPES) {
      const ratio = pixelRatioFor(w, h, dpr, "high");
      assert.ok(ratio <= Math.min(dpr, 2) + 1e-9, `${name}: ratio ${ratio} exceeds the display's ${dpr}`);
    }
  });

  it("caps a 3x phone at 2, where the third multiple is invisible and costs 2.25x", () => {
    assert.strictEqual(pixelRatioFor(390, 844, 3, "high"), 2);
  });

  it("closes most of the gap between the smallest and largest window", () => {
    const phone = 390 * 844 * pixelRatioFor(390, 844, 3, "high") ** 2;
    const desktop = 2560 * 1440 * pixelRatioFor(2560, 1440, 2, "high") ** 2;
    const gap = desktop / phone;
    // Before: 1.3 M against 14.7 M, a factor of 11. Now 1.3 M against 4.2 M, a factor of
    // 3.2. Parity is not on offer and should not be asserted: the phone is held at ratio 2
    // by the display ceiling and so sits well UNDER its budget, while the desktop sits on
    // it. What the budget guarantees is a ceiling on the large window, not equality.
    assert.ok(gap < 4, `desktop shades ${gap.toFixed(1)}x the phone's pixels; it was 11x`);
  });

  it("lower tiers ask for strictly less", () => {
    for (const [name, w, h, dpr] of SHAPES) {
      const high = pixelRatioFor(w, h, dpr, "high");
      const medium = pixelRatioFor(w, h, dpr, "medium");
      const low = pixelRatioFor(w, h, dpr, "low");
      assert.ok(medium <= high + 1e-9, `${name}: medium ${medium} above high ${high}`);
      assert.ok(low <= medium + 1e-9, `${name}: low ${low} above medium ${medium}`);
    }
    // And the medium tier honours its own budget on a large window.
    const r = pixelRatioFor(2560, 1440, 2, "medium");
    assert.ok(2560 * 1440 * r * r <= MEDIUM_TIER_PIXELS * 1.02 || r <= MIN_PIXEL_RATIO + 1e-9);
  });

  it("never returns something unusable", () => {
    for (const [, w, h, dpr] of SHAPES) {
      const r = pixelRatioFor(w, h, dpr, "high");
      assert.ok(Number.isFinite(r) && r >= MIN_PIXEL_RATIO, `ratio ${r} below the floor`);
    }
    // Degenerate inputs must not produce NaN or Infinity — a zero-sized canvas happens
    // during layout, and a renderer handed NaN never draws again.
    for (const bad of [
      [0, 0, 2],
      [0, 900, 2],
      [1440, 0, 2],
      [1440, 900, 0],
    ] as const) {
      const r = pixelRatioFor(bad[0], bad[1], bad[2], "high");
      assert.ok(Number.isFinite(r) && r > 0, `pixelRatioFor(${bad.join(", ")}) returned ${r}`);
    }
  });

  it("turns multisampling off exactly where supersampling replaces it", () => {
    assert.strictEqual(shouldAntialias(1.0), true);
    assert.strictEqual(shouldAntialias(1.49), true);
    assert.strictEqual(shouldAntialias(1.5), false);
    assert.strictEqual(shouldAntialias(2), false);
    // A phone supersamples, so it does not also pay for MSAA; a big desktop window does
    // not supersample, so it does.
    assert.strictEqual(shouldAntialias(pixelRatioFor(390, 844, 3, "high")), false);
    assert.strictEqual(shouldAntialias(pixelRatioFor(2560, 1440, 2, "high")), true);
  });
});
