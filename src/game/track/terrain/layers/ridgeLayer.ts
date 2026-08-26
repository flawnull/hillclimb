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

const RIDGE_START = 180;
const RIDGE_FULL = 800;

export function ridgeReliefAt(x: number, z: number): number {
  return (
    Math.sin(x * 0.0018 + 0.9) * 160 +
    Math.cos(z * 0.0015 + 1.2) * 140 +
    Math.sin((x + z) * 0.0035 + 0.4) * 80 +
    Math.cos((x - z) * 0.0028) * 50
  );
}

export function ridgeWeightAt(distToRoute: number): number {
  const t = (distToRoute - RIDGE_START) / (RIDGE_FULL - RIDGE_START);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
