/**
 * VAL BORBERA HILLCLIMB — End-to-end smoke test
 *
 * The unit suite covers physics, terrain geometry and anti-cheat validation, but nothing
 * exercised the actual game loop in a browser: mount the engine, start a run, drive, watch
 * the timer advance, use the keyboard shortcuts, open and close a modal. Those paths span
 * React, the imperative renderer and the input layer at once, which is exactly where a
 * regression hides from `npm test`.
 *
 * Requires a dev server. Defaults to http://localhost:3001 to avoid colliding with a server
 * you may already be running on 3000:
 *
 *   PORT=3001 npm run dev
 *   npm run smoke
 *
 * Exits non-zero on any failed check or console error, so it is CI-usable as-is.
 */

import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3001";

const failures: string[] = [];
const consoleErrors: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name + (detail ? `: ${detail}` : ""));
  }
}

/** Digits shown in the speedometer's KM/H readout. */
async function readSpeed(page: Page): Promise<number> {
  const text = await page.locator(".hud-speedo").innerText();
  const match = text.match(/(\d+)\s*KM\/H/i);
  return match ? Number(match[1]) : Number.NaN;
}

/** Elapsed time in the top-centre timer, as milliseconds. */
async function readTimerMs(page: Page): Promise<number> {
  const text = await page.locator(".hud-timer").innerText();
  const match = text.match(/(\d+):(\d{2})\.(\d{3})/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number(match[3]);
}

async function main(): Promise<void> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    console.log(`Smoke test against ${BASE}`);
    await page.goto(BASE, { waitUntil: "networkidle" });

    // --- The game mounts and the renderer comes up -------------------------------------
    await page.waitForFunction(() => Boolean((window as never as Record<string, unknown>).__vbScene), null, {
      timeout: 30_000,
    });
    check("renderer initialises", true);
    check("canvas is present", (await page.locator("canvas").count()) > 0);
    check("HUD renders", (await page.locator(".hud-speedo").count()) > 0);

    // --- A run starts and the car actually moves ---------------------------------------
    const speedBefore = await readSpeed(page);
    check("car is stationary before start", speedBefore === 0, `speed was ${speedBefore}`);

    // Don't press Space on a blind timer: the renderer being up does not mean React has
    // hydrated its keydown handler yet, and a press that lands early is simply dropped.
    // Press, wait for the timer to actually start, and retry a couple of times.
    let running = false;
    for (let attempt = 0; attempt < 3 && !running; attempt++) {
      await page.locator("body").click({ position: { x: 640, y: 400 } });
      await page.keyboard.press("Space");
      // 3-2-1 countdown, then the clock starts.
      for (let waited = 0; waited < 9000; waited += 500) {
        await page.waitForTimeout(500);
        if ((await readTimerMs(page)) > 0) {
          running = true;
          break;
        }
      }
    }
    check("run starts on Space", running, "timer never advanced past 0");

    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(3000);

    const speedDriving = await readSpeed(page);
    const timerDriving = await readTimerMs(page);
    await page.keyboard.up("ArrowUp");

    check("car accelerates under throttle", speedDriving > 5, `speed was ${speedDriving} km/h`);
    check("timer advances during a run", timerDriving > 0, `timer read ${timerDriving} ms`);

    await page.waitForTimeout(1200);
    const timerLater = await readTimerMs(page);
    check("timer keeps running", timerLater > timerDriving, `${timerLater} !> ${timerDriving}`);

    // --- Keyboard shortcut: R resets the run -------------------------------------------
    await page.keyboard.press("KeyR");
    await page.waitForTimeout(600);
    const timerAfterReset = await readTimerMs(page);
    check("R resets the run", timerAfterReset < timerLater, `timer still at ${timerAfterReset} ms`);

    // --- Modal accessibility: opens, traps focus, closes on Escape ---------------------
    await page.keyboard.press("KeyL");
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"]');
    check("leaderboard modal opens with a dialog role", (await dialog.count()) > 0);

    if ((await dialog.count()) > 0) {
      const focusInside = await page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"]');
        return Boolean(panel && document.activeElement && panel.contains(document.activeElement));
      });
      check("focus moves inside the dialog", focusInside);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      check("Escape closes the dialog", (await page.locator('[role="dialog"]').count()) === 0);
    }

    // --- The typing guard: shortcuts must not fire while a field has focus -------------
    // Regression guard. The global handler used to fire on any keydown, so typing a name
    // containing "r" reset the run and closed the result modal out from under the player.
    await page.keyboard.press("KeyT");
    await page.waitForTimeout(500);
    const tuningOpen = (await page.locator('[role="dialog"]').count()) > 0;
    check("tuning panel opens", tuningOpen);

    if (tuningOpen) {
      const field = page.locator('[role="dialog"] input').first();
      if ((await field.count()) > 0) {
        await field.focus();
        // "T" toggles the tuning panel — but only when the player is not typing. With a
        // form control focused the global handler must ignore it entirely.
        await page.keyboard.press("KeyT");
        await page.waitForTimeout(400);
        check(
          "shortcuts do not fire while a form control has focus",
          (await page.locator('[role="dialog"]').count()) > 0,
          "pressing T with an input focused closed the panel"
        );
      } else {
        console.log("  skip  tuning panel exposes no form control to focus");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    check("no console errors during the session", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  } finally {
    await browser?.close();
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`Smoke test FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Smoke test passed.");
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
