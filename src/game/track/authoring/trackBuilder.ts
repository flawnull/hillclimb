/**
 * VAL BORBERA HILLCLIMB — Track Authoring DSL
 * Enables declarative generation of authentic Apennine mountain stages.
 * Guaranteed monotonic elevation, correct hairpins, and realistic geometry.
 */

import { ControlPoint, StageDef, ExposureSide } from "../TrackSpline";
import { SurfaceType } from "../../vehicle/vehicleTuning";

export interface SegmentStraightOptions {
  grade?: number;             // vertical slope (e.g. 0.08 = 8% climb)
  halfWidth?: number;         // default 3.6m
  surface?: SurfaceType;
  exposure?: ExposureSide;
  dropDepth?: number;
  guardrail?: boolean;
  landmark?: string;
  stepSize?: number;          // point spacing, default 25m
}

export interface SegmentHairpinOptions {
  dir: 'left' | 'right';
  radius?: number;            // default 11m
  arcDeg?: number;            // default 165 deg
  entryGrade?: number;
  exitGrade?: number;
  exposure?: ExposureSide;
  dropDepth?: number;
  guardrail?: boolean;
  halfWidth?: number;         // hairpins widen up to 5.5m (§6.6)
}

export interface SegmentSweeperOptions {
  dir: 'left' | 'right';
  radius: number;             // e.g. 60m
  arcDeg: number;             // e.g. 70 deg
  grade?: number;
  exposure?: ExposureSide;
  dropDepth?: number;
  guardrail?: boolean;
  halfWidth?: number;
}

export class TrackBuilder {
  private points: ControlPoint[] = [];
  private checkpoints: number[] = [];
  private x: number = 0;
  private y: number = 560; // start altitude ASL
  private z: number = 0;
  private heading: number = 0; // radians, 0 = +Z
  private currentS: number = 0;
  private hairpinsCount: number = 0;

  constructor(startX: number = 0, startY: number = 560, startZ: number = 0, startHeading: number = 0) {
    this.x = startX;
    this.y = startY;
    this.z = startZ;
    this.heading = startHeading;
    this.addPoint({ x: startX, y: startY, z: startZ, halfWidth: 3.8, surface: 'asphalt', exposure: 'none' });
  }

  private addPoint(pt: Partial<ControlPoint>): void {
    const fullPt: ControlPoint = {
      x: pt.x ?? this.x,
      y: pt.y ?? this.y,
      z: pt.z ?? this.z,
      halfWidth: pt.halfWidth ?? 3.6,
      bank: pt.bank ?? 0,
      exposure: pt.exposure ?? 'none',
      dropDepth: pt.dropDepth ?? 0,
      guardrail: !!pt.guardrail,
      surface: pt.surface ?? 'asphalt',
      landmark: pt.landmark,
      isHairpinApex: pt.isHairpinApex,
    };
    this.points.push(fullPt);
  }

  public straight(length: number, opt: SegmentStraightOptions = {}): this {
    const grade = opt.grade ?? 0;
    const step = opt.stepSize ?? 25;
    const count = Math.max(1, Math.round(length / step));
    const actualStep = length / count;

    const dx = Math.sin(this.heading) * actualStep;
    const dz = Math.cos(this.heading) * actualStep;
    const dy = actualStep * grade;

    for (let i = 0; i < count; i++) {
      this.x += dx;
      this.z += dz;
      this.y += dy;
      this.currentS += actualStep;
      this.addPoint({
        x: this.x,
        y: this.y,
        z: this.z,
        halfWidth: opt.halfWidth ?? 3.6,
        surface: opt.surface ?? 'asphalt',
        exposure: opt.exposure ?? 'none',
        dropDepth: opt.dropDepth ?? 0,
        guardrail: opt.guardrail ?? false,
        landmark: i === Math.floor(count / 2) ? opt.landmark : undefined,
      });
    }

    return this;
  }

  public sweeper(opt: SegmentSweeperOptions): this {
    const radius = opt.radius;
    const arcRad = (opt.arcDeg * Math.PI) / 180;
    const dirSign = opt.dir === 'right' ? 1 : -1;
    const grade = opt.grade ?? 0;

    const arcLength = radius * arcRad;
    const stepSize = 15;
    const count = Math.max(2, Math.round(arcLength / stepSize));
    const dTheta = (arcRad / count) * dirSign;
    const dS = arcLength / count;
    const dy = dS * grade;

    // Banking angle into corner
    const bankAngle = (opt.dir === 'right' ? 1 : -1) * Math.min(0.08, 0.04 + (30 / radius) * 0.04);

    for (let i = 0; i < count; i++) {
      this.heading += dTheta;
      this.x += Math.sin(this.heading) * dS;
      this.z += Math.cos(this.heading) * dS;
      this.y += dy;
      this.currentS += dS;

      this.addPoint({
        x: this.x,
        y: this.y,
        z: this.z,
        bank: bankAngle,
        halfWidth: opt.halfWidth ?? 3.8,
        exposure: opt.exposure ?? (opt.dir === 'right' ? 'left' : 'right'),
        dropDepth: opt.dropDepth ?? 60,
        guardrail: opt.guardrail ?? false,
      });
    }

    return this;
  }

  public hairpin(opt: SegmentHairpinOptions): this {
    this.hairpinsCount++;
    const radius = opt.radius ?? 11;
    const arcDeg = opt.arcDeg ?? 165;
    const arcRad = (arcDeg * Math.PI) / 180;
    const dirSign = opt.dir === 'right' ? 1 : -1;
    const entryGrade = opt.entryGrade ?? 0.07;
    const exitGrade = opt.exitGrade ?? 0.10;

    const arcLength = radius * arcRad;
    const count = 12;
    const dTheta = (arcRad / count) * dirSign;
    const dS = arcLength / count;

    // Hairpins widen on apex (§6.6: up to 5.5m)
    const outsideExposure: ExposureSide = opt.exposure ?? (opt.dir === 'right' ? 'left' : 'right');

    for (let i = 0; i < count; i++) {
      const u = i / count;
      const currentGrade = entryGrade * (1 - u) + exitGrade * u;
      const dy = dS * currentGrade;

      this.heading += dTheta;
      this.x += Math.sin(this.heading) * dS;
      this.z += Math.cos(this.heading) * dS;
      this.y += dy;
      this.currentS += dS;

      // Peak widening at apex (u = 0.5)
      const apexFactor = Math.sin(u * Math.PI);
      const halfWidth = (opt.halfWidth ?? 3.6) + apexFactor * 1.8; // widens to 5.4m
      const isApex = i === Math.floor(count / 2);

      this.addPoint({
        x: this.x,
        y: this.y,
        z: this.z,
        bank: dirSign * 0.04,
        halfWidth,
        exposure: outsideExposure,
        dropDepth: opt.dropDepth ?? 120,
        guardrail: opt.guardrail ?? true,
        surface: u > 0.3 && u < 0.7 ? 'worn' : 'asphalt',
        isHairpinApex: isApex,
        landmark: isApex ? 'sign' : undefined,
      });
    }

    return this;
  }

  public village(opt: { length: number; halfWidth?: number; grade?: number; landmark?: string }): this {
    return this.straight(opt.length, {
      grade: opt.grade ?? 0.03,
      halfWidth: opt.halfWidth ?? 2.8, // narrow historic street
      exposure: 'none',
      landmark: opt.landmark ?? 'hamlet',
      surface: 'worn',
      stepSize: 18,
    });
  }

  public bridge(opt: { length: number; dropDepth?: number; landmark?: string }): this {
    return this.straight(opt.length, {
      grade: 0.01,
      halfWidth: 3.4,
      exposure: 'both',
      dropDepth: opt.dropDepth ?? 45,
      guardrail: true,
      landmark: opt.landmark ?? 'bridge',
      stepSize: 15,
    });
  }

  public checkpoint(): this {
    this.checkpoints.push(this.currentS);
    return this;
  }

  public build(
    id: string,
    name: string,
    subtitle: string,
    goldSec: number,
    silverSec: number,
    bronzeSec: number
  ): StageDef {
    let minAlt = Infinity;
    let maxAlt = -Infinity;

    for (const p of this.points) {
      if (p.y < minAlt) minAlt = p.y;
      if (p.y > maxAlt) maxAlt = p.y;
    }

    return {
      id,
      name,
      subtitle,
      length: this.currentS,
      points: this.points,
      checkpoints: this.checkpoints,
      goldTime: goldSec,
      silverTime: silverSec,
      bronzeTime: bronzeSec,
      startAltitude: this.points[0]?.y ?? 560,
      endAltitude: this.points[this.points.length - 1]?.y ?? 560,
      minAltitude: minAlt,
      maxAltitude: maxAlt,
      totalHairpins: this.hairpinsCount,
    };
  }
}
