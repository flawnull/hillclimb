/**
 * VAL BORBERA HILLCLIMB — Device-pixel budget
 *
 * How many pixels the GPU is asked to shade, decided by AREA rather than by device pixel
 * ratio.
 *
 * The renderer used `min(devicePixelRatio, 2)`, which is the conventional choice and is why
 * the game runs worse on a desktop than on a phone — the opposite of what anyone expects
 * from the hardware. The ratio says nothing about how many pixels there are:
 *
 *     phone    390 x  844 CSS -> 780 x 1688  =  1.3 M device pixels
 *     laptop  1440 x  900 CSS -> 2880 x 1800 =  5.2 M   (4x the phone)
 *     27-inch 2560 x 1440 CSS -> 5120 x 2880 = 14.7 M   (11x the phone)
 *
 * Every one of those is shaded by the same fragment work — terrain, fog, shadow filtering —
 * so an eleven-fold pixel count is an eleven-fold cost, and a desktop GPU is not eleven
 * times a modern phone's. The phone was never fast; it was small.
 *
 * Budgeting by area inverts that: a large window gets a lower ratio and lands in the same
 * cost envelope as a small one. The 3D canvas is the only thing affected — the HUD is DOM
 * and stays at native resolution whatever this returns.
 */

/**
 * Device pixels the 3D view may use at the top quality tier.
 *
 * Two 1080p frames' worth. Enough that a 1440p window still supersamples slightly, and that
 * anything laptop-sized or smaller keeps a ratio above 1; low enough that a large display
 * cannot ask for four times the work of a small one purely by being large.
 */
export const HIGH_TIER_PIXELS = 4_200_000;

/** Medium and low tiers trade resolution for headroom on weaker hardware. */
export const MEDIUM_TIER_PIXELS = 2_400_000;
export const LOW_TIER_PIXELS = 1_400_000;

/** Never below this: past it the image is mush and the win has stopped being worth it. */
export const MIN_PIXEL_RATIO = 0.75;

export type PixelTier = "high" | "medium" | "low";

const TIER_BUDGET: Record<PixelTier, number> = {
  high: HIGH_TIER_PIXELS,
  medium: MEDIUM_TIER_PIXELS,
  low: LOW_TIER_PIXELS,
};

/**
 * The pixel ratio to render this canvas at.
 *
 * Never above the display's own ratio — supersampling past native buys nothing a monitor can
 * show — and never above 2 even on a three-times-density phone, where the third multiple is
 * invisible at arm's length and costs 2.25x the fragments.
 */
export function pixelRatioFor(
  cssWidth: number,
  cssHeight: number,
  deviceRatio: number,
  tier: PixelTier = "high"
): number {
  const area = Math.max(1, cssWidth * cssHeight);
  const budget = TIER_BUDGET[tier];
  const byArea = Math.sqrt(budget / area);
  const ceiling = Math.min(deviceRatio || 1, 2);
  return Math.max(MIN_PIXEL_RATIO, Math.min(ceiling, byArea));
}

/**
 * Whether to ask for multisampling.
 *
 * MSAA is per-fragment and its cost rides on top of everything above. Once the buffer is
 * already supersampled — a ratio of 1.5 or more means at least 2.25 samples per CSS pixel
 * being resolved down — it is paying twice for the same edges. Below that there is nothing
 * else smoothing them and it earns its cost.
 */
export function shouldAntialias(pixelRatio: number): boolean {
  return pixelRatio < 1.5;
}
