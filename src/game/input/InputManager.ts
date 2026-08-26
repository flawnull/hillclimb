/**
 * VAL BORBERA HILLCLIMB — Unified Input Manager
 * Outputs normalized axes regardless of input source (keyboard, touch, tilt, gamepad).
 */

import { KeyboardController } from "./keyboard";

export interface InputAxes {
  steer: number;      // -1.0 (full left) .. +1.0 (full right)
  throttle: number;   // 0.0 .. 1.0
  brake: number;      // 0.0 .. 1.0
  handbrake: boolean;
  reverse: boolean;
}

export class InputManager {
  private keyboard: KeyboardController;
  private touchAxes: InputAxes = { steer: 0, throttle: 0, brake: 0, handbrake: false, reverse: false };
  private tiltSteer: number = 0;
  private useTilt: boolean = false;
  private autoThrottle: boolean = false;

  constructor() {
    this.keyboard = new KeyboardController();
  }

  public destroy(): void {
    this.keyboard.destroy();
  }

  public setTouchAxes(axes: Partial<InputAxes>): void {
    this.touchAxes = { ...this.touchAxes, ...axes };
  }

  public setTiltSteer(steer: number): void {
    this.tiltSteer = steer;
  }

  public setUseTilt(enabled: boolean): void {
    this.useTilt = enabled;
  }

  public setAutoThrottle(enabled: boolean): void {
    this.autoThrottle = enabled;
  }

  public onRestart(cb: () => void): void {
    this.keyboard.onRestart(cb);
  }

  public onPause(cb: () => void): void {
    this.keyboard.onPause(cb);
  }

  /**
   * Polls gamepad if available
   */
  private getGamepadAxes(): InputAxes | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const gamepads = navigator.getGamepads();
    const gp = gamepads[0] || gamepads[1];
    if (!gp) return null;

    // Left stick X: gp.axes[0]
    let steer = gp.axes[0] || 0;
    if (Math.abs(steer) < 0.1) steer = 0; // deadzone

    // Triggers (RT = throttle, LT = brake) or Buttons
    let throttle = 0;
    let brake = 0;

    // LT is button 6, RT is button 7 on standard mapping
    if (gp.buttons[7]) throttle = gp.buttons[7].value;
    if (gp.buttons[6]) brake = gp.buttons[6].value;

    // A button (0) or B button (1) for handbrake
    const handbrake = !!(gp.buttons[0]?.pressed || gp.buttons[1]?.pressed);

    return {
      steer: Math.max(-1, Math.min(1, steer)),
      throttle: Math.max(0, Math.min(1, throttle)),
      brake: Math.max(0, Math.min(1, brake)),
      handbrake,
      reverse: brake > 0.5 && throttle === 0,
    };
  }

  /**
   * Returns merged input axes across all active controllers
   */
  public getAxes(): InputAxes {
    const kb = this.keyboard.getAxes();
    const gp = this.getGamepadAxes();
    const touch = this.touchAxes;

    let steer = kb.steer;
    let throttle = kb.throttle;
    let brake = kb.brake;
    let handbrake = kb.handbrake;
    let reverse = kb.reverse;

    // Merge Touch
    if (Math.abs(touch.steer) > 0.01) steer = touch.steer;
    if (touch.throttle > 0) throttle = Math.max(throttle, touch.throttle);
    if (touch.brake > 0) {
      brake = Math.max(brake, touch.brake);
      if (touch.throttle === 0) reverse = true;
    }
    if (touch.handbrake) handbrake = true;

    // Merge Tilt if enabled
    if (this.useTilt && Math.abs(this.tiltSteer) > 0.01) {
      steer = this.tiltSteer;
    }

    // Merge Gamepad if connected
    if (gp) {
      if (Math.abs(gp.steer) > 0.05) steer = gp.steer;
      if (gp.throttle > 0.05) throttle = Math.max(throttle, gp.throttle);
      if (gp.brake > 0.05) brake = Math.max(brake, gp.brake);
      if (gp.handbrake) handbrake = true;
      if (gp.reverse) reverse = true;
    }

    // Auto-throttle assist (holds throttle unless braking)
    if (this.autoThrottle && brake < 0.1) {
      throttle = 1.0;
    }

    return {
      steer: Math.max(-1.0, Math.min(1.0, steer)),
      throttle: Math.max(0.0, Math.min(1.0, throttle)),
      brake: Math.max(0.0, Math.min(1.0, brake)),
      handbrake,
      reverse,
    };
  }
}
