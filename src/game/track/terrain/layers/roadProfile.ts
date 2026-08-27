/**
 * VAL BORBERA HILLCLIMB — Road-Relative Lateral Ground Profile
 *
 * The shape of the ground as you walk sideways off one road sample: gravel verge, then
 * either a sandstone cut rising into the hillside, or a drop toward the valley floor.
 *
 * This is the tuned profile from the previous `terrainHeightAt`: the cut/drop/rise
 * constants (DROP_FALLOFF, CUT_HEIGHT, HILLSIDE_RISE, etc.) all carried over unchanged, so
 * the stages keep their look. What DID change is how the ribbon and verge heights are
 * expressed: the old code wrote `s.y - 0.20` on the ribbon but `s.y - 0.12 - 0.08*(d /
 * VERGE_WIDTH)` on the verge — two independently-tuned constants that left a real ~0.08 m
 * step in the ground at the ribbon edge. Both are now written in terms of a single
 * `ROAD_CLEARANCE = 0.25`, which moves the ribbon down 5 cm from where it sat before AND
 * removes that pre-existing discontinuity as a side effect, rather than reproducing it.
 *
 * What is NOT here is any notion of how far the profile extends or how two road tiers
 * reconcile — that belongs to the carve layer, which takes a minimum across every nearby
 * tier.
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

import { SplineSample } from "../../TrackSpline";

/** Altitude of the Borbera valley floor, metres ASL. Nothing drops below this. */
export const VALLEY_FLOOR_ALT = 430;
export const MAX_VISIBLE_DROP = 1200;
export const VERGE_WIDTH = 1.2;
/** Terrain must sit at least this far below the road surface, everywhere. */
export const ROAD_CLEARANCE = 0.25;

const DROP_FALLOFF = 0.055;
const CUT_HEIGHT = 6.0;
const CUT_SLOPE = 0.42;
const HILL_FALLOFF = 0.016;
const HILLSIDE_RISE = 85;
const OPEN_VALLEY_RISE = 30;
const OPEN_VALLEY_FALLOFF = 0.010;

export function profileHeightAt(s: SplineSample, lat: number): number {
  const hw = s.halfWidth;
  const d = Math.abs(lat) - hw;

  if (d <= 0) return s.y - ROAD_CLEARANCE;
  if (d <= VERGE_WIDTH) return s.y - ROAD_CLEARANCE - 0.08 * (d / VERGE_WIDTH);

  const isLeft = lat < 0;
  const exposed =
    (isLeft && (s.exposure === "left" || s.exposure === "both")) ||
    (!isLeft && (s.exposure === "right" || s.exposure === "both"));

  const dd = Math.max(0, d - VERGE_WIDTH - 0.8);
  const vergeBase = s.y - ROAD_CLEARANCE - 0.08;

  if (exposed) {
    const declared = s.dropDepth ?? 40;
    const toValleyFloor = Math.max(20, s.altitude - VALLEY_FLOOR_ALT);
    const depth = Math.min(declared, toValleyFloor, MAX_VISIBLE_DROP);
    const t = 1 - 1 / (1 + dd * DROP_FALLOFF);
    return vergeBase - depth * t;
  }

  if (s.exposure === "none") {
    // Gentle open rise only. The large-scale relief that used to be bolted on here
    // (RIDGE_PULL_*) is now the world-space ridge layer's job.
    return vergeBase + OPEN_VALLEY_RISE * (1 - 1 / (1 + dd * OPEN_VALLEY_FALLOFF));
  }

  const cutSpan = CUT_HEIGHT / CUT_SLOPE;
  const cutProgress = Math.min(1.0, dd / cutSpan);
  const cutEased = cutProgress * cutProgress * (3 - 2 * cutProgress);
  const cut = CUT_HEIGHT * cutEased;
  const beyond = Math.max(0, dd - cutSpan);
  const hill = (HILLSIDE_RISE - CUT_HEIGHT) * (1 - 1 / (1 + beyond * HILL_FALLOFF));
  return vergeBase + cut + Math.max(0, hill);
}
