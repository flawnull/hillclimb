"use client";

import React from "react";
import { Flame } from "lucide-react";

interface SpeedometerProps {
  speedKmh: number;
  rpm: number;
  gear: number;
  maxRpm?: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  isSliding: boolean;
  slipAngle: number;
  driftScore: number;
  perkActive: boolean;
}

export const Speedometer: React.FC<SpeedometerProps> = ({
  speedKmh,
  rpm,
  gear,
  maxRpm = 7500,
  throttle,
  brake,
  handbrake,
  isSliding,
  slipAngle,
  driftScore,
  perkActive,
}) => {
  const roundedSpeed = Math.max(0, Math.round(speedKmh));
  const rpmPct = Math.min(100, Math.max(0, (rpm / maxRpm) * 100));
  const isRedline = rpm >= 6800;

  // LED Shift Light array (10 segments)
  const numLeds = 10;
  const activeLeds = Math.floor((rpmPct / 100) * numLeds);

  const gearText = gear <= 0 ? "R" : `${gear}`;

  return (
    <div className="hud-speedo pointer-events-none select-none font-mono">
      <div className="relative flex flex-col items-end bg-slate-950/85 backdrop-blur-md border border-slate-800/90 p-2 sm:p-3 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden w-[min(240px,calc(100vw-1.5rem))] sm:w-[240px]">
        {/* Perk Active Ambient Glow */}
        {perkActive && (
          <div className="absolute inset-0 bg-amber-500/10 border-2 border-amber-500/50 rounded-3xl animate-pulse pointer-events-none" />
        )}

        {/* LED Shift Light Bar */}
        <div className="hud-speedo-extra flex items-center gap-1 w-full justify-between mb-2">
          {Array.from({ length: numLeds }).map((_, i) => {
            const isActive = i < activeLeds;
            const isRed = i >= 7;
            const isYellow = i >= 4 && i < 7;

            let colorClass = "bg-slate-800/80";
            if (isActive) {
              if (isRed) {
                colorClass = isRedline
                  ? "bg-rose-500 shadow-md shadow-rose-500/80 animate-pulse"
                  : "bg-rose-500 shadow-sm shadow-rose-500/50";
              } else if (isYellow) {
                colorClass = "bg-amber-400 shadow-sm shadow-amber-400/50";
              } else {
                colorClass = "bg-emerald-400 shadow-sm shadow-emerald-400/50";
              }
            }

            return (
              <div
                key={i}
                className={`h-2 flex-1 rounded-sm transition-all duration-75 ${colorClass}`}
              />
            );
          })}
        </div>

        {/* Main Speed & Gear Row */}
        <div className="flex items-baseline justify-between w-full gap-2 sm:gap-4">
          {/* Current Gear */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-slate-400">
              GEAR
            </span>
            <span
              className={`text-3xl sm:text-4xl font-black italic tracking-tighter ${
                isRedline ? "text-rose-400 animate-pulse" : "text-amber-400"
              }`}
            >
              {gearText}
            </span>
          </div>

          {/* Speed Digital Readout */}
          <div className="flex flex-col items-end">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl sm:text-5xl font-black italic tracking-tighter text-white drop-shadow-md">
                {roundedSpeed}
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-400 tracking-wider uppercase">
                KM/H
              </span>
            </div>

            {/* RPM Display */}
            <div className="text-[10px] text-slate-400 tracking-widest uppercase">
              <span className={isRedline ? "text-rose-400 font-bold" : "text-slate-300"}>
                {Math.round(rpm)}
              </span>{" "}
              RPM
            </div>
          </div>
        </div>

        {/* Telemetry Input Bars (Throttle & Brake) */}
        <div className="hud-speedo-extra flex items-center gap-2 w-full mt-2 pt-2 border-t border-slate-800/80">
          {/* Throttle Bar */}
          <div className="flex-1 flex items-center gap-1.5">
            <span className="text-[8px] font-bold text-emerald-400">THR</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all duration-75"
                style={{ width: `${Math.round(throttle * 100)}%` }}
              />
            </div>
          </div>

          {/* Brake Bar */}
          <div className="flex-1 flex items-center gap-1.5">
            <span className="text-[8px] font-bold text-rose-400">BRK</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-75 ${
                  handbrake ? "bg-amber-400" : "bg-rose-500"
                }`}
                style={{ width: `${handbrake ? 100 : Math.round(brake * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Drift / Slide Angle Indicator */}
        {(isSliding || driftScore > 0) && (
          <div className="flex items-center justify-between w-full mt-1.5 text-[10px] bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded-lg">
            <div className="flex items-center gap-1 text-amber-300 font-bold">
              <Flame className="w-3 h-3 text-amber-400 animate-bounce" />
              <span>DRIFT {Math.abs(Math.round(slipAngle * 57.3))}°</span>
            </div>
            <span className="text-amber-400 font-bold font-mono">
              +{Math.round(driftScore)} PTS
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
