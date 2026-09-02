"use client";

import React, { useMemo } from "react";
import { StageDef } from "@/game/track/TrackSpline";
import { ExposureSide } from "@/game/track/TrackSpline";

interface AltimeterProps {
  stage: StageDef;
  currentAltitude: number;
  currentS: number;
  exposure: ExposureSide;
  dropDepth: number;
}

export const Altimeter: React.FC<AltimeterProps> = ({
  stage,
  currentAltitude,
  currentS,
  exposure,
  dropDepth,
}) => {
  const minAlt = stage.minAltitude || 400;
  const maxAlt = stage.maxAltitude || 1700;
  const altRange = maxAlt - minAlt || 1;

  // Interior tick altitudes. The mid tick used to be a hardcoded "1000m" pinned at 50%,
  // which read as 1000 m sitting between 452 m and 560 m on Borbera Sprint. Pick a round
  // step that yields 2-4 interior marks and place each at its true height.
  const tickStep = altRange > 900 ? 500 : altRange > 400 ? 250 : altRange > 160 ? 100 : 50;
  const interiorTicks: number[] = [];
  // Keep clear of the min/max labels pinned at top and bottom — at 8% the 550 m tick
  // collided with the 560 m summit label on Borbera Sprint and the two overlapped.
  const TICK_EDGE_MARGIN = 0.16;
  for (
    let a = Math.ceil((minAlt + altRange * TICK_EDGE_MARGIN) / tickStep) * tickStep;
    a < maxAlt - altRange * TICK_EDGE_MARGIN;
    a += tickStep
  ) {
    interiorTicks.push(a);
  }

  // Normalized altitude position (0 at bottom, 1 at top)
  const normAlt = Math.max(0, Math.min(1, (currentAltitude - minAlt) / altRange));
  const markerBottomPercent = normAlt * 100;

  // Altitude climb delta from stage start
  const climbDelta = Math.round(currentAltitude - stage.startAltitude);
  const isClimb = climbDelta >= 0;

  // Exposure intensity mapping (§10.1: <80m faint, 80-200m amber, >200m red)
  const exposureLevel = useMemo(() => {
    if (exposure === "none" || dropDepth < 30) return "none";
    if (dropDepth < 80) return "faint";
    if (dropDepth < 200) return "amber";
    return "red";
  }, [exposure, dropDepth]);

  // Generate SVG Profile Path (Rotated so altitude is vertical)
  const svgPath = useMemo(() => {
    const pts = stage.points;
    if (!pts || pts.length < 2) return "";

    const width = 36;
    const height = 220;

    const coords = pts.map((p, i) => {
      const u = i / (pts.length - 1);
      const yNorm = (p.y - minAlt) / altRange;
      const x = 6 + (1 - u) * (width - 12);
      const y = height - (yNorm * (height - 20) + 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `M 4,${height} L ${coords.join(" L ")} L ${width - 4},${height} Z`;
  }, [stage, minAlt, altRange]);

  return (
    <>
      {/* Dynamic Screen Edge Exposure Glow / Vignette */}
      {exposureLevel === "red" && (
        <div
          className={`fixed top-0 h-[var(--stage-h)] pointer-events-none z-30 transition-opacity duration-300 ${
            exposure === "left" || exposure === "both"
              ? "left-0 w-32 bg-gradient-to-r from-red-600/30 to-transparent"
              : ""
          }`}
        />
      )}
      {exposureLevel === "red" && (
        <div
          className={`fixed top-0 h-[var(--stage-h)] pointer-events-none z-30 transition-opacity duration-300 ${
            exposure === "right" || exposure === "both"
              ? "right-0 w-32 bg-gradient-to-l from-red-600/30 to-transparent"
              : ""
          }`}
        />
      )}

      {/* Altimeter Ribbon (Pinned to Right Edge) */}
      <aside className="hud-midright pointer-events-none flex items-center justify-end font-mono select-none">
        {/* Altitude Numeric Chip & Delta Readout */}
        <div className="flex flex-col items-end mr-1.5 sm:mr-2 bg-slate-950/90 backdrop-blur-md border border-slate-800/80 px-2 py-1.5 rounded-xl shadow-2xl">
          <div className="flex items-baseline gap-1 text-amber-400 font-black text-sm sm:text-base tracking-tight">
            <span>{Math.round(currentAltitude)}</span>
            <span className="text-[10px] text-slate-400 font-semibold">m</span>
          </div>

          <div className="flex items-center gap-1 text-[10px] font-bold">
            <span className={isClimb ? "text-emerald-400" : "text-cyan-400"}>
              {isClimb ? "▲" : "▼"} {isClimb ? `+${climbDelta}` : climbDelta} m
            </span>
          </div>

          {/* Exposure Warning Badge */}
          {exposureLevel !== "none" && (
            <div
              className={`mt-1 text-[9px] px-1.5 py-0.5 rounded font-black tracking-wider uppercase flex items-center gap-1 ${
                exposureLevel === "red"
                  ? "bg-red-950/90 text-red-400 border border-red-600/60 animate-pulse"
                  : exposureLevel === "amber"
                  ? "bg-amber-950/90 text-amber-400 border border-amber-600/50"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              <span>{Math.round(dropDepth)}m DROP</span>
            </div>
          )}
        </div>

        {/* Vertical Profile Strip */}
        <div className="hud-altimeter-strip relative w-9 sm:w-12 bg-slate-950/90 backdrop-blur-md border border-slate-800/90 rounded-2xl p-1 shadow-2xl flex flex-col justify-between overflow-hidden">
          {/* Exposure Border Bleed */}
          <div
            className={`absolute inset-0 pointer-events-none rounded-2xl transition-all duration-300 ${
              exposureLevel === "red"
                ? "border-2 border-red-500 shadow-lg shadow-red-500/40"
                : exposureLevel === "amber"
                ? "border-2 border-amber-500 shadow-md shadow-amber-500/30"
                : ""
            }`}
          />

          {/* SVG Elevation Profile Ribbon */}
          <svg className="w-full h-full" viewBox="0 0 36 220" preserveAspectRatio="none">
            <defs>
              <linearGradient id="altGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#d97706" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#dc2626" stopOpacity="0.9" />
              </linearGradient>
            </defs>

            {/* Profile filled silhouette */}
            <path d={svgPath} fill="url(#altGrad)" opacity="0.65" />
          </svg>

          {/* Summit Tick Mark */}
          <div className="hud-alt-tick absolute top-2 left-1 right-1 flex justify-between items-center text-[9px] text-slate-400 font-bold px-1">
            <span>{Math.round(maxAlt)}m</span>
            <span className="w-2 h-px bg-slate-600" />
          </div>

          {/* Interior Tick Marks, positioned at their true altitude */}
          {interiorTicks.map((a) => (
            <div
              key={a}
              className="hud-alt-tick absolute -translate-y-1/2 left-1 right-1 flex justify-between items-center text-[8px] text-slate-500 font-semibold px-1"
              style={{ bottom: `${((a - minAlt) / altRange) * 100}%` }}
            >
              <span>{a}m</span>
              <span className="w-1.5 h-px bg-slate-700" />
            </div>
          ))}

          {/* Base Tick Mark */}
          <div className="hud-alt-tick absolute bottom-2 left-1 right-1 flex justify-between items-center text-[9px] text-slate-400 font-bold px-1">
            <span>{Math.round(minAlt)}m</span>
            <span className="w-2 h-px bg-slate-600" />
          </div>

          {/* Current Altitude Moving Marker Line */}
          <div
            className="absolute left-0 right-0 h-1 bg-amber-400 shadow-lg shadow-amber-400/80 transition-all duration-150 flex items-center justify-end"
            style={{ bottom: `${markerBottomPercent}%` }}
          >
            <div className="w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-slate-950 -mr-1" />
          </div>
        </div>
      </aside>
    </>
  );
};
