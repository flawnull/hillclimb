"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { Engine } from "@/game/Engine";
import { TouchController, TouchSliderState } from "@/game/input/touch";

interface TouchControlsProps {
  engine: Engine;
}

export const TouchControls: React.FC<TouchControlsProps> = ({ engine }) => {
  const touchControllerRef = useRef<TouchController | null>(null);
  const [sliderVisual, setSliderVisual] = useState<TouchSliderState>({
    active: false,
    anchorX: 0,
    anchorY: 0,
    currentX: 0,
    currentY: 0,
    steer: 0,
  });

  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new TouchController(engine.input, 60);
    controller.onStateChange((state) => {
      setSliderVisual(state);
    });
    touchControllerRef.current = controller;

    return () => {
      controller.destroy();
    };
  }, [engine]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Capture on the ZONE, not on `e.target`. The target is whichever child the finger
    // happened to land on — the guide track, the label, or the floating knob, which is
    // conditionally rendered and unmounts the moment steering goes inactive. An element
    // that unmounts while holding pointer capture stops receiving events altogether, so
    // the `pointerup` never arrived and the steering axis stayed latched at its last
    // value. TouchController now also listens on window as a backstop.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    touchControllerRef.current?.handlePointerDown(e);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    touchControllerRef.current?.handlePointerMove(e);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignored: the capture may already have been lost, which is exactly the case the
      // window-level listener in TouchController exists to cover.
    }
    touchControllerRef.current?.handlePointerUp(e);
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    touchControllerRef.current?.handlePointerCancel(e);
  }, []);

  const setThrottle = (val: number) => {
    if (val > 0 && engine.timer.state === "ready") {
      engine.startCountdown();
    }
    engine.input.setTouchAxes({ throttle: val });
  };

  const setBrake = (val: number) => {
    if (val > 0 && engine.timer.state === "ready") {
      engine.startCountdown();
    }
    engine.input.setTouchAxes({ brake: val });
  };

  const setHandbrake = (val: boolean) => {
    if (val && engine.timer.state === "ready") {
      engine.startCountdown();
    }
    engine.input.setTouchAxes({ handbrake: val });
  };

  return (
    // `display: contents` (.hud-controls): this component owns the pointer
    // plumbing, but its three groups are laid out by the HUD grid in
    // app/globals.css so they can never overlap the speedometer or each other.
    <div className="hud-controls">
      {/* Left: Relative-Anchor Analog Steering Zone (§9.1) */}
      <div
        ref={zoneRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="hud-botleft hud-steer hud-steer-surface relative bg-slate-950/60 active:bg-slate-900/80 border border-slate-800/80 rounded-3xl backdrop-blur-md flex flex-col items-center justify-center cursor-grab active:cursor-grabbing shadow-2xl overflow-hidden touch-none select-none"
      >
        {/* Guide track. The whole pad is the drag surface (§9.1, relative anchor), but a
            10px hairline in a large empty box read as decoration rather than as the
            primary control, so the track is sized to look like what it is. */}
        <div className="w-[88%] h-5 bg-slate-800/90 rounded-full flex items-center justify-between px-2.5 border border-slate-700/60 shadow-inner">
          <span className="text-[11px] font-mono text-slate-400 font-bold leading-none">◀ L</span>
          <div className="w-1 h-4 bg-amber-500/90 rounded-full" />
          <span className="text-[11px] font-mono text-slate-400 font-bold leading-none">R ▶</span>
        </div>

        <span className="text-[11px] font-mono text-slate-300 mt-2.5 tracking-wider font-semibold uppercase text-center px-1 leading-tight">
          {sliderVisual.active
            ? `Steer: ${(sliderVisual.steer * 100).toFixed(0)}%`
            : "Drag to Steer"}
        </span>

        {/* Floating Slider Knob */}
        {sliderVisual.active && (
          <div
            className="absolute w-12 h-12 -ml-6 -mt-6 rounded-full bg-amber-500 border-2 border-amber-200 shadow-lg shadow-amber-500/50 pointer-events-none transition-transform duration-75 flex items-center justify-center"
            style={{
              left: `${50 + sliderVisual.steer * 35}%`,
              top: "45%",
            }}
          >
            <div className="w-4 h-4 rounded-full bg-slate-950/90" />
          </div>
        )}
      </div>

      {/* Centre: Handbrake (bottom-centre in both orientations, §9.1) */}
      <div className="hud-botcenter flex items-end justify-center pointer-events-none">
        <button
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            touchControllerRef.current?.pressButton(e.pointerId, "handbrake");
            setHandbrake(true);
          }}
          onPointerUp={(e) => {
            try {
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            } catch {}
            touchControllerRef.current?.releaseButton(e.pointerId);
            setHandbrake(false);
          }}
          onPointerCancel={(e) => {
            touchControllerRef.current?.releaseButton(e.pointerId);
            setHandbrake(false);
          }}
          className="hud-handbrake pointer-events-auto px-2.5 sm:px-4 bg-rose-950/85 active:bg-rose-600 border-2 border-rose-700/90 active:border-rose-300 rounded-2xl text-[10px] sm:text-xs font-mono font-black tracking-wider text-rose-200 active:text-white uppercase active:scale-95 transition-transform backdrop-blur-md shadow-2xl touch-none leading-none flex flex-col items-center justify-center gap-0.5"
        >
          <span>HAND</span>
          <span>BRAKE</span>
        </button>
      </div>

      {/* Right: Throttle & Brake Pedals */}
      <div className="hud-botright flex flex-col justify-end items-end gap-2 pointer-events-none">
        {/* Brake Pedal */}
        <button
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            touchControllerRef.current?.pressButton(e.pointerId, "brake");
            setBrake(1.0);
          }}
          onPointerUp={(e) => {
            try {
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            } catch {}
            touchControllerRef.current?.releaseButton(e.pointerId);
            setBrake(0.0);
          }}
          onPointerCancel={(e) => {
            touchControllerRef.current?.releaseButton(e.pointerId);
            setBrake(0.0);
          }}
          className="hud-pedal hud-pedal-brake pointer-events-auto bg-rose-900/80 active:bg-rose-600 border-2 border-rose-600/90 active:border-rose-300 rounded-2xl flex items-center justify-center text-[11px] sm:text-sm font-mono font-black text-rose-100 active:scale-95 transition-transform backdrop-blur-md shadow-2xl touch-none"
        >
          BRAKE ▼
        </button>

        {/* Gas Pedal */}
        <button
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            touchControllerRef.current?.pressButton(e.pointerId, "throttle");
            setThrottle(1.0);
          }}
          onPointerUp={(e) => {
            try {
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            } catch {}
            touchControllerRef.current?.releaseButton(e.pointerId);
            setThrottle(0.0);
          }}
          onPointerCancel={(e) => {
            touchControllerRef.current?.releaseButton(e.pointerId);
            setThrottle(0.0);
          }}
          className="hud-pedal hud-pedal-gas pointer-events-auto bg-emerald-800/90 active:bg-emerald-500 border-2 border-emerald-500 active:border-emerald-200 rounded-2xl flex items-center justify-center text-[11px] sm:text-sm font-mono font-black text-emerald-100 active:scale-95 transition-transform backdrop-blur-md shadow-2xl touch-none"
        >
          GAS ▲
        </button>
      </div>
    </div>
  );
};
