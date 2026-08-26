"use client";

import React, { useEffect, useState } from "react";
import { RunState, SplitRecord, PenaltyEvent } from "@/game/timing/Timer";
import { StageDef } from "@/game/track/TrackSpline";

interface TimerDisplayProps {
  runState: RunState;
  elapsedSeconds: number;
  totalPenaltySeconds: number;
  lastSplit?: SplitRecord;
  lastPenalty?: PenaltyEvent;
  stage: StageDef;
  currentHairpin: number;
}

export const TimerDisplay: React.FC<TimerDisplayProps> = ({
  runState,
  elapsedSeconds,
  totalPenaltySeconds,
  lastSplit,
  lastPenalty,
  stage,
  currentHairpin,
}) => {
  const [splitFlash, setSplitFlash] = useState<SplitRecord | null>(null);
  const [penaltyFlash, setPenaltyFlash] = useState<PenaltyEvent | null>(null);

  // Flash split delta for 2.5s (§10.2)
  useEffect(() => {
    if (lastSplit) {
      setSplitFlash(lastSplit);
      const timer = setTimeout(() => setSplitFlash(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [lastSplit]);

  // Flash penalty for 2.0s
  useEffect(() => {
    if (lastPenalty) {
      setPenaltyFlash(lastPenalty);
      const timer = setTimeout(() => setPenaltyFlash(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [lastPenalty]);

  // Format time M:SS.mmm
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = Math.floor(elapsedSeconds % 60);
  const ms = Math.floor((elapsedSeconds * 1000) % 1000);
  const timeFormatted = `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

  return (
    <>
      {/* 3-2-1-GO Big Center Countdown */}
      {runState.startsWith("countdown_") && (
        <div className="hud-stage-overlay z-40 flex items-center justify-center pointer-events-none font-mono select-none">
          <div className="text-7xl sm:text-9xl font-black italic tracking-tighter text-amber-400 drop-shadow-[0_0_35px_rgba(245,158,11,0.8)] animate-ping">
            {runState === "countdown_3" ? "3" : runState === "countdown_2" ? "2" : "1"}
          </div>
        </div>
      )}

      {/* Top-Center Timing Screen */}
      <div className="hud-timer relative pointer-events-none flex flex-col items-center font-mono select-none">
        {/* Main Timer Display */}
        <div className="flex items-center gap-2 sm:gap-3 bg-slate-950/90 backdrop-blur-md border border-slate-800 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-2xl shadow-2xl">
          {/* Main Elapsed Time */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] tracking-widest text-slate-400 uppercase font-sans font-bold">
              Time Attack
            </span>
            <div className="text-lg sm:text-2xl font-black italic text-white tracking-tight tabular-nums">
              {timeFormatted}
            </div>
          </div>

          {/* Penalties Badge if any */}
          {totalPenaltySeconds > 0 && (
            <div className="flex flex-col items-center border-l border-slate-800 pl-2 sm:pl-3">
              <span className="text-[9px] tracking-widest text-rose-400 uppercase font-sans font-bold">
                Penalty
              </span>
              <span className="text-xs sm:text-sm font-bold text-rose-400">
                +{totalPenaltySeconds.toFixed(1)}s
              </span>
            </div>
          )}

          {/* Hairpin / Tornanti Counter (§10.2) */}
          {stage.totalHairpins > 0 && (
            <div className="flex flex-col items-center border-l border-slate-800 pl-2 sm:pl-3">
              <span className="text-[9px] tracking-widest text-amber-400 uppercase font-sans font-bold">
                Tornanti
              </span>
              <span className="text-xs sm:text-sm font-bold text-amber-300">
                {currentHairpin} / {stage.totalHairpins}
              </span>
            </div>
          )}
        </div>

        {/* Transient toasts float below the panel (absolute) so they never grow
            the HUD grid row and shove the timer around mid-run. */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 flex flex-col items-center gap-1 w-max max-w-[80vw]">
          {/* Checkpoint Split Delta Flash (-1.24s green / +0.86s red) */}
          {splitFlash && splitFlash.deltaPB !== undefined && (
            <div
              className={`whitespace-nowrap px-3 py-1 rounded-xl text-xs font-black tracking-wider shadow-xl backdrop-blur-md border animate-bounce ${
                splitFlash.deltaPB <= 0
                  ? "bg-emerald-950/95 text-emerald-300 border-emerald-500/80 shadow-emerald-500/30"
                  : "bg-rose-950/95 text-rose-300 border-rose-500/80 shadow-rose-500/30"
              }`}
            >
              SPLIT {splitFlash.checkpointIndex + 1}: {splitFlash.deltaPB <= 0 ? "" : "+"}
              {splitFlash.deltaPB.toFixed(2)}s
            </div>
          )}

          {/* Penalty Toast */}
          {penaltyFlash && (
            <div className="whitespace-nowrap px-3 py-1 rounded-xl text-xs font-black tracking-wider bg-rose-600 text-white shadow-2xl shadow-rose-600/50 border border-rose-400 animate-pulse">
              {penaltyFlash.message}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
