"use client";

import React from "react";
import { StageDef } from "@/game/track/TrackSpline";
import {
  Sliders,
  RotateCcw,
  Mountain,
  Car,
  Volume2,
  VolumeX,
  Trophy,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface HudTopBarProps {
  stageDef: StageDef;
  onOpenStageModal: () => void;
  selectedCarId: string;
  onPrevCar: () => void;
  onNextCar: () => void;
  onResetRun: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onOpenLeaderboard: () => void;
  showTuningPanel: boolean;
  onToggleTuningPanel: () => void;
  /** Rendered between the stage banner (topleft) and the action cluster
   *  (topright) so DOM/tab order matches the visual row despite the two
   *  halves living in separate CSS grid areas. */
  children?: React.ReactNode;
}

/**
 * Presentational top HUD row: stage banner + car selector (top-left), and
 * the global action buttons (top-right). Purely visual — all state and
 * handlers are owned by the caller.
 */
export function HudTopBar({
  stageDef,
  onOpenStageModal,
  selectedCarId,
  onPrevCar,
  onNextCar,
  onResetRun,
  isMuted,
  onToggleMute,
  onOpenLeaderboard,
  showTuningPanel,
  onToggleTuningPanel,
  children,
}: HudTopBarProps) {
  return (
    <>
      {/* Stage & Car Info Banner (top-left) */}
      <div className="hud-topleft flex flex-col items-start gap-1.5 pointer-events-auto min-w-0 max-w-full">
        <button
          onClick={onOpenStageModal}
          className="hud-btn flex items-center gap-2 min-w-0 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 hover:border-amber-500/50 px-2.5 sm:px-3 py-1.5 rounded-xl shadow-xl transition active:scale-95 group"
        >
          <Mountain className="w-4 h-4 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" />
          <div className="flex flex-col text-left min-w-0">
            <span className="text-[11px] sm:text-xs font-mono font-bold text-white tracking-wider uppercase truncate">
              {stageDef.name}
            </span>
            <span className="hidden sm:block text-[10px] text-slate-400 font-mono truncate">
              {(stageDef.length / 1000).toFixed(1)} km · {stageDef.subtitle}
            </span>
            <span className="sm:hidden text-[10px] text-slate-400 font-mono truncate">
              {(stageDef.length / 1000).toFixed(1)} km
            </span>
          </div>
        </button>

        {/* Compact Car Selector Docked Cleanly */}
        <div className="flex items-center gap-1 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 p-1 rounded-xl shadow-xl">
          <button
            onClick={onPrevCar}
            aria-label="Previous car"
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 px-1 min-w-[70px] sm:min-w-[80px] justify-center text-amber-500 font-mono font-bold text-[11px] sm:text-xs">
            <Car className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {selectedCarId === "weiss-blau-30" ? "Weiss-Blau" : selectedCarId === "lanzo-alta-4wd" ? "Lanzo" : selectedCarId === "pandino-4x4" ? "Pandino" : "Alpe"}
            </span>
          </div>
          <button
            onClick={onNextCar}
            aria-label="Next car"
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {children}

      {/* Global Action Controls (top-right) */}
      <div className="hud-topright flex flex-wrap justify-end items-center gap-1.5 sm:gap-2 pointer-events-auto">
        {/* Quick Reset Button */}
        <button
          onClick={onResetRun}
          className="hud-btn flex items-center justify-center p-2 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 hover:border-amber-500/60 rounded-xl text-slate-300 hover:text-white transition shadow-lg active:scale-95"
          title="Reset to Start (R)"
          aria-label="Reset to start"
        >
          <RotateCcw className="w-4 h-4 text-amber-400" />
        </button>

        {/* Audio Mute Toggle */}
        <button
          onClick={onToggleMute}
          className="hud-btn flex items-center justify-center p-2 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 hover:border-slate-600 rounded-xl text-slate-400 hover:text-white transition shadow-lg active:scale-95"
          title={isMuted ? "Unmute Engine Audio" : "Mute Engine Audio"}
          aria-label={isMuted ? "Unmute engine audio" : "Mute engine audio"}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
        </button>

        {/* Leaderboard Modal Button */}
        <button
          onClick={onOpenLeaderboard}
          className="hud-btn flex items-center justify-center gap-1.5 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 hover:border-amber-500/50 px-2 sm:px-3 py-1.5 rounded-xl text-xs font-mono font-bold text-slate-200 hover:text-white transition shadow-lg active:scale-95"
          title="Global Leaderboard (L)"
          aria-label="Open global leaderboard"
        >
          <Trophy className="w-4 h-4 text-amber-400" />
          <span className="hidden lg:inline">LEADERBOARD</span>
        </button>

        {/* Tuning / Settings Button */}
        <button
          onClick={onToggleTuningPanel}
          className={`hud-btn flex items-center justify-center p-2 bg-slate-950/85 backdrop-blur-md border rounded-xl transition shadow-lg active:scale-95 ${
            showTuningPanel
              ? "border-amber-500 text-amber-400"
              : "border-slate-800/90 text-slate-400 hover:text-white hover:border-slate-600"
          }`}
          title="Vehicle Tuning & Assists (T)"
          aria-label="Toggle vehicle tuning panel"
          aria-pressed={showTuningPanel}
        >
          <Sliders className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}
