/**
 * VISUAL DIAGNOSTICS HARNESS
 *
 * Drives a running dev server with Playwright/Chromium, selects each stage
 * through the actual game UI (there is no ?stage= query param — see
 * app/page.tsx / StageSelectModal), positions the dev-only camera exposed on
 * `window.__vbCamera` at a set of fixed diagnostic poses derived from
 * `window.__vbSpline`, and screenshots each pose to scratch/visual/.
 *
 * This script does not start the dev server itself. Run:
 *   PORT=3001 npm run dev &
 *   npm run visual-check
 *
 * Env:
 *   VISUAL_BASE_URL  base URL of the running dev server (default http://localhost:3001)
 */

import { chromium, Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = process.env.VISUAL_BASE_URL || "http://localhost:3001";
const OUT_DIR = path.join(process.cwd(), "scratch", "visual");

interface StageMeta {
  id: string;
  route: string; // text shown on the stage-select card, used to click it
  name: string; // stage display name, used to confirm the switch landed
}

const STAGES: StageMeta[] = [
  { id: "borbera-sprint", route: "Cabella <-> Rocchetta", name: "Borbera Sprint" },
  { id: "salita-cosola", route: "Cabella -> Cresta di Cosola", name: "Salita di Cosola" },
];

interface Pose {
  label: string;
  frac: number; // fraction along the stage [0,1]
  height: number; // metres above the road sample
  ahead: number; // look-ahead distance in metres along arc length
}

const POSES: Pose[] = [
  { label: "start-apron", frac: 0.0, height: 6, ahead: 40 },
  { label: "first-sweeper", frac: 0.12, height: 8, ahead: 60 },
  { label: "hairpin-stack", frac: 0.45, height: 25, ahead: 90 },
  { label: "valley-edge", frac: 0.62, height: 12, ahead: 70 },
  { label: "horizon", frac: 0.8, height: 120, ahead: 400 },
  { label: "finish", frac: 0.98, height: 8, ahead: 50 },
];

async function waitForRendererReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(window as any).__vbRenderer &&
      !!(window as any).__vbCamera &&
      !!(window as any).__vbSpline &&
      typeof (window as any).__vbSpline.totalLength === "number" &&
      (window as any).__vbSpline.totalLength > 0,
    { timeout: 30_000 }
  );
}

async function selectStage(page: Page, stage: StageMeta): Promise<void> {
  const bannerText = async () =>
    (await page.locator(".hud-topleft span.uppercase").first().textContent()) || "";

  if ((await bannerText()).trim().toUpperCase() === stage.name.toUpperCase()) {
    return; // already the active stage (e.g. default borbera-sprint on first load)
  }

  await page.locator(".hud-topleft > button").first().click();
  await page.waitForSelector("text=Select Mountain Stage");
  await page.getByText(stage.route, { exact: true }).click();
  await page.waitForSelector("text=Select Mountain Stage", { state: "detached" });

  await page.waitForFunction(
    (expectedName: string) => {
      const el = document.querySelector(".hud-topleft span.uppercase");
      return !!el && (el.textContent || "").trim().toUpperCase() === expectedName.toUpperCase();
    },
    stage.name,
    { timeout: 15_000 }
  );

  // Let rebuildTrack() finish swapping window.__vbSpline over.
  await page.waitForFunction(
    () =>
      !!(window as any).__vbSpline && (window as any).__vbSpline.totalLength > 0,
    { timeout: 15_000 }
  );
}

async function capturePose(page: Page, stage: StageMeta, pose: Pose): Promise<void> {
  await page.evaluate(
    ({ frac, height, ahead }: { frac: number; height: number; ahead: number }) => {
      const w = window as any;
      const spline = w.__vbSpline;
      const camera = w.__vbCamera;
      const renderer = w.__vbRenderer;

      const s0 = frac * spline.totalLength;
      const s1 = s0 + ahead; // getSampleAtS clamps internally to [0, totalLength]

      const at = spline.getSampleAtS(s0);
      const lookAt = spline.getSampleAtS(s1);

      camera.position.set(at.x, at.y + height, at.z);
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
      camera.updateMatrixWorld(true);

      renderer.renderOnce();
    },
    { frac: pose.frac, height: pose.height, ahead: pose.ahead }
  );

  const fileName = `${stage.id}--${pose.label}.png`;
  await page.screenshot({ path: path.join(OUT_DIR, fileName) });
  console.log(`  wrote ${fileName}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  try {
    console.log(`Navigating to ${BASE_URL} ...`);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    console.log("Waiting for game renderer to be ready ...");
    await waitForRendererReady(page);

    // Freeze the chase-camera render loop so our manual pose isn't overwritten
    // by the next animation frame before the screenshot lands.
    await page.evaluate(() => {
      (window as any).__vbRenderer.stop();
    });

    for (const stage of STAGES) {
      console.log(`Stage: ${stage.id}`);
      await selectStage(page, stage);

      for (const pose of POSES) {
        await capturePose(page, stage, pose);
      }
    }
  } finally {
    await browser.close();
  }

  console.log("");
  if (consoleErrors.length || pageErrors.length) {
    console.error(`Encountered ${consoleErrors.length} console error(s) and ${pageErrors.length} page error(s):`);
    for (const e of consoleErrors) console.error(`  [console] ${e}`);
    for (const e of pageErrors) console.error(`  [page] ${e}`);
    process.exitCode = 1;
  } else {
    console.log("No console or page errors observed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
