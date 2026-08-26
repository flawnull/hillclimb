/**
 * VAL BORBERA HILLCLIMB — Stage 3: Cresta Ebro
 * Route: High ridge road below Monte Ebro (1,350m -> 1,690m, 6.0 km)
 * Dramatic drops on BOTH sides, zero guardrail, blind crests, rolling knife-edge ridge.
 */

import { TrackBuilder } from "../authoring/trackBuilder";
import { StageDef } from "../TrackSpline";

export function createCrestaEbroStage(): StageDef {
  const b = new TrackBuilder(0, 1350, 0, 0);

  // Sector 1 (0 - 1.2 km): Ridge Trailhead (1,350m -> 1,420m)
  b.straight(200, { grade: 0.05, halfWidth: 3.2, exposure: 'both', dropDepth: 350 });
  b.sweeper({ dir: 'right', radius: 90, arcDeg: 55, grade: 0.06, exposure: 'both', dropDepth: 420 });
  b.straight(250, { grade: 0.06, halfWidth: 3.0, exposure: 'both', dropDepth: 480 });
  b.sweeper({ dir: 'left', radius: 80, arcDeg: 65, grade: 0.06, exposure: 'both', dropDepth: 530 });
  b.straight(300, { grade: 0.05, halfWidth: 3.2, exposure: 'both', dropDepth: 590 });
  b.checkpoint(); // Checkpoint 1 (~1.2 km)

  // Sector 2 (1.2 - 2.5 km): The Knife Edge (1,420m -> 1,510m)
  b.hairpin({ dir: 'right', radius: 12, arcDeg: 155, entryGrade: 0.06, exitGrade: 0.07, exposure: 'both', dropDepth: 650, halfWidth: 3.4 });
  b.straight(280, { grade: 0.07, halfWidth: 3.0, exposure: 'both', dropDepth: 720 });
  b.sweeper({ dir: 'left', radius: 75, arcDeg: 75, grade: 0.07, exposure: 'both', dropDepth: 790 });
  b.straight(320, { grade: 0.06, halfWidth: 3.0, exposure: 'both', dropDepth: 840 });
  b.hairpin({ dir: 'left', radius: 11.5, arcDeg: 160, entryGrade: 0.07, exitGrade: 0.08, exposure: 'both', dropDepth: 890, halfWidth: 3.4 });
  b.straight(220, { grade: 0.07, halfWidth: 3.0, exposure: 'both', dropDepth: 940 });
  b.checkpoint(); // Checkpoint 2 (~2.5 km)

  // Sector 3 (2.5 - 3.8 km): Monte Chiappo Flank (1,510m -> 1,595m)
  b.sweeper({ dir: 'right', radius: 85, arcDeg: 60, grade: 0.06, exposure: 'both', dropDepth: 980 });
  b.straight(300, { grade: 0.07, halfWidth: 3.0, exposure: 'both', dropDepth: 1020 });
  b.sweeper({ dir: 'left', radius: 95, arcDeg: 55, grade: 0.06, exposure: 'both', dropDepth: 1060 });
  b.straight(280, { grade: 0.07, halfWidth: 3.0, exposure: 'both', dropDepth: 1100 });
  b.hairpin({ dir: 'right', radius: 12, arcDeg: 160, entryGrade: 0.07, exitGrade: 0.08, exposure: 'both', dropDepth: 1140, halfWidth: 3.4 });
  b.straight(220, { grade: 0.06, halfWidth: 3.0, exposure: 'both', dropDepth: 1180 });
  b.checkpoint(); // Checkpoint 3 (~3.8 km)

  // Sector 4 (3.8 - 5.0 km): The Wind Gap & Blind Crests (1,595m -> 1,650m)
  b.sweeper({ dir: 'left', radius: 100, arcDeg: 50, grade: 0.05, exposure: 'both', dropDepth: 1210 });
  b.straight(340, { grade: 0.05, halfWidth: 3.2, exposure: 'both', dropDepth: 1240 });
  b.sweeper({ dir: 'right', radius: 90, arcDeg: 60, grade: 0.05, exposure: 'both', dropDepth: 1270 });
  b.straight(310, { grade: 0.04, halfWidth: 3.2, exposure: 'both', dropDepth: 1300 });
  b.checkpoint(); // Checkpoint 4 (~5.0 km)

  // Sector 5 (5.0 - 6.0 km): Summit Ridge of Monte Ebro (1,650m -> 1,690m)
  b.sweeper({ dir: 'left', radius: 110, arcDeg: 55, grade: 0.04, exposure: 'both', dropDepth: 1320 });
  b.straight(320, { grade: 0.04, halfWidth: 3.4, exposure: 'both', dropDepth: 1340 });
  b.sweeper({ dir: 'right', radius: 120, arcDeg: 45, grade: 0.03, exposure: 'both', dropDepth: 1350 });
  b.straight(350, { grade: 0.02, halfWidth: 3.6, exposure: 'both', dropDepth: 1360, landmark: 'shrine' });
  b.checkpoint(); // Finish Checkpoint (~6.0 km, 1,690m)

  return b.build(
    'cresta-ebro',
    'Cresta Ebro',
    'Monte Ebro High Ridge Road (6.0 km, 1,350m → 1,690m)',
    250.0, // Gold: 4:10
    285.0, // Silver: 4:45
    330.0  // Bronze: 5:30
  );
}
