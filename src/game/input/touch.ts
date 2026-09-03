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
  /** Which axis each currently-held button pointer owns, so a lost `pointerup` on a pedal
   *  can be released the same way a lost one on the steering pad is. */
  private buttonPointers = new Map<number, "throttle" | "brake" | "handbrake">();
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

    // WINDOW-LEVEL RELEASE. The element handlers below only fire if the browser actually
    // delivers `pointerup` to the element that is being tracked, and on a touch screen it
    // frequently does not: the steering pad sets pointer capture, the floating knob inside
    // it is conditionally rendered, and an element that unmounts while holding capture
    // stops receiving events entirely — the browser fires `lostpointercapture` and nothing
    // else. The axis is then latched at whatever it last read, which is the reported bug:
    // steering stuck at -85% with the car undriveable.
    //
    // iOS has more ways to swallow the up event than that — a system gesture from the
    // edge, the tab going to the background, a scroll being recognised — so the release
    // cannot depend on any one of them arriving. Listening on `window` in the CAPTURE
    // phase, plus blur and visibilitychange, is the same defence keyboard.ts already uses
    // for keys held when focus leaves, and for the same reason: an input that can stick on
    // is worse than one that misses an event.
    if (typeof window !== "undefined") {
      window.addEventListener("pointerup", this.handleGlobalRelease, true);
      window.addEventListener("pointercancel", this.handleGlobalRelease, true);
      window.addEventListener("lostpointercapture", this.handleGlobalRelease, true);
      window.addEventListener("blur", this.releaseAll);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibility);
    }
  }

  private handleGlobalRelease = (e: PointerEvent): void => {
    if (this.pointerId === e.pointerId) {
      this.pointerId = null;
      this.inputManager.setTouchAxes({ steer: 0 });
      this.notify(0, false);
    }
    this.releaseButton(e.pointerId);
  };

  private handleVisibility = (): void => {
    if (typeof document !== "undefined" && document.hidden) this.releaseAll();
  };

  /** Drops every held control. Used when focus or visibility is lost. */
  public releaseAll = (): void => {
    this.pointerId = null;
    this.buttonPointers.clear();
    this.inputManager.setTouchAxes({ steer: 0, throttle: 0, brake: 0, handbrake: false });
    this.notify(0, false);
  };

  /** Registers a pedal or handbrake press against the pointer holding it. */
  public pressButton(pointerId: number, which: "throttle" | "brake" | "handbrake"): void {
    this.buttonPointers.set(pointerId, which);
    if (which === "handbrake") this.inputManager.setTouchAxes({ handbrake: true });
    else this.inputManager.setTouchAxes({ [which]: 1.0 } as { throttle?: number; brake?: number });
  }

  /** Releases whatever that pointer was holding, if anything. */
  public releaseButton(pointerId: number): void {
    const which = this.buttonPointers.get(pointerId);
    if (which === undefined) return;
    this.buttonPointers.delete(pointerId);
    if (which === "handbrake") this.inputManager.setTouchAxes({ handbrake: false });
    else this.inputManager.setTouchAxes({ [which]: 0.0 } as { throttle?: number; brake?: number });
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
    if (typeof window !== "undefined") {
      window.removeEventListener("pointerup", this.handleGlobalRelease, true);
      window.removeEventListener("pointercancel", this.handleGlobalRelease, true);
      window.removeEventListener("lostpointercapture", this.handleGlobalRelease, true);
      window.removeEventListener("blur", this.releaseAll);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibility);
    }
    this.pointerId = null;
    this.buttonPointers.clear();
    this.inputManager.setTouchAxes({ steer: 0, throttle: 0, brake: 0, handbrake: false });
  }
}
