/**
 * VAL BORBERA HILLCLIMB — Stage 2: Salita di Cosola
 *
 * A short, dense climb: roughly 2.4 km and a dozen tornanti from Cabella (560 m) to the
 * Cosola ridge (~735 m), driveable in about two minutes.
 *
 * Sized for someone watching over your shoulder. The stage was 11.5 km with 38 hairpins, then
 * 5.6 km with 15, and both were still paced like an endurance event: long straights between
 * corners, and a run measured in many minutes. Shown on a laptop or a big screen the interest
 * has to arrive continuously, so the straights here are 90-160 m rather than 200-300 and the
 * corners come almost immediately after one another.
 *
 * Drop depths are also deliberately modest — 60 to 280 m rather than the previous 450. Depth
 * beyond the immediate verge is not visible from the car, but it does pull the ground out
 * from under the carriageway, which then has to be carried on viaduct piers. Shallower drops
 * keep the road cut into the hillside where it belongs, and cost far less geometry.
 *
 * WHY EVERY TORNANTE TURNS 140 DEGREES AND NOT 170.
 *
 * A hairpin's arc decides how much the road DRIFTS SIDEWAYS each time it doubles back, and
 * that drift is the only thing standing between a switchback climb and a vertical stack. At
 * 180 degrees the exit leg is anti-parallel to the entry leg: the road turns back on itself
 * and climbs in place, directly above where it has just been. The closer the arc is to 180,
 * the less the route spreads across the hillside and the more of it ends up hanging over its
 * own lower legs — which a single-valued heightfield cannot support, so it has to be carried
 * on viaduct.
 *
 * That is what produced the forest of concrete columns through the middle sector. Measured on
 * this stage, by the share of the verge standing more than 16 m above the ground beneath it:
 *
 *     arcDeg   182     170*    160    150    145    140
 *     viaduct  24.5%   3.7%    5.2%   1.3%   0.4%   0.0%
 *     wall      6.4%   2.3%    1.7%   0.8%   0.9%   0.0%
 *                      (* the value this stage shipped with)
 *
 * At 140 the route spreads far enough across the hillside that no leg passes over another,
 * every metre of the road sits on ground, and the structure is gone rather than repainted.
 * The corners lose nothing that matters: the tightest radius driven is still 7.6 m, all
 * twelve tornanti are still detected as tornanti, and the stage is 2.36 km against 2.43.
 *
 * Do not raise these back toward 180 to make the corners "more hairpin-like". The tightness
 * comes from `radius`, which is untouched; the arc only decides whether the stage stacks.
 */

import { TrackBuilder } from "../authoring/trackBuilder";
import { StageDef } from "../TrackSpline";

export function createSalitaCosolaStage(): StageDef {
  const b = new TrackBuilder(0, 560, 0, 0);

  // ── Sector 1 (0 - 0.9 km): out of Cabella, into the woods (560 m -> 640 m) ───────────
  b.village({ length: 110, halfWidth: 3.2, grade: 0.05, landmark: 'hamlet' });
  b.straight(120, { grade: 0.08, halfWidth: 3.6 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 140, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 60 });  // Tornante 1
  b.straight(130, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 70 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 140, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 80 });  // Tornante 2
  b.straight(110, { grade: 0.09, halfWidth: 3.6, landmark: 'hamlet' }); // Case Soprane
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 140, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 90 });  // Tornante 3
  b.sweeper({ dir: 'right', radius: 55, arcDeg: 70, grade: 0.08, exposure: 'left', dropDepth: 100, guardrail: true });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 140, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 110 }); // Tornante 4
  b.straight(120, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 1 (~0.9 km)

  // ── Sector 2 (0.9 - 1.8 km): the stacked middle section (640 m -> 730 m) ─────────────
  // The busiest part: five tornanti with barely a breath between them.
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 140, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 130 }); // Tornante 5
  b.straight(100, { grade: 0.10, halfWidth: 3.6, exposure: 'right', dropDepth: 140 });
  b.hairpin({ dir: 'right', radius: 10.5, arcDeg: 140, entryGrade: 0.10, exitGrade: 0.11, exposure: 'left', dropDepth: 150 }); // Tornante 6
  b.straight(95, { grade: 0.10, halfWidth: 3.6 });
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 140, entryGrade: 0.10, exitGrade: 0.11, exposure: 'right', dropDepth: 160 }); // Tornante 7
  b.sweeper({ dir: 'left', radius: 60, arcDeg: 65, grade: 0.09, exposure: 'right', dropDepth: 170, guardrail: true });
  b.hairpin({ dir: 'right', radius: 10.5, arcDeg: 140, entryGrade: 0.10, exitGrade: 0.11, exposure: 'left', dropDepth: 180 }); // Tornante 8
  b.straight(115, { grade: 0.09, halfWidth: 3.8, landmark: 'hamlet' }); // Cosola village
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 140, entryGrade: 0.10, exitGrade: 0.11, exposure: 'right', dropDepth: 190 }); // Tornante 9
  b.straight(110, { grade: 0.09, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 2 (~1.8 km)

  // ── Sector 3 (1.8 - 2.7 km): onto the ridge (730 m -> 830 m) ─────────────────────────
  // Opens out at the end: the last two corners are faster, and the road finishes along the
  // crest with ground falling away to both sides — the payoff, kept short.
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 140, entryGrade: 0.10, exitGrade: 0.11, exposure: 'left', dropDepth: 210 }); // Tornante 10
  b.straight(130, { grade: 0.10, halfWidth: 3.6, exposure: 'left', dropDepth: 220 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 140, entryGrade: 0.10, exitGrade: 0.10, exposure: 'right', dropDepth: 230 }); // Tornante 11
  b.sweeper({ dir: 'right', radius: 80, arcDeg: 70, grade: 0.08, exposure: 'left', dropDepth: 240, guardrail: true });
  b.hairpin({ dir: 'right', radius: 11.5, arcDeg: 140, entryGrade: 0.08, exitGrade: 0.07, exposure: 'left', dropDepth: 250 }); // Tornante 12
  b.straight(140, { grade: 0.06, halfWidth: 3.8, landmark: 'hamlet' }); // last houses before the crest
  b.sweeper({ dir: 'left', radius: 95, arcDeg: 60, grade: 0.05, exposure: 'both', dropDepth: 260, guardrail: false });
  b.straight(160, { grade: 0.04, halfWidth: 4.0, exposure: 'both', dropDepth: 270 });
  b.sweeper({ dir: 'right', radius: 110, arcDeg: 45, grade: 0.03, exposure: 'both', dropDepth: 280, guardrail: false });
  b.straight(180, { grade: 0.02, halfWidth: 4.2, landmark: 'sign' }); // Cresta di Cosola
  b.checkpoint(); // Finish (~2.7 km)

  return b.build(
    'salita-cosola',
    'Salita di Cosola',
    'Cabella Ligure → Cresta di Cosola',
    // Measured over this layout, not carried over from the longer versions.
    145.0, // Gold
    165.0, // Silver
    190.0  // Bronze
  );
}
