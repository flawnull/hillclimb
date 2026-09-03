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
    // `setTimeout(0)` rather than rAF: a rAF callback runs BEFORE paint, so yielding to one
    // hands control back without the frame having been drawn. A macrotask lets the frame
    // complete first, which is the point.
    let cancelled = false;
    const yieldTo = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

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
    const yieldTo = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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

