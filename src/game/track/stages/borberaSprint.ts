/**
 * VAL BORBERA HILLCLIMB — Stage 1: Borbera Sprint
 * Route: Cabella Ligure ↔ Rocchetta Ligure (4.2 km, 560m -> 430m)
 * Fast valley sprint, stone bridges across the Borbera river, flowing sweepers.
 */

import { TrackBuilder } from "../authoring/trackBuilder";
import { StageDef } from "../TrackSpline";

export function createBorberaSprintStage(): StageDef {
  const b = new TrackBuilder(0, 560, 0, 0);

  // Sector 1: Leaving Cabella village over the historic stone bridge
  b.village({ length: 180, halfWidth: 3.0, grade: -0.01, landmark: 'hamlet' });
  b.straight(120, { grade: -0.02, halfWidth: 3.8 });
  b.bridge({ length: 90, dropDepth: 35, landmark: 'bridge' });
  b.straight(250, { grade: -0.03, halfWidth: 4.0, landmark: 'hamlet' }); // Borbera riverside houses

  // Fast Right Sweeper along riverbank
  b.sweeper({ dir: 'right', radius: 110, arcDeg: 65, grade: -0.03, exposure: 'left', dropDepth: 45, guardrail: true });
  b.straight(320, { grade: -0.04, halfWidth: 4.0, exposure: 'left', dropDepth: 50 });
  b.checkpoint(); // Checkpoint 1 (~1.0 km)

  // Sector 2: Technical chicane & first hairpin
  b.sweeper({ dir: 'left', radius: 85, arcDeg: 50, grade: -0.03, exposure: 'right', dropDepth: 60 });
  b.straight(180, { grade: -0.02, halfWidth: 3.8, landmark: 'hamlet' }); // Molino, before the hairpin
  b.hairpin({ dir: 'left', radius: 13, arcDeg: 160, entryGrade: -0.03, exitGrade: -0.02, exposure: 'right', dropDepth: 85, guardrail: true });
  b.straight(280, { grade: -0.04, halfWidth: 4.0, exposure: 'right', dropDepth: 90 });
  b.sweeper({ dir: 'right', radius: 95, arcDeg: 55, grade: -0.03, exposure: 'left', dropDepth: 70, guardrail: true });
  b.checkpoint(); // Checkpoint 2 (~2.1 km)

  // Sector 3: Second bridge and riverside high-speed section
  b.straight(200, { grade: -0.03, halfWidth: 4.0, landmark: 'hamlet' }); // Cosola di Sotto
  b.bridge({ length: 80, dropDepth: 40, landmark: 'bridge' });
  b.straight(350, { grade: -0.04, halfWidth: 4.2, exposure: 'left', dropDepth: 55 });
  b.sweeper({ dir: 'left', radius: 130, arcDeg: 70, grade: -0.03, exposure: 'right', dropDepth: 75 });
  b.hairpin({ dir: 'right', radius: 14, arcDeg: 155, entryGrade: -0.03, exitGrade: -0.02, exposure: 'left', dropDepth: 110, guardrail: true });
  b.straight(260, { grade: -0.03, halfWidth: 4.0, exposure: 'left', dropDepth: 80 });
  b.checkpoint(); // Checkpoint 3 (~3.2 km)

  // Sector 4: Final sprint into Rocchetta valley finish
  b.sweeper({ dir: 'right', radius: 100, arcDeg: 60, grade: -0.03, exposure: 'left', dropDepth: 65, guardrail: true });
  b.straight(400, { grade: -0.04, halfWidth: 4.2, landmark: 'hamlet' }); // Rocchetta outskirts
  b.sweeper({ dir: 'left', radius: 120, arcDeg: 45, grade: -0.02, exposure: 'none' });
  b.straight(300, { grade: -0.02, halfWidth: 4.2, landmark: 'sign' });
  b.checkpoint(); // Finish Checkpoint (~4.2 km)

  return b.build(
    'borbera-sprint',
    'Borbera Sprint',
    'Cabella Ligure ↔ Rocchetta Ligure',
    160.0, // Gold: 2:40
    185.0, // Silver: 3:05
    215.0  // Bronze: 3:35
  );
}
