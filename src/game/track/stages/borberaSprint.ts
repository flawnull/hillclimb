/**
 * VAL BORBERA HILLCLIMB — Stage 1: Borbera Sprint
 * Route: Cabella Ligure ↔ Rocchetta Ligure (3.7 km, 560m -> 430m)
 * Fast valley sprint, stone bridges across the Borbera river, flowing sweepers.
 *
 * Gold/silver/bronze below were carried over unchanged from an earlier ~4.2 km version of
 * this route (see salitaCosola.ts for the sibling stage, which documents its own
 * shortening and was re-measured against its current layout — this one never was).
 * Re-measured for the current 3.7 km layout.
 *
 * These numbers used to also set the anti-cheat floor (80% of gold time in validate.ts),
 * so the stale 160.0 s gold produced a 128000 ms floor that rejected a real, Gold-trophy,
 * replay-verified 1:49.416 (109416 ms) finish as "impossibly fast" — not because the run was
 * suspicious, but because gold/silver/bronze are reward-tier numbers, not physical bounds,
 * and this route edit let them drift past what a skilled player could actually still do. The
 * floor is now derived in validate.ts from the route's length and the submitted car's own
 * top speed instead, so a future difficulty-tuning pass on these three numbers can never
 * again reject someone's real lap.
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
    120.0, // Gold: 2:00
    140.0, // Silver: 2:20
    160.0  // Bronze: 2:40
  );
}
