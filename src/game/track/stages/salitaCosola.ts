/**
 * VAL BORBERA HILLCLIMB — Stage 2: Salita di Cosola
 * The Main Event: 11.5 km climb from Cabella (560m) to Capanne di Cosola (1,500m)
 * 38 hairpins (tornanti), 9 checkpoints, vegetation transitioning chestnut -> beech -> alpine pasture.
 */

import { TrackBuilder } from "../authoring/trackBuilder";
import { StageDef } from "../TrackSpline";

export function createSalitaCosolaStage(): StageDef {
  const b = new TrackBuilder(0, 560, 0, 0);

  // Sector 1 (0 - 1.5 km): Cabella Lower Ascent (560m -> 680m, dense chestnut forest)
  b.village({ length: 150, halfWidth: 3.0, grade: 0.05, landmark: 'hamlet' });
  b.straight(200, { grade: 0.08, halfWidth: 3.6 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 70 }); // Tornante 1
  b.straight(180, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 80 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 95 });  // Tornante 2
  b.straight(220, { grade: 0.08, halfWidth: 3.8, exposure: 'left', dropDepth: 110 });
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 125 }); // Tornante 3
  b.straight(260, { grade: 0.08, halfWidth: 3.8 });
  b.hairpin({ dir: 'right', radius: 10.0, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 140 }); // Tornante 4
  b.straight(200, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 1 (~1.5 km, ~680m)

  // Sector 2 (1.5 - 3.0 km): Lower Valley Switchbacks (680m -> 810m)
  b.hairpin({ dir: 'left', radius: 11.5, arcDeg: 165, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 160 }); // Tornante 5
  b.straight(190, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 175 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 190 }); // Tornante 6
  b.sweeper({ dir: 'left', radius: 70, arcDeg: 60, grade: 0.08, exposure: 'right', dropDepth: 200, guardrail: true });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 220 }); // Tornante 7
  b.straight(240, { grade: 0.08, halfWidth: 3.8, exposure: 'right', dropDepth: 230 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 250 }); // Tornante 8
  b.straight(210, { grade: 0.08, halfWidth: 3.8 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 270 }); // Tornante 9
  b.straight(180, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 2 (~3.0 km, ~810m)

  // Sector 3 (3.0 - 4.5 km): Approaching Carrega Hamlet (810m -> 950m, transition to beech woods)
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 290 }); // Tornante 10
  b.straight(210, { grade: 0.09, halfWidth: 3.6, exposure: 'left', dropDepth: 300 });
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 320 }); // Tornante 11
  b.straight(190, { grade: 0.08, halfWidth: 3.6, exposure: 'right', dropDepth: 330 });
  b.hairpin({ dir: 'right', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 350 }); // Tornante 12
  b.village({ length: 180, halfWidth: 2.8, grade: 0.05, landmark: 'hamlet' }); // Carrega Hamlet
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 370 }); // Tornante 13
  b.straight(240, { grade: 0.09, halfWidth: 3.8, exposure: 'right', dropDepth: 390 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 410 }); // Tornante 14
  b.straight(220, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 3 (~4.5 km, ~950m - Carrega Ligure)

  // Sector 4 (4.5 - 6.0 km): Mid-Mountain Flow & Escalating Exposure (950m -> 1,080m)
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 430 }); // Tornante 15
  b.straight(250, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 450 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 470 }); // Tornante 16
  b.sweeper({ dir: 'left', radius: 80, arcDeg: 70, grade: 0.08, exposure: 'right', dropDepth: 490, guardrail: true });
  b.hairpin({ dir: 'left', radius: 10.0, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 510 }); // Tornante 17
  b.straight(210, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 530 });
  b.hairpin({ dir: 'right', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 550 }); // Tornante 18
  b.straight(240, { grade: 0.08, halfWidth: 3.8 });
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 570 }); // Tornante 19
  b.straight(200, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 4 (~6.0 km, ~1,080m)

  // Sector 5 (6.0 - 7.5 km): The Beech Forest Cascades (1,080m -> 1,210m)
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 590 }); // Tornante 20
  b.straight(220, { grade: 0.09, halfWidth: 3.6, exposure: 'left', dropDepth: 610 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 630 }); // Tornante 21
  b.straight(200, { grade: 0.08, halfWidth: 3.6, exposure: 'right', dropDepth: 650 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 670 }); // Tornante 22
  b.sweeper({ dir: 'right', radius: 75, arcDeg: 65, grade: 0.08, exposure: 'left', dropDepth: 690, guardrail: true });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'right', dropDepth: 710 }); // Tornante 23
  b.straight(240, { grade: 0.08, halfWidth: 3.8, exposure: 'right', dropDepth: 730 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'left', dropDepth: 750 }); // Tornante 24
  b.straight(210, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 5 (~7.5 km, ~1,210m)

  // Sector 6 (7.5 - 9.0 km): Tree Line Breach & Vast Horizons (1,210m -> 1,330m)
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 770 }); // Tornante 25
  b.straight(260, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 790 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 810 }); // Tornante 26
  b.straight(230, { grade: 0.08, halfWidth: 3.6, exposure: 'left', dropDepth: 830 });
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.10, exposure: 'right', dropDepth: 850 }); // Tornante 27
  b.straight(250, { grade: 0.08, halfWidth: 3.8, exposure: 'right', dropDepth: 870 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 890 }); // Tornante 28
  b.straight(210, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 6 (~9.0 km, ~1,330m)

  // Sector 7 (9.0 - 10.5 km): The High Alpine Switchbacks (1,330m -> 1,440m)
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 910 }); // Tornante 29
  b.straight(240, { grade: 0.09, halfWidth: 3.6, exposure: 'right', dropDepth: 930 });
  b.hairpin({ dir: 'right', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 950 }); // Tornante 30
  b.straight(220, { grade: 0.08, halfWidth: 3.6, exposure: 'left', dropDepth: 970 });
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.09, exitGrade: 0.10, exposure: 'right', dropDepth: 990 }); // Tornante 31
  b.straight(250, { grade: 0.08, halfWidth: 3.8, exposure: 'right', dropDepth: 1010 });
  b.hairpin({ dir: 'right', radius: 10.5, arcDeg: 170, entryGrade: 0.09, exitGrade: 0.11, exposure: 'left', dropDepth: 1030 }); // Tornante 32
  b.straight(230, { grade: 0.08, halfWidth: 3.8 });
  b.checkpoint(); // Checkpoint 7 (~10.5 km, ~1,440m)

  // Sector 8 (10.5 - 11.5 km): Final Sprint to Capanne di Cosola Pass (1,440m -> 1,500m)
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.08, exitGrade: 0.10, exposure: 'right', dropDepth: 1050 }); // Tornante 33
  b.straight(280, { grade: 0.08, halfWidth: 3.8, exposure: 'right', dropDepth: 1070 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.08, exitGrade: 0.06, exposure: 'left', dropDepth: 1090 }); // Tornante 34
  b.sweeper({ dir: 'left', radius: 120, arcDeg: 50, grade: 0.04, exposure: 'right', dropDepth: 1100, guardrail: true });
  b.straight(320, { grade: 0.02, halfWidth: 4.2, landmark: 'pylon' });
  b.checkpoint(); // Checkpoint 8 (~10.0 km, ~1,380m)

  // Sector 9 (10.4 - 11.5 km): The last four tornanti onto the pass itself.
  // The stage previously stopped at 1,263 m — 237 m short of Capanne di Cosola — which
  // cost the climb its payoff. Open pasture above the treeline, no guardrail, the whole
  // Val Borbera visible below.
  b.hairpin({ dir: 'left', radius: 10.5, arcDeg: 170, entryGrade: 0.14, exitGrade: 0.16, exposure: 'right', dropDepth: 380 }); // Tornante 35
  b.straight(340, { grade: 0.16, halfWidth: 3.6, exposure: 'right', dropDepth: 400 });
  b.hairpin({ dir: 'right', radius: 10.5, arcDeg: 170, entryGrade: 0.14, exitGrade: 0.16, exposure: 'left', dropDepth: 410 }); // Tornante 36
  b.straight(360, { grade: 0.16, halfWidth: 3.6, exposure: 'left', dropDepth: 420 });
  b.hairpin({ dir: 'left', radius: 11.0, arcDeg: 165, entryGrade: 0.14, exitGrade: 0.15, exposure: 'right', dropDepth: 430 }); // Tornante 37
  b.straight(380, { grade: 0.15, halfWidth: 3.8, exposure: 'right', dropDepth: 440 });
  b.hairpin({ dir: 'right', radius: 11.0, arcDeg: 165, entryGrade: 0.13, exitGrade: 0.10, exposure: 'left', dropDepth: 450 }); // Tornante 38 (Final)
  b.sweeper({ dir: 'left', radius: 90, arcDeg: 55, grade: 0.10, exposure: 'right', dropDepth: 440, guardrail: false });
  b.straight(400, { grade: 0.09, halfWidth: 4.2, exposure: 'both', dropDepth: 400, landmark: 'pylon' });
  b.straight(280, { grade: 0.04, halfWidth: 4.4, landmark: 'sign' }); // Capanne di Cosola
  b.checkpoint(); // Finish Checkpoint (Checkpoint 9) — Capanne di Cosola Pass (~11.5 km, 1,500m)

  return b.build(
    'salita-cosola',
    'Salita di Cosola',
    'Cabella Ligure → Capanne di Cosola',
    510.0, // Gold: 8:30
    570.0, // Silver: 9:30
    660.0  // Bronze: 11:00
  );
}
