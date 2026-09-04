/**
 * VAL BORBERA HILLCLIMB — Apennine Ridge Relief
 *
 * Multi-scale harmonic relief for the far field, in world space. Carried over from the
 * old MountainBackdropBuilder so the horizon silhouette is unchanged; what changed is
 * that it is now a pure function of (x, z) contributing to ONE surface, rather than the
 * height rule of a second surface that had to be stencilled away near the road.
 *
 * ZERO imports from Three.js, React, or browser globals (§12.5).
 */

// The ridges start at 300 m, not 180. Taller crests at 180 m put high ground a couple of
// hundred metres off the asphalt, where it fights the drop that an exposed ridge section
// is supposed to have — the anti-moat test in tests/terrain-field.test.ts measured the
// ground on the far side of Salita's most exposed sample rising to within 0.2 m of
// healing the drop shut. Weight out at RIDGE_FULL and beyond is 1 either way, so the
// horizon is unaffected; all this moves is the band between, where mountains have no
// business being.
const RIDGE_START = 300;
// Full ridge weight at 1100 m rather than 800. Together with the later start this spreads
// the ramp over 800 m instead of 620, so raising RIDGE_BASE (heightField.ts) to lift the
// massif high enough to reach bare rock does not steepen the rise out of the valley — the
// ramp gradient stays where it was, and the high ground moves further out, which is where
// mountains belong and where they were asked for.
const RIDGE_FULL = 1100;

/**
 * A ridged fold, centred on zero: sharp crest up to +2/pi, broad flank down to 2/pi - 1.
 *
 * A sum of plain sinusoids cannot make a mountain. It makes a dome — smooth, rounded, the
 * same gentle curvature everywhere — which is what the horizon was: good rolling land, and
 * nothing that reads as the rock the Apennines actually put on the skyline. Folding the
 * wave about zero turns each smooth maximum into a crest and each minimum into a broad
 * flank, which is the shape a ridgeline has, and it costs one `abs`.
 *
 * The 2/pi is not decoration. `1 - |sin u|` averages 1 - 2/pi over a period, so summing
 * raw folds lifts the whole far field by their combined mean — measured at about 72 m
 * here, which is enough to drag the ground back up toward road altitude and heal the
 * carve moat shut (tests/terrain-field.test.ts catches exactly this). Subtracting |sin|
 * from its own mean instead leaves the average altitude of the far field where the
 * landform put it and spends the amplitude entirely on the difference between crest and
 * valley, which is the part you can see.
 */
function fold(u: number): number {
  return 2 / Math.PI - Math.abs(Math.sin(u));
}

export function ridgeReliefAt(x: number, z: number): number {
  return (
    // The broad landform, unchanged: kilometre-scale swells that decide where the high
    // ground is at all.
    Math.sin(x * 0.0018 + 0.9) * 160 +
    Math.cos(z * 0.0015 + 1.2) * 140 +
    Math.sin((x + z) * 0.0035 + 0.4) * 80 +
    Math.cos((x - z) * 0.0028) * 50 +
    // Ridges on top of it: two chains crossing at a shallow angle, plus a third at a
    // different bearing to break their flanks into spurs so the skyline is not two
    // parallel walls.
    //
    // Wavelengths of 3100, 2200 and 1560 m, and the spread between them matters as much as
    // the figures do.
    //
    // The far field is meshed at MAX_LEAF — leafSizeAt reaches it 840 m out — so a ridge is
    // drawn in 256 m steps however finely the field is defined, and a 256 m cell 3 km away
    // covers about 125 px. What the eye gets is the height step from one cell to the next,
    // and that step follows the GRADIENT, so it is the ratio of amplitude to wavelength
    // that decides whether a mountain reads as a mountain or as a handful of enormous
    // hard-edged facets. Measured over the far field at that spacing: 82 m mean step on the
    // old smooth relief, 159 m (worst 452) on a first attempt at these folds with
    // wavelengths near 1400 m, which is the "gaps and missing texture between some" report.
    // These wavelengths bring it to 114 m, worst 329.
    //
    // Lengthening them all uniformly is not the answer either — pushed to 3500 m the three
    // folds land on top of the landform's own 1800-4200 m harmonics and the range collapses
    // into one broad hump. Keeping them spread across a factor of two, with the amplitude
    // weighted toward the longest, is what makes it read as ridges at several scales while
    // the steepest term stays small enough not to shatter the mesh.
    fold(x * 0.0019 + z * 0.0007) * 250 +
    fold(z * 0.0025 - x * 0.0014 + 1.7) * 120 +
    fold(x * 0.003 - z * 0.0027 + 2.4) * 50
  );
}

export function ridgeWeightAt(distToRoute: number): number {
  const t = (distToRoute - RIDGE_START) / (RIDGE_FULL - RIDGE_START);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
