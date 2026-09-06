/**
 * CAR MODEL VISUAL DIAGNOSTICS
 *
 * Orbits the dev-only camera around the player car at close range and screenshots each
 * angle, so bodywork changes can be inspected without driving. Companion to
 * scripts/visual-check.ts, which frames the terrain instead.
 *
 *   PORT=3001 npm run dev &
 *   npx tsx scripts/car-check.ts
 */

import { chromium, Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = process.env.VISUAL_BASE_URL || "http://localhost:3001";
/** Which car to frame, as clicks on the HUD's "Next car" arrow from the default. */
const CAR_ADVANCE = Number(process.env.CAR_ADVANCE || 0);
const OUT_DIR = path.join(process.cwd(), "scratch", "car");

/** Azimuth is measured from directly behind the car, in degrees. */
const VIEWS = [
  { label: "rear", azimuth: 0, elevation: 12, distance: 6.5 },
  { label: "rear-three-quarter", azimuth: 38, elevation: 14, distance: 7.0 },
  { label: "side", azimuth: 90, elevation: 8, distance: 7.5 },
  { label: "front-three-quarter", azimuth: 140, elevation: 14, distance: 7.0 },
  { label: "front", azimuth: 180, elevation: 12, distance: 6.5 },
  { label: "high-rear", azimuth: 20, elevation: 42, distance: 8.0 },
  { label: "low-rear", azimuth: 15, elevation: 2.5, distance: 5.5 },
];

async function waitForRendererReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(window as any).__vbRenderer &&
      !!(window as any).__vbCamera &&
      (window as any).__vbRenderer.hasTrack?.() === true &&
      !document.querySelector('[role="status"]'),
    { timeout: 30_000 }
  );
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const errors: string[] = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForRendererReady(page);
    for (let i = 0; i < CAR_ADVANCE; i++) {
      await page.getByLabel("Next car").click();
      await page.waitForTimeout(500);
    }
    if (CAR_ADVANCE) {
      const id = await page.evaluate(() => (window as any).__vbRenderer.activeCar?.id);
      console.log(`  active car: ${id}`);
    }

    // Start the run and let a few frames go by BEFORE freezing.
    //
    // The sun is not static: ChaseCameraController.update re-aims the directional light and
    // its shadow camera at the car every frame, because a 120 m shadow box fixed at the world
    // origin would never contain a stage that runs for kilometres. Freezing the renderer
    // straight after load therefore captures the car with the shadow camera still parked at
    // the origin — no cast shadow at all, which reads as a floating car that is nothing of
    // the sort. Let the loop run first.
    await page.keyboard.press("Space");
    await page.waitForTimeout(900);
    await page.evaluate(() => (window as any).__vbRenderer.stop());

    // Hide the HUD. It is a DOM overlay, and an element screenshot still renders whatever
    // sits on top of that element, so clipping to the canvas is not enough on its own.
    await page.addStyleTag({
      content: "body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }",
    });

    for (const view of VIEWS) {
      await page.evaluate((v: typeof VIEWS[number]) => {
        const w = window as any;
        const renderer = w.__vbRenderer;
        const camera = w.__vbCamera;
        const car = w.__vbScene.getObjectByName("carGroup");
        if (!car) throw new Error("carGroup not found in scene");

        // Read the world position straight off the matrix so the page needs no THREE handle.
        car.updateMatrixWorld(true);
        const e = car.matrixWorld.elements;
        const centre = { x: e[12], y: e[13] + 0.55, z: e[14] };

        // Heading of the car in world space, so azimuth 0 is always straight behind it.
        const heading = car.rotation.y;
        const az = heading + Math.PI + (v.azimuth * Math.PI) / 180;
        const el = (v.elevation * Math.PI) / 180;
        const horizontal = Math.cos(el) * v.distance;

        camera.position.set(
          centre.x + Math.sin(az) * horizontal,
          centre.y + Math.sin(el) * v.distance,
          centre.z + Math.cos(az) * horizontal
        );
        camera.lookAt(centre.x, centre.y, centre.z);
        camera.updateMatrixWorld(true);
        renderer.renderOnce();
      }, view);

      // The canvas only: the HUD is a DOM overlay that covers most of the car.
      const prefix = CAR_ADVANCE ? `car${CAR_ADVANCE}-` : "";
      await page.locator("canvas").first().screenshot({ path: path.join(OUT_DIR, `${prefix}${view.label}.png`) });
      console.log(`  wrote ${view.label}.png`);
    }
  } finally {
    await browser.close();
  }

  if (errors.length) {
    for (const e of errors) console.error(`  [error] ${e}`);
    process.exitCode = 1;
  } else {
    console.log("No console or page errors observed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
