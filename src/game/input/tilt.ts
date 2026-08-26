/**
 * VAL BORBERA HILLCLIMB — Gyroscope Tilt Controller
 * Mobile tilt-steering with iOS 13+ permission support.
 */

import { InputManager } from "./InputManager";

export class TiltController {
  private inputManager: InputManager;
  private isListening: boolean = false;
  private maxRollDeg: number = 28; // Roll angle for 100% steer
  private deadzoneDeg: number = 2.5;

  constructor(inputManager: InputManager) {
    this.inputManager = inputManager;
  }

  public async requestPermission(): Promise<boolean> {
    if (
      typeof window !== "undefined" &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === "function"
    ) {
      try {
        const res = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
        return res === "granted";
      } catch (err) {
        console.warn("DeviceOrientation permission denied:", err);
        return false;
      }
    }
    return true; // Non-iOS browsers don't require explicit prompt
  }

  public start(): void {
    if (typeof window === "undefined" || this.isListening) return;
    window.addEventListener("deviceorientation", this.handleOrientation);
    this.isListening = true;
    this.inputManager.setUseTilt(true);
  }

  public stop(): void {
    if (typeof window === "undefined" || !this.isListening) return;
    window.removeEventListener("deviceorientation", this.handleOrientation);
    this.isListening = false;
    this.inputManager.setUseTilt(false);
    this.inputManager.setTiltSteer(0);
  }

  private handleOrientation = (e: DeviceOrientationEvent): void => {
    // In landscape mode, gamma/beta orientation depends on orientation angle
    let roll = e.gamma || 0;
    if (typeof window !== "undefined") {
      let angle: number | undefined;
      if (window.screen?.orientation?.angle !== undefined) {
        angle = window.screen.orientation.angle;
      } else if (typeof (window as unknown as { orientation?: number }).orientation === "number") {
        angle = (window as unknown as { orientation: number }).orientation;
      }
      if (angle === 90) roll = -(e.beta || 0);
      else if (angle === -90 || angle === 270) roll = e.beta || 0;
    }

    let steer = 0;
    if (Math.abs(roll) > this.deadzoneDeg) {
      const effective = roll > 0 ? roll - this.deadzoneDeg : roll + this.deadzoneDeg;
      steer = Math.max(-1.0, Math.min(1.0, effective / (this.maxRollDeg - this.deadzoneDeg)));
    }

    this.inputManager.setTiltSteer(steer);
  };

  public destroy(): void {
    this.stop();
  }
}
