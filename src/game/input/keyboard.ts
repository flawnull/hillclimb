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

  /**
   * COMMAND SWALLOWS keyup ON macOS, WHICH IS HOW THE BRAKE STUCK ON.
   *
   * While either Command key is held, macOS does not deliver `keyup` for ordinary keys — the
   * events simply never arrive. So a driver holding S (brake) who presses Command for
   * anything at all, releases S, then releases Command, leaves `keys['KeyS']` true with no
   * event left that could ever clear it. `getAxes` merges the sources with `Math.max`, so a
   * latched keyboard brake cannot be overridden by releasing the on-screen pedal either: the
   * car simply will not go.
   *
   * `blur` already covers Command chords that switch app or tab, which is why this recovered
   * "after a while" rather than never — but a chord that keeps focus here (Command tapped on
   * its own, Command+S, a shortcut the page ignores) leaves it stuck with nothing to reset it
   * short of pressing the same key again.
   *
   * Two rules close it. A key pressed as part of a Command chord is not registered at all,
   * because its release will never be reported; and when Command itself comes up, everything
   * held is dropped, because any release during the chord was swallowed and cannot be
   * recovered. Command's own keyup IS delivered, so that last rule always gets its chance to
   * run.
   */
  private static isMeta(code: string): boolean {
    return code === 'MetaLeft' || code === 'MetaRight';
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Part of a Command chord: its keyup will never arrive, so never record it as held.
    // This also stops Command+R (reload) doubling as the game's restart shortcut.
    if (e.metaKey && !KeyboardController.isMeta(e.code)) return;

    this.keys[e.code] = true;
    if (e.code === 'KeyR' && this.onRestartCallback) {
      this.onRestartCallback();
    }
    if (e.code === 'Escape' && this.onPauseCallback) {
      this.onPauseCallback();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (KeyboardController.isMeta(e.code)) {
      // Anything released during the chord reported nothing. Drop the lot rather than trust
      // a map that is now known to be stale.
      this.keys = {};
      return;
    }
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
