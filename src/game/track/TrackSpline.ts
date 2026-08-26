/**
 * VAL BORBERA HILLCLIMB — Track Spline Mathematics
 * 
 * Strict architectural rule (§12.5 & §15.3):
 * ZERO imports from Three.js, React, or browser globals.
 * Pure deterministic TypeScript for client-side gameplay and Edge anti-cheat verification.
 */

import { SurfaceType } from "../vehicle/vehicleTuning";
import { detAtan2 } from "../vehicle/deterministicMath";


export type ExposureSide = 'left' | 'right' | 'both' | 'none';

export interface ControlPoint {
  x: number;
  z: number;
  y: number;                 // elevation ASL in metres
  halfWidth?: number;        // default 3.6m
  bank?: number;             // radians, + = banks right
  exposure?: ExposureSide;   // which side drops off
  dropDepth?: number;        // metres to valley floor
  guardrail?: boolean;
  surface?: SurfaceType;
  landmark?: string;         // 'bridge' | 'hamlet' | 'shrine' | 'tunnel' | 'sign' | 'pylon'
  isHairpinApex?: boolean;   // true for counting tornanti
}

export interface StageDef {
  id: string;
  name: string;
  subtitle: string;
  length: number;            // approximate metres
  points: ControlPoint[];
  checkpoints: number[];     // s-values along the stage
  goldTime: number;          // seconds
  silverTime: number;        // seconds
  bronzeTime: number;        // seconds
  startAltitude: number;     // metres ASL
  endAltitude: number;       // metres ASL
  minAltitude: number;
  maxAltitude: number;
  totalHairpins: number;
}

export interface SplineSample {
  s: number;                 // arc length along track
  x: number;
  y: number;
  z: number;
  tangentX: number;
  tangentY: number;
  tangentZ: number;
  normalX: number;
  normalZ: number;
  heading: number;           // radians
  pitch: number;             // radians (uphill > 0)
  bank: number;              // radians
  halfWidth: number;
  exposure: ExposureSide;
  dropDepth: number;
  guardrail: boolean;
  surface: SurfaceType;
  landmark?: string;
  isHairpinApex?: boolean;
  altitude: number;
}

export interface FrenetProjection {
  s: number;
  t: number;                 // signed lateral offset (+ is right of centerline, - is left)
  sample: SplineSample;
  distSq: number;
}

export class TrackSpline {
  public stage: StageDef;
  public totalLength: number = 0;
  private samples: SplineSample[] = [];
  private sampleStep: number = 2.0; // sample every 2 metres

  constructor(stage: StageDef) {
    this.stage = stage;
    this.buildSpline();
  }

  /**
   * Builds high-resolution sampled arc-length table using Catmull-Rom spline
   */
  private buildSpline(): void {
    const pts = this.stage.points;
    if (pts.length < 2) return;

    // Centripetal Catmull-Rom interpolation (alpha = 0.5)
    // Prevents overshoot, cusps, and self-intersections when transitioning between
    // long straight segments (25m) and tight hairpin segments (3m).
    const densePoints: {
      x: number; y: number; z: number;
      bank: number; halfWidth: number;
      exposure: ExposureSide; dropDepth: number;
      guardrail: boolean; surface: SurfaceType; landmark?: string;
      isHairpinApex?: boolean;
    }[] = [];

    const getT = (t: number, p0: ControlPoint, p1: ControlPoint): number => {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dz = p1.z - p0.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return t + Math.sqrt(Math.max(0.001, d)); // alpha = 0.5 is sqrt(d)
    };

    const numSegments = pts.length - 1;
    const subSteps = 10;

    for (let i = 0; i < numSegments; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const t0 = 0;
      const t1 = getT(t0, p0, p1);
      const t2 = getT(t1, p1, p2);
      const t3 = getT(t2, p2, p3);

      for (let j = 0; j < subSteps; j++) {
        const u = j / subSteps;
        const t = t1 + (t2 - t1) * u;

        // Centripetal Barry-Goldman pyramid evaluation
        const dt10 = t1 - t0 || 0.0001;
        const dt21 = t2 - t1 || 0.0001;
        const dt32 = t3 - t2 || 0.0001;
        const dt20 = t2 - t0 || 0.0001;
        const dt31 = t3 - t1 || 0.0001;

        const a1x = ((t1 - t) / dt10) * p0.x + ((t - t0) / dt10) * p1.x;
        const a1y = ((t1 - t) / dt10) * p0.y + ((t - t0) / dt10) * p1.y;
        const a1z = ((t1 - t) / dt10) * p0.z + ((t - t0) / dt10) * p1.z;

        const a2x = ((t2 - t) / dt21) * p1.x + ((t - t1) / dt21) * p2.x;
        const a2y = ((t2 - t) / dt21) * p1.y + ((t - t1) / dt21) * p2.y;
        const a2z = ((t2 - t) / dt21) * p1.z + ((t - t1) / dt21) * p2.z;

        const a3x = ((t3 - t) / dt32) * p2.x + ((t - t2) / dt32) * p3.x;
        const a3y = ((t3 - t) / dt32) * p2.y + ((t - t2) / dt32) * p3.y;
        const a3z = ((t3 - t) / dt32) * p2.z + ((t - t2) / dt32) * p3.z;

        const b1x = ((t2 - t) / dt20) * a1x + ((t - t0) / dt20) * a2x;
        const b1y = ((t2 - t) / dt20) * a1y + ((t - t0) / dt20) * a2y;
        const b1z = ((t2 - t) / dt20) * a1z + ((t - t0) / dt20) * a2z;

        const b2x = ((t3 - t) / dt31) * a2x + ((t - t1) / dt31) * a3x;
        const b2y = ((t3 - t) / dt31) * a2y + ((t - t1) / dt31) * a3y;
        const b2z = ((t3 - t) / dt31) * a2z + ((t - t1) / dt31) * a3z;

        const x = ((t2 - t) / dt21) * b1x + ((t - t1) / dt21) * b2x;
        const y = ((t2 - t) / dt21) * b1y + ((t - t1) / dt21) * b2y;
        const z = ((t2 - t) / dt21) * b1z + ((t - t1) / dt21) * b2z;

        const bank = (p1.bank || 0) * (1 - u) + (p2.bank || 0) * u;
        const halfWidth = (p1.halfWidth || 3.6) * (1 - u) + (p2.halfWidth || 3.6) * u;
        const dropDepth = (p1.dropDepth || 0) * (1 - u) + (p2.dropDepth || 0) * u;
        const exposure = u < 0.5 ? (p1.exposure || 'none') : (p2.exposure || 'none');
        const guardrail = u < 0.5 ? !!p1.guardrail : !!p2.guardrail;
        const surface = (p1.surface || 'asphalt') as SurfaceType;
        const landmark = u < 0.2 ? p1.landmark : undefined;
        const isHairpinApex = u < 0.5 ? p1.isHairpinApex : p2.isHairpinApex;

        densePoints.push({
          x, y, z, bank, halfWidth, exposure, dropDepth, guardrail, surface, landmark, isHairpinApex
        });
      }
    }

    // Add final point
    const last = pts[pts.length - 1];
    densePoints.push({
      x: last.x, y: last.y, z: last.z,
      bank: last.bank || 0,
      halfWidth: last.halfWidth || 3.6,
      exposure: last.exposure || 'none',
      dropDepth: last.dropDepth || 0,
      guardrail: !!last.guardrail,
      surface: last.surface || 'asphalt',
      landmark: last.landmark,
    });

    // Compute cumulative arc length s and smooth central-difference tangents
    this.samples = [];
    let currentS = 0;

    for (let i = 0; i < densePoints.length; i++) {
      const p = densePoints[i];
      let tx = 0, ty = 0, tz = 1;

      if (i > 0) {
        const prev = densePoints[i - 1];
        const segDx = p.x - prev.x;
        const segDy = p.y - prev.y;
        const segDz = p.z - prev.z;
        currentS += Math.sqrt(segDx * segDx + segDy * segDy + segDz * segDz);
      }

      if (i > 0 && i < densePoints.length - 1) {
        const prev = densePoints[i - 1];
        const next = densePoints[i + 1];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const dz = next.z - prev.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        tx = dx / len;
        ty = dy / len;
        tz = dz / len;
      } else if (i < densePoints.length - 1) {
        const next = densePoints[i + 1];
        const dx = next.x - p.x;
        const dy = next.y - p.y;
        const dz = next.z - p.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        tx = dx / len;
        ty = dy / len;
        tz = dz / len;
      } else if (i > 0) {
        const prev = densePoints[i - 1];
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        const dz = p.z - prev.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        tx = dx / len;
        ty = dy / len;
        tz = dz / len;
      }

      // Heading in radians (0 = +Z, clockwise)
      const heading = detAtan2(tx, tz);

      // Pitch angle (uphill > 0)
      const horizLen = Math.sqrt(tx * tx + tz * tz) || 0.0001;
      const pitch = detAtan2(ty, horizLen);

      // Normal is perpendicular to tangent in horizontal X-Z plane (+90 deg, pointing right), normalized to unit length
      const normalX = tz / horizLen;
      const normalZ = -tx / horizLen;

      this.samples.push({
        s: currentS,
        x: p.x,
        y: p.y,
        z: p.z,
        tangentX: tx,
        tangentY: ty,
        tangentZ: tz,
        normalX,
        normalZ,
        heading,
        pitch,
        bank: p.bank,
        halfWidth: p.halfWidth,
        exposure: p.exposure,
        dropDepth: p.dropDepth,
        guardrail: p.guardrail,
        surface: p.surface,
        landmark: p.landmark,
        isHairpinApex: p.isHairpinApex,
        altitude: p.y,
      });
    }

    this.totalLength = currentS;
  }

  /**
   * Sample spline at exact arc length s (interpolated)
   */
  public getSampleAtS(s: number): SplineSample {
    const clampedS = Math.max(0, Math.min(this.totalLength, s));
    const samples = this.samples;
    if (samples.length === 0) {
      return {
        s: 0, x: 0, y: 0, z: 0,
        tangentX: 0, tangentY: 0, tangentZ: 1,
        normalX: 1, normalZ: 0,
        heading: 0, pitch: 0, bank: 0,
        halfWidth: 3.6, exposure: 'none', dropDepth: 0, guardrail: false, surface: 'asphalt', altitude: 560,
      };
    }

    // Binary search for segment
    let low = 0;
    let high = samples.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (samples[mid].s < clampedS) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx = Math.max(0, Math.min(samples.length - 2, low - 1));
    const s0 = samples[idx];
    const s1 = samples[idx + 1];

    const segLen = s1.s - s0.s || 0.0001;
    const u = Math.max(0, Math.min(1, (clampedS - s0.s) / segLen));

    return {
      s: clampedS,
      x: s0.x + (s1.x - s0.x) * u,
      y: s0.y + (s1.y - s0.y) * u,
      z: s0.z + (s1.z - s0.z) * u,
      tangentX: s0.tangentX + (s1.tangentX - s0.tangentX) * u,
      tangentY: s0.tangentY + (s1.tangentY - s0.tangentY) * u,
      tangentZ: s0.tangentZ + (s1.tangentZ - s0.tangentZ) * u,
      normalX: s0.normalX + (s1.normalX - s0.normalX) * u,
      normalZ: s0.normalZ + (s1.normalZ - s0.normalZ) * u,
      heading: s0.heading + (s1.heading - s0.heading) * u,
      pitch: s0.pitch + (s1.pitch - s0.pitch) * u,
      bank: s0.bank + (s1.bank - s0.bank) * u,
      halfWidth: s0.halfWidth + (s1.halfWidth - s0.halfWidth) * u,
      exposure: u < 0.5 ? s0.exposure : s1.exposure,
      dropDepth: s0.dropDepth + (s1.dropDepth - s0.dropDepth) * u,
      guardrail: u < 0.5 ? s0.guardrail : s1.guardrail,
      surface: s0.surface,
      landmark: u < 0.3 ? s0.landmark : undefined,
      altitude: s0.y + (s1.y - s0.y) * u,
    };
  }

  /**
   * Fast Frenet projection: (pos.x, pos.z) -> (s, t).
   * Cached local search ±40m of previous s (O(1) complexity per §6.6).
   */
  public projectFrenet(x: number, z: number, cachedS: number = 0): FrenetProjection {
    const samples = this.samples;
    if (samples.length === 0) {
      return { s: 0, t: 0, sample: this.getSampleAtS(0), distSq: 0 };
    }

    // Determine search window index around cachedS using exact binary search
    const hasCache = cachedS > 0;
    let centerIdx = 0;
    if (hasCache) {
      let low = 0;
      let high = samples.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (samples[mid].s < cachedS) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      centerIdx = Math.max(0, Math.min(samples.length - 1, low));
    }

    const windowRadius = 35; // check ~70 samples (±70m)
    const minIdx = hasCache ? Math.max(0, centerIdx - windowRadius) : 0;
    const maxIdx = hasCache ? Math.min(samples.length - 1, centerIdx + windowRadius) : samples.length - 1;

    let bestDistSq = Infinity;
    let bestIdx = minIdx;

    for (let i = minIdx; i <= maxIdx; i++) {
      const s = samples[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = i;
      }
    }

    // If on boundary of cached window, fallback to full search
    if (hasCache && bestDistSq > 1600 && (bestIdx === minIdx || bestIdx === maxIdx)) {
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const dx = x - s.x;
        const dz = z - s.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIdx = i;
        }
      }
    }

    const bestSample = samples[bestIdx];

    // Compute signed lateral offset t: dot((pos - sample.pos), sample.normal)
    const dx = x - bestSample.x;
    const dz = z - bestSample.z;
    const t = dx * bestSample.normalX + dz * bestSample.normalZ;

    // Continuous s refinement along horizontal track tangent for sub-millimeter positioning
    const horizTanLen = Math.sqrt(bestSample.tangentX * bestSample.tangentX + bestSample.tangentZ * bestSample.tangentZ) || 0.0001;
    const tanX = bestSample.tangentX / horizTanLen;
    const tanZ = bestSample.tangentZ / horizTanLen;
    const tangentDist = dx * tanX + dz * tanZ;
    const exactS = Math.max(0, Math.min(this.totalLength, bestSample.s + tangentDist));
    const smoothSample = this.getSampleAtS(exactS);

    return {
      s: exactS,
      t,
      sample: smoothSample,
      distSq: bestDistSq,
    };

  }

  public getAllSamples(): SplineSample[] {
    return this.samples;
  }
}
