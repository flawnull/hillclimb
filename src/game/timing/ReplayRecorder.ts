/**
 * VAL BORBERA HILLCLIMB — Replay Recorder & Anti-Cheat Trace
 * Quantizes and compresses input stream for ghost replays and Edge verification.
 */

import { InputAxes } from "../input/InputManager";

export interface ReplayFrame {
  steer: number;     // -127..127
  throttle: number;  // 0..255
  brake: number;     // 0..255
  handbrake: number; // 0 or 1
}

export function computeReplayHash(frames: ReplayFrame[]): string {
  let hash = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    hash = ((hash << 5) - hash + f.steer * 31 + f.throttle * 17 + f.brake * 7 + f.handbrake) | 0;
  }
  return Math.abs(hash).toString(16);
}

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private isRecording: boolean = false;

  public start(): void {
    this.frames = [];
    this.isRecording = true;
  }

  public recordStep(input: InputAxes): void {
    if (!this.isRecording) return;

    this.frames.push({
      steer: Math.round(Math.max(-1, Math.min(1, input.steer)) * 127),
      throttle: Math.round(Math.max(0, Math.min(1, input.throttle)) * 255),
      brake: Math.round(Math.max(0, Math.min(1, input.brake)) * 255),
      handbrake: input.handbrake ? 1 : 0,
    });
  }

  public stop(): ReplayFrame[] {
    this.isRecording = false;
    return this.frames;
  }

  public clear(): void {
    this.frames = [];
    this.isRecording = false;
  }

  public computeHash(): string {
    return computeReplayHash(this.frames);
  }

  public getFrameCount(): number {
    return this.frames.length;
  }

  public getFrames(): ReplayFrame[] {
    return this.frames;
  }
}

