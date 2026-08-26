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
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  engine,
  car,
  colorIndex,
  spline,
  qualityTier = "high",
  onStateUpdate,
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
    renderer.start(engine, onStateUpdate);
    rendererRef.current = renderer;

    return () => {
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

  // Synchronize stage spline changes
  useEffect(() => {
    if (rendererRef.current && spline) {
      rendererRef.current.rebuildTrack(spline);
    }
  }, [spline]);

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

