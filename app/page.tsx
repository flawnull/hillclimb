"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Engine, EngineRenderState } from "@/game/Engine";
import { TuningPanel } from "@/ui/TuningPanel";
import { Altimeter } from "@/ui/Altimeter";
import { TimerDisplay } from "@/ui/TimerDisplay";
import { Speedometer } from "@/ui/Speedometer";
import { StageSelectModal } from "@/ui/StageSelectModal";

import { ResultModal } from "@/ui/ResultModal";
import { LeaderboardModal } from "@/ui/LeaderboardModal";
import { TouchControls } from "@/ui/TouchControls";
import { RotateHint } from "@/ui/RotateHint";
import { useWakeLock } from "@/ui/hooks/useWakeLock";
import { CAR_DEFS, CarDef, DEFAULT_CAR_ID } from "@/game/vehicle/cars";
import { TrackSpline, StageDef } from "@/game/track/TrackSpline";
import { getStageDef } from "@/game/track/stages";
import { useGameStore, PersonalBest } from "@/store/gameStore";
import { SplitRecord } from "@/game/timing/Timer";
import { ReplayFrame } from "@/game/timing/ReplayRecorder";
import {
  Sliders,
  RotateCcw,
  Play,
  Mountain,
  Car,
  Volume2,
  VolumeX,
  Trophy,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface FinishResult {
  totalTimeSeconds: number;
  rawTimeSeconds: number;
  totalPenaltySeconds: number;
  splits: SplitRecord[];
  driftScore: number;
  replayFrames: ReplayFrame[];
  runTokenData?: { runId: string; token: string; serverTime: number };
}

// Client-only dynamic import for GameCanvas
const GameCanvas = dynamic(
  () => import("@/ui/GameCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-white font-mono">
        <div className="w-12 h-12 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-4" />
        <div className="text-sm tracking-widest text-amber-400 font-bold uppercase">
          Generating Mountain Stage...
        </div>
        <div className="text-xs text-slate-500 mt-1">Val Borbera Hillclimb</div>
      </div>
    ),
  }
);

export default function HomePage() {
  const selectedCarId = useGameStore((s) => s.selectedCarId);
  const selectedStageId = useGameStore((s) => s.selectedStageId);
  const selectedColorIndex = useGameStore((s) => s.selectedColorIndex);
  const selectCar = useGameStore((s) => s.selectCar);
  const selectStage = useGameStore((s) => s.selectStage);
  const showTuningPanel = useGameStore((s) => s.showTuningPanel);
  const toggleTuningPanel = useGameStore((s) => s.toggleTuningPanel);
  const settings = useGameStore((s) => s.settings);
  const savePersonalBest = useGameStore((s) => s.savePersonalBest);
  const unlockCar = useGameStore((s) => s.unlockCar);

  // Active Stage and Spline
  const [stageDef, setStageDef] = useState<StageDef>(() => getStageDef(selectedStageId));
  const spline = useMemo(() => new TrackSpline(stageDef), [stageDef]);

  // Engine instance
  const [engine] = useState(() => new Engine(selectedCarId));
  const renderStateRef = useRef<EngineRenderState>(engine.update(0));

  // Destroy engine on unmount to prevent audio leaks / overlapping contexts
  useEffect(() => {
    return () => engine.destroy();
  }, [engine]);

  const [hudState, setHudState] = useState<EngineRenderState>({ ...renderStateRef.current });
  const [activeCarDef, setActiveCarDef] = useState<CarDef>(CAR_DEFS[selectedCarId] || CAR_DEFS[DEFAULT_CAR_ID]);

  // Screen Wake Lock on mobile during active gameplay (§9.2)
  useWakeLock(hudState.runState);

  // Modals & UI States
  const [showStageModal, setShowStageModal] = useState<boolean>(false);
  const [showResultModal, setShowResultModal] = useState<boolean>(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState<boolean>(false);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [isNewPB, setIsNewPB] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Initialize stage spline in engine
  useEffect(() => {
    const sDef = getStageDef(selectedStageId);
    setStageDef(sDef);
    const newSpline = new TrackSpline(sDef);
    const pbKey = `${selectedStageId}:${activeCarDef.className}`;
    // Read the PB untracked. Depending on the `personalBests` map would re-run this effect
    // every time a run is saved — and `engine.setSpline` calls `resetToStart()`, so finishing
    // a race would immediately reset the car and timer again and rebuild the spline (an
    // expensive procedural walk) for a stage that has not changed.
    const currentPB = useGameStore.getState().personalBests[pbKey];
    engine.setSpline(newSpline, currentPB);
  }, [selectedStageId, engine, activeCarDef.className]);

  // Synchronize active car with engine
  useEffect(() => {
    const def = CAR_DEFS[selectedCarId] || CAR_DEFS[DEFAULT_CAR_ID];
    setActiveCarDef(def);
    engine.setCar(selectedCarId);
  }, [selectedCarId, engine]);

  const handleNextCar = () => {
    const ids = Object.keys(CAR_DEFS);
    const idx = ids.indexOf(selectedCarId);
    const nextIdx = (idx + 1) % ids.length;
    selectCar(ids[nextIdx]);
  };
  
  const handlePrevCar = () => {
    const ids = Object.keys(CAR_DEFS);
    const idx = ids.indexOf(selectedCarId);
    const nextIdx = (idx - 1 + ids.length) % ids.length;
    selectCar(ids[nextIdx]);
  };

  const runTokenRef = useRef<{ runId: string; token: string; serverTime: number } | null>(null);

  const fetchRunToken = useCallback(async () => {
    try {
      const res = await fetch("/api/run/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: stageDef.id, carId: selectedCarId }),
      });
      if (res.ok) {
        const data = await res.json();
        runTokenRef.current = {
          runId: data.runId,
          token: data.token,
          serverTime: data.serverTime,
        };
      }
    } catch {
      // Ignored: fallback handled in modal
    }
  }, [stageDef.id, selectedCarId]);

  // Hook finish callback
  useEffect(() => {
    engine.onFinish((totalTimeSec, splits) => {
      const rawTime = engine.timer.getElapsedSeconds();
      const penalties = engine.timer.totalPenaltySeconds;
      const replay = engine.recorder.stop();
      const drift = engine.vehicle.state.driftScore;

      setFinishResult({
        totalTimeSeconds: totalTimeSec,
        rawTimeSeconds: rawTime,
        totalPenaltySeconds: penalties,
        splits: [...splits],
        driftScore: drift,
        replayFrames: replay,
        runTokenData: runTokenRef.current || undefined,
      });

      const pb: PersonalBest = {
        stageId: stageDef.id,
        carId: activeCarDef.id,
        timeMs: Math.round(totalTimeSec * 1000),
        splitsMs: splits.map((s) => Math.round(s.timeSeconds * 1000)),
        achievedAt: new Date().toISOString(),
      };

      const isPB = savePersonalBest(pb, activeCarDef.className);
      setIsNewPB(isPB);

      // Unlock Alpe A-110 if beat gold time (§7)
      if (totalTimeSec <= stageDef.goldTime) {
        unlockCar("alpe-a110");
      }

      setShowResultModal(true);
    });
  }, [engine, stageDef, activeCarDef, savePersonalBest, unlockCar]);

  // Keyboard shortcuts (R for reset, T for tuning panel, Space for start, L for leaderboard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Never fire shortcuts while the player is typing. The result modal has a text input
      // for the leaderboard name, so without this guard a name containing "r" resets the run
      // and closes the modal mid-entry, "t" opens the tuning panel, and "l" opens the
      // leaderboard.
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.code === "KeyR") {
        engine.resetToStart();
        runTokenRef.current = null;
        setShowResultModal(false);
      }
      if (e.code === "KeyT") {
        toggleTuningPanel();
      }
      if (e.code === "KeyL") {
        setShowLeaderboardModal((s) => !s);
      }
      const startKeys = ["Space", "KeyW", "ArrowUp", "KeyS", "ArrowDown", "KeyA", "KeyD", "ArrowLeft", "ArrowRight"];
      if (startKeys.includes(e.code) && engine.timer.state === "ready") {
        fetchRunToken();
        engine.startCountdown();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [engine, toggleTuningPanel, fetchRunToken]);

  // Throttled HUD update callback from renderer loop (~20 Hz)
  const lastHudUpdate = useRef(0);
  const handleStateUpdate = useCallback((s: EngineRenderState) => {
    renderStateRef.current = s;
    const now = performance.now();
    if (now - lastHudUpdate.current > 48) {
      lastHudUpdate.current = now;
      setHudState({ ...s });
    }
  }, []);

  const handleToggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    engine.audio.setMuted(nextMute);
  };

  const handleStartRace = () => {
    fetchRunToken();
    engine.startCountdown();
  };

  const handleResetRun = () => {
    engine.resetToStart();
    runTokenRef.current = null;
    setFinishResult(null);
    setShowResultModal(false);
  };

  return (
    <main className="hud-root w-screen h-screen bg-slate-950 text-white font-sans select-none">
      {/* 3D Canvas. Full-bleed in landscape; the top 62% in portrait (§9.1) —
          see .hud-stage in app/globals.css. */}
      <div className="hud-stage">
        <GameCanvas
          engine={engine}
          renderStateRef={renderStateRef}
          car={activeCarDef}
          colorIndex={selectedColorIndex}
          spline={spline}
          qualityTier={settings.qualityTier}
          onStateUpdate={handleStateUpdate}
        />

        {/* Prominent Tap to Start Prompt — centred on the canvas, not on the
            portrait control dock. */}
        {hudState.runState === "ready" && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
            <button
              onClick={handleStartRace}
              className="pointer-events-auto flex items-center gap-3 px-5 sm:px-8 py-3.5 sm:py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-mono font-black text-xs sm:text-base tracking-wider rounded-2xl shadow-2xl shadow-amber-500/40 border-2 border-amber-300 active:scale-95 transition-transform backdrop-blur-md animate-pulse uppercase text-center"
            >
              <Play className="w-5 h-5 fill-current shrink-0" />
              <span className="hidden sm:inline">TAP TO START / PRESS SPACE</span>
              <span className="sm:hidden">TAP TO START</span>
            </button>
          </div>
        )}
      </div>

      {/* Portrait control-dock backdrop (bottom 38%). */}
      <div className="hud-dock-bg" />

      {/* ── HUD ──────────────────────────────────────────────────────────────
          One grid owns every panel. Each child claims a named area, so panels
          cannot overlap at any viewport; they shrink instead. */}
      <div className="hud-grid">
        {/* Stage & Car Info Banner (top-left) */}
        <div className="hud-topleft flex flex-col items-start gap-1.5 pointer-events-auto min-w-0 max-w-full">
          <button
            onClick={() => setShowStageModal(true)}
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
              onClick={handlePrevCar}
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
              onClick={handleNextCar}
              aria-label="Next car"
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Primary Timing Display (top-centre, its own row when narrow) */}
        <TimerDisplay
          stage={stageDef}
          elapsedSeconds={hudState.elapsedSeconds}
          totalPenaltySeconds={hudState.totalPenaltySeconds}
          runState={hudState.runState}
          lastSplit={hudState.lastSplit}
          lastPenalty={hudState.lastPenalty}
          currentHairpin={hudState.currentHairpin}
        />

        {/* Global Action Controls (top-right) */}
        <div className="hud-topright flex flex-wrap justify-end items-center gap-1.5 sm:gap-2 pointer-events-auto">
          {/* Quick Reset Button */}
          <button
            onClick={handleResetRun}
            className="hud-btn flex items-center justify-center p-2 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 hover:border-amber-500/60 rounded-xl text-slate-300 hover:text-white transition shadow-lg active:scale-95"
            title="Reset to Start (R)"
            aria-label="Reset to start"
          >
            <RotateCcw className="w-4 h-4 text-amber-400" />
          </button>

          {/* Audio Mute Toggle */}
          <button
            onClick={handleToggleMute}
            className="hud-btn flex items-center justify-center p-2 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 hover:border-slate-600 rounded-xl text-slate-400 hover:text-white transition shadow-lg active:scale-95"
            title={isMuted ? "Unmute Engine Audio" : "Mute Engine Audio"}
            aria-label={isMuted ? "Unmute engine audio" : "Mute engine audio"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
          </button>

          {/* Leaderboard Modal Button */}
          <button
            onClick={() => setShowLeaderboardModal(true)}
            className="hud-btn flex items-center justify-center gap-1.5 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 hover:border-amber-500/50 px-2 sm:px-3 py-1.5 rounded-xl text-xs font-mono font-bold text-slate-200 hover:text-white transition shadow-lg active:scale-95"
            title="Global Leaderboard (L)"
            aria-label="Open global leaderboard"
          >
            <Trophy className="w-4 h-4 text-amber-400" />
            <span className="hidden lg:inline">LEADERBOARD</span>
          </button>

          {/* Tuning / Settings Button */}
          <button
            onClick={toggleTuningPanel}
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

        {/* One-time portrait rotate hint (§9.1) — never blocks play */}
        <RotateHint />

        {/* Altimeter & Gradient Profile (mid-right) */}
        <Altimeter
          stage={stageDef}
          currentAltitude={hudState.altitude}
          currentS={hudState.currentS}
          dropDepth={hudState.dropDepth}
          exposure={hudState.exposure}
        />

        {/* Speedometer & Gear Cluster */}
        <Speedometer
          speedKmh={hudState.speedKmh}
          rpm={hudState.rpm}
          gear={hudState.gear}
          maxRpm={7500}
          throttle={hudState.throttle}
          brake={hudState.brake}
          handbrake={hudState.handbrake}
          isSliding={hudState.isSliding}
          slipAngle={hudState.slipAngle}
          driftScore={hudState.driftScore}
          perkActive={hudState.perkActive}
        />

        {/* Touch Controls (§9.1): steering bottom-left, pedals bottom-right,
            handbrake bottom-centre. Placed into the grid via display:contents. */}
        <TouchControls engine={engine} />
      </div>

      {/* Stage Selection Modal */}
      {showStageModal && (
        <StageSelectModal
          currentStageId={selectedStageId}
          onSelectStage={(id) => {
            selectStage(id);
            handleResetRun();
          }}
          onClose={() => setShowStageModal(false)}
        />
      )}

      {/* Stage Result Modal */}
      {showResultModal && finishResult && (
        <ResultModal
          stage={stageDef}
          car={activeCarDef}
          totalTimeSeconds={finishResult.totalTimeSeconds}
          rawTimeSeconds={finishResult.rawTimeSeconds}
          totalPenaltySeconds={finishResult.totalPenaltySeconds}
          splits={finishResult.splits}
          isNewPB={isNewPB}
          driftScore={finishResult.driftScore}
          replayFrames={finishResult.replayFrames}
          runTokenData={finishResult.runTokenData}
          onRestart={handleResetRun}
          onSelectStage={() => {
            setShowResultModal(false);
            setShowStageModal(true);
          }}
          onOpenLeaderboard={() => {
            setShowResultModal(false);
            setShowLeaderboardModal(true);
          }}
          onClose={handleResetRun}
        />
      )}

      {/* Global Leaderboard Modal */}
      {showLeaderboardModal && (
        <LeaderboardModal
          initialStageId={selectedStageId}
          onClose={() => setShowLeaderboardModal(false)}
        />
      )}

      {/* M1 Tuning Panel Modal */}
      {showTuningPanel && (
        <TuningPanel
          engine={engine}
          renderStateRef={renderStateRef}
          onClose={toggleTuningPanel}
        />
      )}
    </main>
  );
}
