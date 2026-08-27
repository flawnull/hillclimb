/**
 * VAL BORBERA HILLCLIMB — Keyboard Input Handler
 */

export interface KeyboardAxes {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  reverse: boolean;
  restart: boolean;
  pause: boolean;
}

export class KeyboardController {
  private keys: Record<string, boolean> = {};
  private onRestartCallback?: () => void;
  private onPauseCallback?: () => void;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('keyup', this.handleKeyUp);
      // If focus leaves the window (alt-tab, a notification, opening devtools) while a key
      // is physically held, the browser never delivers its `keyup` — the axis it drives
      // would otherwise stay active forever, driving the car unattended. Clearing every
      // held key on `blur` and on the document becoming hidden closes both paths.
      window.addEventListener('blur', this.handleBlur);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('blur', this.handleBlur);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    // Listeners are gone, but `getAxes()` reads `keys` directly regardless of listener
    // state — clear it too, or a key held at teardown keeps registering as pressed forever.
    this.keys = {};
  }

  public onRestart(cb: () => void): void {
    this.onRestartCallback = cb;
  }

  public onPause(cb: () => void): void {
    this.onPauseCallback = cb;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    this.keys[e.code] = true;
    if (e.code === 'KeyR' && this.onRestartCallback) {
      this.onRestartCallback();
    }
    if (e.code === 'Escape' && this.onPauseCallback) {
      this.onPauseCallback();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.code] = false;
  };

  private handleBlur = (): void => {
    this.keys = {};
  };

  private handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      this.keys = {};
    }
  };

  public getAxes(): KeyboardAxes {
    const k = this.keys;

    // Steer left / right
    let steer = 0;
    if (k['KeyA'] || k['ArrowLeft']) steer -= 1.0;
    if (k['KeyD'] || k['ArrowRight']) steer += 1.0;

    // Throttle / Brake
    let throttle = 0;
    let brake = 0;
    let reverse = false;

    if (k['KeyW'] || k['ArrowUp']) throttle = 1.0;
    if (k['KeyS'] || k['ArrowDown']) {
      brake = 1.0;
      // If holding S without throttle, allow reverse
      reverse = true;
    }

    const handbrake = !!(k['Space'] || k['KeyH'] || k['ShiftLeft'] || k['ShiftRight'] || k['KeyB']);

    return {
      steer,
      throttle,
      brake,
      handbrake,
      reverse,
      restart: !!k['KeyR'],
      pause: !!k['Escape'],
    };
  }
}
