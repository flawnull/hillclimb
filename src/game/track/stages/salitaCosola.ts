/**
 * VAL BORBERA HILLCLIMB — Stage 2: Salita di Cosola
 *
 * A 5-6 km climb from Cabella (560 m) to the Cosola ridge (~1,270 m), in three movements:
 * wooded valley switchbacks, an open mid-mountain traverse, and an exposed ridge finale.
 *
 * Rewritten from an 11.5 km, 38-hairpin version. That stage took roughly nine minutes to
 * drive, and by the third sector the tornanti had stopped being interesting — they were the
 * same corner repeated. It also carried far more geometry than any single view could use,
 * which cost frame rate for scenery nobody was looking at.
 *
 * The ridge finale absorbs what the separate Cresta Ebro stage existed to provide: real
 * altitude and ground falling away on both sides. That stage declared 1,060-1,360 m drops on
 * every segment at 1,350-1,690 m, which left the road on a knife edge above ground so far
 * below and so pale that it read as a desert canyon rather than an Apennine ridge. Here the
 * exposure is kept and the depths are cut to a scale that still reads as a mountain.
 */

import { TrackBuilder } from "../authoring/trackBuilder";
import { StageDef } from "../TrackSpline";

export function createSalitaCosolaStage(): StageDef {
  const b = new TrackBuilder(0, 560, 0, 0);

  // ── Sector 1 (0 - 1.6 km): Cabella, chestnut woods (560 m -> 720 m) ──────────────────
  // Five tornanti, tightening as the valley wall steepens.
  b.village({ length: 140, halfWidth: 3.0, grade: 0.05, landmark: 'hamlet' });
  b.straight(190, { grade: 0.08, halfWidth: 3.6 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 70 });  // Tornante 1
  b.straight(200, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 85 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 100 }); // Tornante 2
  b.sweeper({ dir: 'left', radius: 75, arcDeg: 55, grade: 0.08, exposure: 'right', dropDepth: 115, guardrail: true });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 130 }); // Tornante 3
  b.straight(230, { grade: 0.08, halfWidth: 3.8 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 150 }); // Tornante 4
  b.straight(210, { grade: 0.09, halfWidth: 3.8, exposure: 'left', dropDepth: 165 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.10, exposure: 'right', dropDepth: 180 }); // Tornante 5
  b.straight(180, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 1 (~1.6 km, ~720 m)

  // ── Sector 2 (1.6 - 3.4 km): open traverse above the treeline (720 m -> 980 m) ───────
  // Faster and more flowing: long sweepers with commitment, punctuated by four tornanti, so
  // the stage is not one corner type from end to end.
  b.sweeper({ dir: 'right', radius: 110, arcDeg: 70, grade: 0.07, exposure: 'left', dropDepth: 200, guardrail: true });
  b.straight(260, { grade: 0.08, halfWidth: 3.8, exposure: 'left', dropDepth: 220 });
  b.hairpin({ dir: 'right', radius: 11.5, arcDeg: 160, entryGrade: 0.08, exitGrade: 0.10, exposure: 'left', dropDepth: 240 }); // Tornante 6
  b.sweeper({ dir: 'left', radius: 95, arcDeg: 80, grade: 0.07, exposure: 'right', dropDepth: 260, guardrail: true });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 280 }); // Tornante 7
  b.straight(300, { grade: 0.08, halfWidth: 3.8, landmark: 'shrine' });
  b.sweeper({ dir: 'right', radius: 130, arcDeg: 60, grade: 0.07, exposure: 'left', dropDepth: 300, guardrail: true });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 320 }); // Tornante 8
  b.straight(250, { grade: 0.09, halfWidth: 3.6, exposure: 'left', dropDepth: 340 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 355 }); // Tornante 9
  b.straight(220, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 2 (~3.4 km, ~980 m)

  // ── Sector 3 (3.4 - 5.0 km): alpine pasture, the last climb (980 m -> 1,190 m) ───────
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.10, exitGrade: 0.12, exposure: 'left', dropDepth: 380 });  // Tornante 10
  b.straight(280, { grade: 0.11, halfWidth: 3.6, exposure: 'left', dropDepth: 400 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.11, exitGrade: 0.12, exposure: 'right', dropDepth: 415 }); // Tornante 11
  b.sweeper({ dir: 'right', radius: 100, arcDeg: 65, grade: 0.10, exposure: 'left', dropDepth: 430, guardrail: false });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 160, entryGrade: 0.10, exitGrade: 0.11, exposure: 'left', dropDepth: 440 }); // Tornante 12
  b.straight(300, { grade: 0.10, halfWidth: 3.8, exposure: 'left', dropDepth: 450, landmark: 'pylon' });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.10, exitGrade: 0.11, exposure: 'right', dropDepth: 455 }); // Tornante 13
  b.straight(260, { grade: 0.09, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 3 (~5.0 km, ~1,190 m)

  // ── Sector 4 (5.0 - 5.9 km): the Cosola ridge (1,190 m -> 1,270 m) ───────────────────
  // The payoff, and what the separate Cresta Ebro stage was for: the road runs along the
  // crest with the ground falling away to BOTH sides, no guardrail, opening out at the end.
  // Depths here are a few hundred metres rather than the 1,300 m that stage used — enough to
  // feel exposed, not so much that the surroundings collapse into a pale canyon.
  b.sweeper({ dir: 'right', radius: 120, arcDeg: 50, grade: 0.07, exposure: 'both', dropDepth: 300, guardrail: false });
  b.straight(280, { grade: 0.06, halfWidth: 3.4, exposure: 'both', dropDepth: 330 });
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.07, exitGrade: 0.08, exposure: 'both', dropDepth: 350 }); // Tornante 14
  b.sweeper({ dir: 'right', radius: 140, arcDeg: 45, grade: 0.05, exposure: 'both', dropDepth: 370, guardrail: false });
  b.straight(320, { grade: 0.05, halfWidth: 3.6, exposure: 'both', dropDepth: 390 });
  b.hairpin({ dir: 'right', radius: 11.5, arcDeg: 160, entryGrade: 0.05, exitGrade: 0.05, exposure: 'both', dropDepth: 400 }); // Tornante 15
  b.sweeper({ dir: 'left', radius: 130, arcDeg: 55, grade: 0.04, exposure: 'both', dropDepth: 410, guardrail: false });
  b.straight(300, { grade: 0.03, halfWidth: 4.0, exposure: 'both', dropDepth: 400, landmark: 'pylon' });
  b.straight(240, { grade: 0.02, halfWidth: 4.4, landmark: 'sign' }); // Capanne di Cosola
  b.checkpoint(); // Finish (~5.9 km, ~1,270 m)

  return b.build(
    'salita-cosola',
    'Salita di Cosola',
    'Cabella Ligure → Cresta di Cosola',
    // Times are measured, not guessed — see the note in the stages registry.
    250.0, // Gold
    290.0, // Silver
    345.0  // Bronze
  );
}
