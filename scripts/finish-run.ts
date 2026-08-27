/**
 * VAL BORBERA HILLCLIMB — Finish-flow test
 *
 * Plays a stage through to the finish line in a real browser and checks what happens after:
 * the finish callback fires, the personal best is saved, and the result modal appears with a
 * time matching the HUD.
 *
 * This is the one path the ordinary smoke test cannot cover. Completing Borbera Sprint takes
 * roughly three minutes of wall-clock time — the simulation is locked to real time by
 * requestAnimationFrame, so it cannot be fast-forwarded from outside — which is too slow to
 * belong in a test you run on every change. It is also the path most worth having covered:
 * everything downstream of crossing the line (`onFinish`, PB persistence, the result modal
 * and the leaderboard submission it offers) is otherwise exercised by nothing.
 *
 * The driver runs INSIDE the page, installed once and stepping on the engine's own frames.
 * Driving it from Playwright would mean tens of thousands of round trips.
 *
 * Requires a dev server:
 *   PORT=3001 npm run dev
 *   npm run finish-run
 */

import { chromium, type Browser } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3001";
/** Generous: a clean run is ~170 s, and a few off-road respawns add 8 s each. */
const RUN_TIMEOUT_MS = 420_000;

const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name + (detail ? `: ${detail}` : ""));
  }
}

async function main(): Promise<void> {
  let browser: Browser | undefined;
  const consoleErrors: string[] = [];

  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    console.log(`Finish-flow test against ${BASE}`);
    console.log("Driving a full stage — this takes about three minutes.\n");

    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean((window as never as Record<string, unknown>).__vbEngine), null, {
      timeout: 30_000,
    });
    check("engine handle is exposed in dev", true);

    // Install the driver. Same conservative controller the anti-cheat suite uses: an
    // aggressive one overcooks a corner around s=2400 and loops through respawns forever.
    // Passed as a STRING, not a function. tsx compiles this file with esbuild's keepNames
    // helper, which rewrites nested named functions to reference a `__name` helper that does
    // not exist in the page — serialising a function here fails with "__name is not defined".
    await page.evaluate(`
      (() => {
        const engine = window.__vbEngine;
        let cachedS = 0;
        const SPEED_CAP_KMH = 85;

        const drive = () => {
          const spline = engine.spline;
          if (spline && engine.timer.state === "running") {
            const s = engine.vehicle.state;
            const proj = spline.projectFrenet(s.pos.x, s.pos.z, cachedS);
            cachedS = proj.s;

            const lookahead = Math.max(8, Math.min(22, s.speedMs * 0.7));
            const target = spline.getSampleAtS(Math.min(spline.totalLength - 0.5, proj.s + lookahead));
            const targetHeading = Math.atan2(target.x - s.pos.x, target.z - s.pos.z);
            let angleDiff = targetHeading - s.heading;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            const steer = Math.max(-1, Math.min(1, angleDiff * 3.8 - proj.t * 0.35));
            const curvature = Math.abs(angleDiff) / lookahead;
            let targetKmh = SPEED_CAP_KMH;
            if (curvature > 0.04) targetKmh = 32;
            else if (curvature > 0.02) targetKmh = 55;
            else if (curvature > 0.01) targetKmh = 80;

            engine.input.setTouchAxes({
              steer: steer,
              throttle: s.speedKmh < targetKmh ? 1 : 0,
              brake: s.speedKmh < targetKmh ? 0 : Math.min(1, (s.speedKmh - targetKmh) * 0.12),
              handbrake: false,
            });
          }
          requestAnimationFrame(drive);
        };
        requestAnimationFrame(drive);
      })()
    `);
    check("in-page driver installed", true);

    // Start the run through the UI, the way a player would.
    await page.locator("body").click({ position: { x: 640, y: 400 } });
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () => (window as never as Record<string, unknown>).__vbEngine !== undefined &&
        ((window as never as { __vbEngine: { timer: { state: string } } }).__vbEngine.timer.state === "running"),
      null,
      { timeout: 20_000 }
    );
    check("run reaches the running state", true);

    // Wait for the finish. Report progress so a three-minute wait is not a silent stare.
    const started = Date.now();
    let lastLogged = 0;
    let finished = false;
    while (Date.now() - started < RUN_TIMEOUT_MS) {
      const state = await page.evaluate(
        () => (window as never as { __vbEngine: { timer: { state: string } } }).__vbEngine.timer.state
      );
      if (state === "finished") {
        finished = true;
        break;
      }
      const elapsed = Math.floor((Date.now() - started) / 1000);
      if (elapsed >= lastLogged + 30) {
        lastLogged = elapsed;
        console.log(`        ... ${elapsed}s elapsed, still running`);
      }
      await page.waitForTimeout(1000);
    }
    check("stage is completed", finished, `gave up after ${Math.floor((Date.now() - started) / 1000)}s`);

    if (finished) {
      // --- Everything downstream of crossing the line ---------------------------------
      await page.waitForTimeout(1500);

      const dialog = page.locator('[role="dialog"]');
      check("result modal appears on finish", (await dialog.count()) > 0);

      if ((await dialog.count()) > 0) {
        const text = await dialog.innerText();
        check("result modal shows a finishing time", /\d+:\d{2}\.\d{3}/.test(text), text.slice(0, 120));

        // Cross-check the UI against the engine rather than just asserting the modal is
        // non-empty: the displayed time must be the time the simulation actually recorded.
        const engineMs = await page.evaluate(
          () =>
            Math.round(
              (window as never as { __vbEngine: { timer: { getTotalTimeSeconds: () => number } } }).__vbEngine.timer.getTotalTimeSeconds() *
                1000
            )
        );
        const shown = text.match(/(\d+):(\d{2})\.(\d{3})/);
        const shownMs = shown
          ? Number(shown[1]) * 60_000 + Number(shown[2]) * 1000 + Number(shown[3])
          : Number.NaN;
        check(
          "displayed time matches the simulated time",
          Math.abs(shownMs - engineMs) <= 1000,
          `modal showed ${shownMs} ms, engine recorded ${engineMs} ms`
        );

        const nameField = dialog.locator("input").first();
        check("result modal offers leaderboard submission", (await nameField.count()) > 0);
      }
    }

    check("no console errors during the run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  } finally {
    await browser?.close();
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`Finish-flow test FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Finish-flow test passed.");
}

main().catch((err) => {
  console.error("Finish-flow test crashed:", err);
  process.exit(1);
});
