/**
 * VAL BORBERA HILLCLIMB — Deterministic Lap Timer & Checkpoint System
 * 
 * Strict architectural rule (§12.5 & §15.3):
 * ZERO imports from Three.js, React, or browser globals.
 * Pure deterministic logic: time = steps * PHYSICS_DT.
 */

import { PHYSICS_DT } from "../vehicle/vehicleTuning";
import { PersonalBest } from "@/store/gameStore";

export type RunState = 'ready' | 'countdown_3' | 'countdown_2' | 'countdown_1' | 'running' | 'finished';

export interface SplitRecord {
  checkpointIndex: number;
  s: number;
  timeSeconds: number;
  deltaPB?: number; // negative = green (faster), positive = red (slower)
}

export interface PenaltyEvent {
  type: 'wall' | 'offroad';
  timePenaltySeconds: number;
  timestampSeconds: number;
  message: string;
}

export class Timer {
  public state: RunState = 'ready';
  public stepCount: number = 0;
  public totalPenaltySeconds: number = 0;
  public penalties: PenaltyEvent[] = [];
  public splits: SplitRecord[] = [];
  public currentCheckpointIndex: number = 0;
  
  private checkpoints: number[] = [];
  private countdownTimer: number = 0;
  private personalBest?: PersonalBest;

  constructor(checkpoints: number[] = [], personalBest?: PersonalBest) {
    this.checkpoints = [...checkpoints];
    this.personalBest = personalBest;
  }

  public setCheckpoints(checkpoints: number[], pb?: PersonalBest): void {
    this.checkpoints = [...checkpoints];
    this.personalBest = pb;
    this.reset();
  }

  public reset(): void {
    this.state = 'ready';
    this.stepCount = 0;
    this.totalPenaltySeconds = 0;
    this.penalties = [];
    this.splits = [];
    this.currentCheckpointIndex = 0;
    this.countdownTimer = 0;
  }

  public start(): void {
    this.state = 'running';
    this.stepCount = 0;
    this.countdownTimer = 0;
  }

  public startCountdown(): void {
    this.state = 'countdown_3';
    this.countdownTimer = 0;
  }


  /**
   * Called every physics step (60Hz)
   */
  public step(playerS: number): {
    state: RunState;
    newSplit?: SplitRecord;
    countdownBeep?: 'tick' | 'go';
  } {
    let newSplit: SplitRecord | undefined;
    let countdownBeep: 'tick' | 'go' | undefined;

    // Handle Countdown Sequence
    if (this.state.startsWith('countdown_')) {
      this.countdownTimer += PHYSICS_DT;
      if (this.state === 'countdown_3' && this.countdownTimer >= 1.0) {
        this.state = 'countdown_2';
        this.countdownTimer = 0;
        countdownBeep = 'tick';
      } else if (this.state === 'countdown_2' && this.countdownTimer >= 1.0) {
        this.state = 'countdown_1';
        this.countdownTimer = 0;
        countdownBeep = 'tick';
      } else if (this.state === 'countdown_1' && this.countdownTimer >= 1.0) {
        this.state = 'running';
        this.countdownTimer = 0;
        this.stepCount = 0;
        countdownBeep = 'go';
      }
      return { state: this.state, countdownBeep };
    }

    if (this.state !== 'running') {
      return { state: this.state };
    }

    this.stepCount++;
    const currentTime = this.getElapsedSeconds();

    // Check Checkpoint Crossing
    if (this.currentCheckpointIndex < this.checkpoints.length) {
      const targetS = this.checkpoints[this.currentCheckpointIndex];
      if (playerS >= targetS) {
        let deltaPB: number | undefined;
        if (this.personalBest && this.personalBest.splitsMs && this.personalBest.splitsMs[this.currentCheckpointIndex]) {
          const pbSplitSec = this.personalBest.splitsMs[this.currentCheckpointIndex] / 1000;
          deltaPB = currentTime - pbSplitSec;
        }

        const split: SplitRecord = {
          checkpointIndex: this.currentCheckpointIndex,
          s: targetS,
          timeSeconds: currentTime,
          deltaPB,
        };

        this.splits.push(split);
        newSplit = split;
        this.currentCheckpointIndex++;

        // If crossed last checkpoint, finish run!
        if (this.currentCheckpointIndex >= this.checkpoints.length) {
          this.state = 'finished';
        }
      }
    }

    return { state: this.state, newSplit, countdownBeep };
  }

  public addPenalty(type: 'wall' | 'offroad', seconds: number): PenaltyEvent {
    this.totalPenaltySeconds += seconds;
    const p: PenaltyEvent = {
      type,
      timePenaltySeconds: seconds,
      timestampSeconds: this.getElapsedSeconds(),
      message: type === 'wall' ? `+${seconds.toFixed(1)}s — WALL IMPACT` : `+${seconds.toFixed(1)}s — OFF-ROAD FALL`,
    };
    this.penalties.push(p);
    return p;
  }

  public getElapsedSeconds(): number {
    return this.stepCount * PHYSICS_DT;
  }

  public getTotalTimeSeconds(): number {
    return this.getElapsedSeconds() + this.totalPenaltySeconds;
  }

  public getTotalTimeMs(): number {
    return Math.round(this.getTotalTimeSeconds() * 1000);
  }

  public getSplitsMs(): number[] {
    return this.splits.map((s) => Math.round(s.timeSeconds * 1000));
  }

  public formatTime(timeSeconds: number): string {
    const mins = Math.floor(timeSeconds / 60);
    const secs = Math.floor(timeSeconds % 60);
    const ms = Math.floor((timeSeconds * 1000) % 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
}
