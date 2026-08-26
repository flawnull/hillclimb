/**
 * VAL BORBERA HILLCLIMB — Relative-Anchor Touch Steering Controller (§9.1)
 * Zero-latency analog steering for mobile devices.
 * 
 * When the driver touches down anywhere in the left steering zone, that point becomes
 * the center anchor (0 steer). Moving left or right smoothly modulates analog steering.
 */

import { InputManager } from "./InputManager";

export interface TouchSliderState {
  active: boolean;
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
  steer: number;
}

export class TouchController {
  private inputManager: InputManager;
  private pointerId: number | null = null;
  private anchorX: number = 0;
  private anchorY: number = 0;
  private currentX: number = 0;
  private currentY: number = 0;
  private maxTravelPx: number = 55; // Pixels for 100% steering lock
  private deadzonePx: number = 3;
  private stateChangeCallback?: (state: TouchSliderState) => void;

  constructor(inputManager: InputManager, maxTravelPx: number = 55) {
    this.inputManager = inputManager;
    this.maxTravelPx = maxTravelPx;
  }

  public onStateChange(cb: (state: TouchSliderState) => void): void {
    this.stateChangeCallback = cb;
  }

  public handlePointerDown(e: React.PointerEvent | PointerEvent): void {
    if (this.pointerId !== null) return; // Already tracking a finger

    this.pointerId = e.pointerId;
    this.anchorX = e.clientX;
    this.anchorY = e.clientY;
    this.currentX = e.clientX;
    this.currentY = e.clientY;

    this.inputManager.setTouchAxes({ steer: 0 });
    this.notify();
  }

  public handlePointerMove(e: React.PointerEvent | PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;

    this.currentX = e.clientX;
    this.currentY = e.clientY;

    const deltaX = this.currentX - this.anchorX;
    let steer = 0;

    if (Math.abs(deltaX) > this.deadzonePx) {
      const effectiveDelta = deltaX > 0 ? deltaX - this.deadzonePx : deltaX + this.deadzonePx;
      steer = Math.max(-1.0, Math.min(1.0, effectiveDelta / (this.maxTravelPx - this.deadzonePx)));
    }

    // Direct synchronous feeding into InputManager (0ms latency, no React render cycle)
    this.inputManager.setTouchAxes({ steer });
    this.notify(steer);
  }

  public handlePointerUp(e: React.PointerEvent | PointerEvent): void {
    if (this.pointerId !== e.pointerId) return;

    this.pointerId = null;
    this.inputManager.setTouchAxes({ steer: 0 });
    this.notify(0, false);
  }

  public handlePointerCancel(e: React.PointerEvent | PointerEvent): void {
    this.handlePointerUp(e);
  }

  public setThrottle(val: number): void {
    this.inputManager.setTouchAxes({ throttle: val });
  }

  public setBrake(val: number): void {
    this.inputManager.setTouchAxes({ brake: val });
  }

  public setHandbrake(val: boolean): void {
    this.inputManager.setTouchAxes({ handbrake: val });
  }

  private notify(steer: number = 0, active: boolean = this.pointerId !== null): void {
    if (this.stateChangeCallback) {
      this.stateChangeCallback({
        active,
        anchorX: this.anchorX,
        anchorY: this.anchorY,
        currentX: this.currentX,
        currentY: this.currentY,
        steer,
      });
    }
  }

  public destroy(): void {
    this.pointerId = null;
    this.inputManager.setTouchAxes({ steer: 0, throttle: 0, brake: 0, handbrake: false });
  }
}
