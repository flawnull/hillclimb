/**
 * VAL BORBERA HILLCLIMB — Touch Input Release Suite
 *
 * One bug, reported from a phone: the steering stuck hard over and would not come back.
 * The screenshot showed STEER: -85% with the car stationary and the run ruined.
 *
 * `TouchController` only cleared the axis inside `handlePointerUp`, which runs from a React
 * handler on the steering pad — so the release depended entirely on the browser delivering
 * `pointerup` to that element. On a touch screen it frequently does not. The pad calls
 * `setPointerCapture`, the capture was taken on `e.target` (whichever child the finger
 * landed on, including a floating knob that is conditionally rendered), and an element that
 * unmounts while holding capture stops receiving events altogether: the browser fires
 * `lostpointercapture` and nothing more. iOS adds its own ways to swallow the up event — an
 * edge gesture, a recognised scroll, the tab backgrounding.
 *
 * An input that can stick ON is far worse than one that misses an event, so the release now
 * also runs from window-level listeners. These tests drive those paths directly: every one
 * simulates an up event that the element never sees, which is precisely the case the old
 * code had no answer to.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { TouchController } from "../src/game/input/touch";

/**
 * A window and document just real enough for the controller to attach to. Installed at load,
 * before any controller is constructed: the constructor is where `typeof window` is read and
 * the listeners are bound.
 */
class FakeDoc extends EventTarget {
  public hidden = false;
}
const fakeWindow = new EventTarget();
const fakeDocument = new FakeDoc();

// Installed for the lifetime of this file, not per test: removing them between tests left
// every controller after the first constructing with no window at all, so it attached no
// listeners and the suite silently stopped testing the thing it exists for.
const g = globalThis as unknown as { window?: unknown; document?: unknown };
g.window = fakeWindow;
g.document = fakeDocument;

/** Records what the controller pushes at the input layer. */
interface Axes {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
}

function makeStub() {
  const axes: Axes = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  const inputManager = {
    setTouchAxes(patch: Partial<Axes>) {
      Object.assign(axes, patch);
    },
  };
  return { axes, inputManager: inputManager as never };
}

function pointer(pointerId: number, clientX: number, clientY = 0) {
  return { pointerId, clientX, clientY } as never;
}

/** A `pointerup` that arrives at the window and NOT at the element — the failure case. */
function windowUp(type: string, pointerId: number): void {
  const ev = new Event(type) as Event & { pointerId: number };
  ev.pointerId = pointerId;
  fakeWindow.dispatchEvent(ev);
}

let controllers: InstanceType<typeof TouchController>[] = [];

beforeEach(() => {
  controllers = [];
});

afterEach(() => {
  for (const c of controllers) c.destroy();
});

function build() {
  const { axes, inputManager } = makeStub();
  const c = new TouchController(inputManager, 55);
  controllers.push(c);
  return { axes, c };
}

describe("Steering cannot stick on", () => {
  for (const upEvent of ["pointerup", "pointercancel", "lostpointercapture"]) {
    it(`releases on a window ${upEvent} the element never sees`, () => {
      const { axes, c } = build();

      c.handlePointerDown(pointer(1, 200));
      c.handlePointerMove(pointer(1, 140)); // 60 px left, past full lock
      assert.ok(
        axes.steer < -0.9,
        `expected full left lock from a 60 px drag, got ${axes.steer}`
      );

      // The element handler is deliberately NOT called: this is the case where capture was
      // lost, the knob unmounted, or iOS swallowed the up.
      windowUp(upEvent, 1);

      assert.strictEqual(
        axes.steer,
        0,
        `steering stayed at ${axes.steer} after a window ${upEvent} — this is the reported ` +
          `"stuck at -85% and cannot come back"`
      );
    });
  }

  it("ignores a release belonging to a different finger", () => {
    const { axes, c } = build();
    c.handlePointerDown(pointer(1, 200));
    c.handlePointerMove(pointer(1, 260));
    const held = axes.steer;
    assert.ok(held > 0.9);

    windowUp("pointerup", 2); // a pedal finger lifting must not straighten the wheel
    assert.strictEqual(axes.steer, held);

    windowUp("pointerup", 1);
    assert.strictEqual(axes.steer, 0);
  });

  it("releases everything when the tab is backgrounded", () => {
    const { axes, c } = build();
    c.handlePointerDown(pointer(1, 200));
    c.handlePointerMove(pointer(1, 130));
    c.pressButton(2, "throttle");
    assert.ok(axes.steer < -0.9 && axes.throttle === 1);

    fakeDocument.hidden = true;
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    fakeDocument.hidden = false;

    assert.deepEqual(
      { steer: axes.steer, throttle: axes.throttle },
      { steer: 0, throttle: 0 },
      "a backgrounded tab must not leave the car steering and accelerating"
    );
  });

  it("releases everything when the window loses focus", () => {
    const { axes, c } = build();
    c.handlePointerDown(pointer(1, 200));
    c.handlePointerMove(pointer(1, 130));
    fakeWindow.dispatchEvent(new Event("blur"));
    assert.strictEqual(axes.steer, 0);
  });
});

describe("Pedals cannot stick on", () => {
  for (const [which, key] of [
    ["throttle", "throttle"],
    ["brake", "brake"],
  ] as const) {
    it(`${which} releases on a window pointerup the button never sees`, () => {
      const { axes, c } = build();
      c.pressButton(7, which);
      assert.strictEqual(axes[key], 1);
      windowUp("pointerup", 7);
      assert.strictEqual(axes[key], 0, `${which} stayed applied after the finger lifted`);
    });
  }

  it("handbrake releases on a window pointerup the button never sees", () => {
    const { axes, c } = build();
    c.pressButton(7, "handbrake");
    assert.strictEqual(axes.handbrake, true);
    windowUp("pointerup", 7);
    assert.strictEqual(axes.handbrake, false);
  });

  it("two fingers on two pedals release independently", () => {
    const { axes, c } = build();
    c.pressButton(3, "throttle");
    c.pressButton(4, "brake");
    windowUp("pointerup", 3);
    assert.deepEqual({ t: axes.throttle, b: axes.brake }, { t: 0, b: 1 });
    windowUp("pointerup", 4);
    assert.deepEqual({ t: axes.throttle, b: axes.brake }, { t: 0, b: 0 });
  });
});

describe("Teardown leaves nothing held", () => {
  it("destroy() clears every axis and detaches its listeners", () => {
    const { axes, c } = build();
    c.handlePointerDown(pointer(1, 200));
    c.handlePointerMove(pointer(1, 130));
    c.pressButton(2, "throttle");

    c.destroy();
    assert.deepEqual(
      { s: axes.steer, t: axes.throttle, b: axes.brake, h: axes.handbrake },
      { s: 0, t: 0, b: 0, h: false }
    );

    // A late event must not resurrect anything through a listener that outlived the
    // controller — React StrictMode mounts and tears these down twice in development.
    axes.steer = 0.5;
    windowUp("pointerup", 1);
    assert.strictEqual(axes.steer, 0.5, "a destroyed controller is still listening on window");
  });
});
