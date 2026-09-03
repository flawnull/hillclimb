import { chromium } from "playwright";
const DRIVER = `
  (() => {
    const engine = window.__vbEngine;
    let cachedS = 0;
    const SPEED_CAP_KMH = 85;
    window.__trace = [];
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
        const steer = Math.max(-1, Math.min(1, -(angleDiff * 3.8 - proj.t * 0.35)));
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
        window.__trace.push({ s: proj.s, t: proj.t, v: s.speedKmh, steer: steer });
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  })()
`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto("http://localhost:3001", { waitUntil: "networkidle" });
  await p.waitForFunction(() => !!(window as any).__vbEngine, { timeout: 30000 });
  await p.evaluate(DRIVER);
  await p.locator("body").click({ position: { x: 640, y: 400 } });
  await p.keyboard.press("Space");
  await p.waitForFunction(() => (window as any).__vbEngine.timer.state === "running", null, { timeout: 20000 });
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(15000);
    const r = await p.evaluate(() => {
      const w = window as any; const t = w.__trace; const last = t[t.length - 1] || {};
      const recent = t.slice(-600);
      return { n: t.length, s: last.s, v: last.v, t: last.t, steer: last.steer,
        respawns: w.__vbEngine.update(0).respawnCount,
        penalty: w.__vbEngine.timer.totalPenaltySeconds,
        state: w.__vbEngine.timer.state,
        minS: Math.min(...recent.map((x: any) => x.s)), maxS: Math.max(...recent.map((x: any) => x.s)) };
    });
    console.log(`${(i+1)*15}s  s=${(r.s||0).toFixed(0)}/${""} v=${(r.v||0).toFixed(0)}km/h t=${(r.t||0).toFixed(1)} steer=${(r.steer||0).toFixed(2)} respawns=${r.respawns} penalty=${r.penalty.toFixed(0)}s  last10s s-range ${r.minS.toFixed(0)}..${r.maxS.toFixed(0)}  state=${r.state}`);
    if (r.state === "finished") break;
  }
  await b.close();
})();
