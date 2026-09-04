"use client";

import React, { useEffect, useRef } from "react";
import { Engine, EngineRenderState } from "@/game/Engine";
import { CarDef } from "@/game/vehicle/cars";
import { TrackSpline } from "@/game/track/TrackSpline";
import { GameRenderer } from "@/game/renderer/GameRenderer";
import { QualityTier } from "@/store/gameStore";

interface GameCanvasProps {
  engine: Engine;
  renderStateRef: React.MutableRefObject<EngineRenderState>;
  car: CarDef;
  colorIndex: number;
  spline?: TrackSpline;
  qualityTier?: QualityTier;
  onStateUpdate?: (s: EngineRenderState) => void;
  /** 0..1 across the stage build. See the async build in the effect below. */
  onBuildProgress?: (fraction: number) => void;
  /** True while a stage is being generated — on first load AND on every stage switch. */
  onBuildingChange?: (building: boolean) => void;
}

/**
 * Hands control back to the browser between chunks of terrain generation.
 *
 * The primitive matters more than anything else about the pacing, and the two obvious
 * choices are both wrong:
 *
 *   requestAnimationFrame — measured HALF the frame rate (17.5 fps against 35.3). A chunk
 *   that overruns the frame it started in makes the yield wait for the next vsync, so
 *   every overrun costs a whole frame rather than a few milliseconds.
 *
 *   MessageChannel — the classic unclamped macrotask, and what React's scheduler uses for
 *   its own work loop. Measured here it STARVES rendering: 5.2 fps, with frames as long as
 *   a second, because the continuation is queued so eagerly that the browser never reaches
 *   a paint. It is the right primitive for work that must not be starved, and the wrong one
 *   for work whose entire purpose is to leave room for painting.
 *
 * `setTimeout(0)` is the one that leaves the browser room. It is clamped to roughly 4 ms
 * once nesting passes five levels, which is real overhead, but that overhead IS the gap the
 * paint happens in. `scheduler.yield()` is the standardised primitive for exactly this and
 * is preferred where it exists.
 */
function makeYield(): () => Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") {
    return () => scheduler.yield!();
  }
  return () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  engine,
  car,
  colorIndex,
  spline,
  qualityTier = "high",
  onStateUpdate,
  onBuildProgress,
  onBuildingChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // A WebGLRenderer owns the canvas's GL context, so exactly one may exist per canvas.
    // React StrictMode mounts effects twice in development: the first renderer was
    // created, then destroyed (disposing the context), and the second was built on the
    // now-dead context. Both ended up drawing to the same canvas, which is why the idle
    // view showed a stale camera 556 m below the road while the running view was fine.
    //
    // Cache the renderer on the canvas node and reuse it across remounts. Cleanup only
    // stops the loop; the context is released in disposeCanvasRenderer when the canvas
    // itself goes away.
    type CanvasWithRenderer = HTMLCanvasElement & { __vbRenderer?: GameRenderer };
    const host = canvas as CanvasWithRenderer;

    let renderer = host.__vbRenderer;
    if (!renderer) {
      renderer = new GameRenderer(canvas, car, colorIndex, spline);
      host.__vbRenderer = renderer;
    }

    renderer.setQualityTier(qualityTier);
    rendererRef.current = renderer;

    // Build the track asynchronously, then start the loop.
    //
    // Terrain generation takes two and a half to three and a half seconds and used to run
    // inside the GameRenderer constructor, where it blocked the browser for the whole
    // duration: the loading screen appeared, froze solid, and vanished. Nothing could be
    // painted, so no animation on it could ever run. It is now built a slice at a time with
    // a macrotask between slices, which lets the page paint and report real progress.
    //
    let cancelled = false;
    const yieldTo = makeYield();

    void (async () => {
      if (spline && !renderer.hasTrack()) {
        onBuildingChange?.(true);
        await renderer.rebuildTrackAsync(spline, yieldTo, onBuildProgress);
        onBuildingChange?.(false);
      }
      if (!cancelled) renderer.start(engine, onStateUpdate);
    })();

    return () => {
      cancelled = true;
      renderer?.stop();
    };
  }, [engine]);

  // Release the GL context when the canvas is genuinely unmounted.
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      const host = canvas as (HTMLCanvasElement & { __vbRenderer?: GameRenderer }) | null;
      if (host?.__vbRenderer && !host.isConnected) {
        host.__vbRenderer.destroy();
        delete host.__vbRenderer;
      }
    };
  }, []);

  // Synchronize stage spline changes. Skips the spline the initial build already used, so
  // the two cannot race on first mount.
  const builtSplineRef = useRef<TrackSpline | undefined>(undefined);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !spline) return;
    if (builtSplineRef.current === undefined) {
      builtSplineRef.current = spline;
      return;
    }
    if (builtSplineRef.current === spline) return;
    builtSplineRef.current = spline;
    const yieldTo = makeYield();
    // The veil comes back for a stage switch too. `prepareTrack` clears the old terrain
    // before the new one starts generating, so without this the player watches a road and
    // a row of houses hanging in an empty sky for the several seconds the build takes.
    onBuildingChange?.(true);
    onBuildProgress?.(0);
    void renderer
      .rebuildTrackAsync(spline, yieldTo, onBuildProgress)
      .then(() => onBuildingChange?.(false));
  }, [spline, onBuildProgress, onBuildingChange]);

  // Synchronize car definition and colorway changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCar(car, colorIndex);
    }
  }, [car, colorIndex]);

  // Synchronize quality tier
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setQualityTier(qualityTier);
    }
  }, [qualityTier]);

  return (
    <div className="relative w-full h-full bg-slate-950 select-none overflow-hidden touch-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full block touch-none cursor-grab active:cursor-grabbing"
      />
    </div>
  );
};

export default GameCanvas;

