/**
 * VAL BORBERA HILLCLIMB — Keyboard Stuck-Key Suite
 *
 * Reported twice: the brake sticks on and the car will not move, then "somehow unclicks
 * after some time".
 *
 * macOS does not deliver `keyup` for ordinary keys while either Command key is held. A
 * driver holding S who presses Command, releases S, then releases Command leaves the brake
 * key recorded as held with no event left that could clear it. `InputManager.getAxes` merges
 * keyboard, touch and gamepad with `Math.max`, so a latched keyboard brake cannot be undone
 * by releasing the on-screen pedal — the run is over.
 *
 * The "unclicks after some time" is `blur`: a Command chord that switches app or tab does
 * clear it. One that keeps focus on the page does not, which is the case these tests cover.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import { KeyboardController } from "../src/game/input/keyboard";

/** A window and document just real enough for the controller to bind to. `typeof window` is
 *  read in the CONSTRUCTOR, not at module load, so installing these here is early enough. */
const fakeWindow = new EventTarget();
class FakeDoc extends EventTarget {
  public hidden = false;
}
const fakeDocument = new FakeDoc();
(globalThis as unknown as { window: EventTarget }).window = fakeWindow;
(globalThis as unknown as { document: FakeDoc }).document = fakeDocument;

/** Minimal KeyboardEvent stand-in: the controller reads only `code` and `metaKey`. */
function key(type: string, code: string, metaKey = false): Event {
  const e = new Event(type) as Event & { code: string; metaKey: boolean };
  e.code = code;
  e.metaKey = metaKey;
  return e;
}

describe("Keys cannot latch on when the browser swallows their keyup", () => {
  let kb: KeyboardController;

  beforeEach(() => {
    kb?.destroy();
    kb = new KeyboardController();
  });

  it("releases the brake when S is let go during a Command chord", () => {
    fakeWindow.dispatchEvent(key("keydown", "KeyS"));
    assert.equal(kb.getAxes().brake, 1.0, "holding S should brake");

    // Command goes down. From here macOS reports no keyup for S at all, so the release the
    // driver performs is invisible — exactly the sequence that latched the brake.
    fakeWindow.dispatchEvent(key("keydown", "MetaLeft", true));
    fakeWindow.dispatchEvent(key("keyup", "MetaLeft"));

    assert.equal(
      kb.getAxes().brake,
      0,
      "the brake must not still be on after the Command chord ends — its keyup was swallowed"
    );
  });

  it("does not register a driving key pressed as part of a Command chord", () => {
    // Command+S (save) should not brake, and crucially should not leave S recorded as held,
    // because no keyup for it will ever arrive.
    fakeWindow.dispatchEvent(key("keydown", "MetaLeft", true));
    fakeWindow.dispatchEvent(key("keydown", "KeyS", true));

    assert.equal(kb.getAxes().brake, 0, "Command+S must not apply the brake");

    fakeWindow.dispatchEvent(key("keyup", "MetaLeft"));
    assert.equal(kb.getAxes().brake, 0, "and must not leave it latched afterwards");
  });

  it("still brakes normally with no modifier involved", () => {
    fakeWindow.dispatchEvent(key("keydown", "KeyS"));
    assert.equal(kb.getAxes().brake, 1.0);
    fakeWindow.dispatchEvent(key("keyup", "KeyS"));
    assert.equal(kb.getAxes().brake, 0, "an ordinary press/release must still work");
  });

  it("clears every held key, not just the brake, when Command is released", () => {
    fakeWindow.dispatchEvent(key("keydown", "KeyW"));
    fakeWindow.dispatchEvent(key("keydown", "KeyD"));
    assert.equal(kb.getAxes().throttle, 1.0);
    assert.equal(kb.getAxes().steer, 1.0);

    fakeWindow.dispatchEvent(key("keydown", "MetaLeft", true));
    fakeWindow.dispatchEvent(key("keyup", "MetaLeft"));

    const axes = kb.getAxes();
    assert.equal(axes.throttle, 0, "throttle must not latch either");
    assert.equal(axes.steer, 0, "nor steering");
  });
});
