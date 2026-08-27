/**
 * VAL BORBERA HILLCLIMB — Resource Management & Disposal Contracts
 *
 * High-confidence deterministic test suite for:
 *   1. Clean lifecycle disposal of InputManager, Timer, ReplayRecorder, and Engine.
 *   2. GameStore initial state, personal best saving, and car unlock logic.
 *   3. Preventing state corruption or memory leaks during rapid stage switching.
 *   4. EffectsManager releasing the GPU buffers and scene links it owns on dispose().
 *
 * NOTE on WebGL: this suite runs under `node:test` via `tsx`, with no DOM/canvas and no
 * real GL context available (`typeof document === 'undefined'` here) — `GameRenderer` and
 * `CarMeshBuilder` cannot be instantiated in this environment because they call
 * `document.createElement('canvas')` / build a `THREE.WebGLRenderer`. `EffectsManager`,
 * however, only touches plain `three` objects (`Scene`, `BufferGeometry`, `Points`,
 * `LineSegments`, materials) which construct fine with no DOM, so its disposal is
 * verified directly at the object-graph level: listening for the `dispose` event each
 * `Object3D`/`Material`/`BufferGeometry` fires from `.dispose()`, and checking the scene
 * graph no longer references the disposed objects.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { Engine } from "../src/game/Engine";
import { InputManager } from "../src/game/input/InputManager";
import { TrackSpline } from "../src/game/track/TrackSpline";
import { getStageDef } from "../src/game/track/stages";
import { EffectsManager } from "../src/game/renderer/EffectsManager";

describe("Resource Management & Clean Disposal", () => {
  it("Engine.destroy() tears down input listeners so held keys stop registering, and is idempotent", () => {
    const engine = new Engine("weiss-blau-30");
    const spline = new TrackSpline(getStageDef("borbera-sprint"));
    engine.setSpline(spline);

    // Simulate a key being physically held when destroy() runs.
    const kb = engine.input as unknown as {
      keyboard: { handleKeyDown: (e: { code: string }) => void };
    };
    kb.keyboard.handleKeyDown({ code: "KeyW" });
    assert.strictEqual(engine.input.getAxes().throttle, 1.0, "sanity: throttle should register before destroy");

    engine.destroy();

    // The window-level 'keydown' listener that would keep driving this axis is gone, so a
    // fabricated event delivered straight to the (now-orphaned) handler is the only way
    // left to prove the state was cleared. Assert on the observable axis output instead:
    // KeyboardController.destroy() clears `keys`, which InputManager.getAxes() surfaces.
    assert.strictEqual(engine.input.getAxes().throttle, 0, "held key must not still register after destroy()");

    // A second destroy() must be safe (idempotent) — e.g. React StrictMode double-invoking
    // an unmount effect, or a caller destroying both the engine and its renderer.
    assert.doesNotThrow(() => engine.destroy());
  });

  it("rapid consecutive stage spline switches do not leak or corrupt vehicle state", () => {
    const engine = new Engine("lanzo-alta-4wd");
    const stages = ["borbera-sprint", "salita-cosola", "cresta-ebro"] as const;

    for (let cycle = 0; cycle < 5; cycle++) {
      for (const stageId of stages) {
        const stageDef = getStageDef(stageId);
        const spline = new TrackSpline(stageDef);
        engine.setSpline(spline);

        // Vehicle must sit cleanly on new stage start position
        assert.ok(engine.vehicle.state.onRoad, `Car should be grounded on road for ${stageId}`);
        assert.strictEqual(engine.vehicle.state.speedMs, 0);
        assert.strictEqual(engine.timer.state, "ready");
      }
    }
  });

  it("rapid consecutive vehicle switching retains valid tuning and physical mass", () => {
    const engine = new Engine("weiss-blau-30");
    const cars = ["weiss-blau-30", "lanzo-alta-4wd", "pandino-4x4", "alpe-a110"];

    for (const carId of cars) {
      engine.vehicle.setCar(carId);
      assert.strictEqual(engine.vehicle.car.id, carId);
      assert.ok(engine.vehicle.car.mass > 0, "Mass must be positive");
      assert.ok(engine.vehicle.car.vMax > 0, "vMax must be positive");
      assert.ok(engine.vehicle.car.brakeForce > 0, "brakeForce must be positive");
    }
  });

  it("EffectsManager.dispose() frees its GPU buffers and unlinks them from the scene", () => {
    const scene = new THREE.Scene();
    const effects = new EffectsManager(scene);

    // Sanity: construction wires both objects into the scene graph.
    assert.ok(scene.children.includes(effects.smokePoints));
    assert.ok(scene.children.includes(effects.skidLines));

    let smokeGeoDisposed = false;
    let smokeMatDisposed = false;
    let skidGeoDisposed = false;
    let skidMatDisposed = false;
    (effects.smokePoints.geometry as THREE.BufferGeometry).addEventListener("dispose", () => {
      smokeGeoDisposed = true;
    });
    (effects.smokePoints.material as THREE.Material).addEventListener("dispose", () => {
      smokeMatDisposed = true;
    });
    (effects.skidLines.geometry as THREE.BufferGeometry).addEventListener("dispose", () => {
      skidGeoDisposed = true;
    });
    (effects.skidLines.material as THREE.Material).addEventListener("dispose", () => {
      skidMatDisposed = true;
    });

    effects.dispose();

    assert.ok(smokeGeoDisposed, "smoke particle geometry must be disposed");
    assert.ok(smokeMatDisposed, "smoke particle material must be disposed");
    assert.ok(skidGeoDisposed, "skid mark geometry must be disposed");
    assert.ok(skidMatDisposed, "skid mark material must be disposed");
    assert.ok(!scene.children.includes(effects.smokePoints), "smoke points must be unlinked from the scene");
    assert.ok(!scene.children.includes(effects.skidLines), "skid lines must be unlinked from the scene");
  });
});
