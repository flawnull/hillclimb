"use client";

import React, { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { EngineRenderState } from "@/game/Engine";
import { TuningPanel } from "@/ui/TuningPanel";
import { Altimeter } from "@/ui/Altimeter";
import { TimerDisplay } from "@/ui/TimerDisplay";
import { Speedometer } from "@/ui/Speedometer";
import { StageSelectModal } from "@/ui/StageSelectModal";
import { HudTopBar } from "@/ui/HudTopBar";

import { ResultModal } from "@/ui/ResultModal";
import { LeaderboardModal } from "@/ui/LeaderboardModal";
import { TouchControls } from "@/ui/TouchControls";
import { RotateHint } from "@/ui/RotateHint";
import { useWakeLock } from "@/ui/hooks/useWakeLock";
import { useEngineLifecycle } from "@/ui/hooks/useEngineLifecycle";
import { useRunOutcome } from "@/ui/hooks/useRunOutcome";
import { useKeyboardShortcuts } from "@/ui/hooks/useKeyboardShortcuts";
import { CAR_DEFS } from "@/game/vehicle/cars";
import { useGameStore } from "@/store/gameStore";
import { Play } from "lucide-react";

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

  const { engine, stageDef, spline, activeCarDef } = useEngineLifecycle(selectedCarId, selectedStageId);

  const renderStateRef = useRef<EngineRenderState>(engine.update(0));

  const [hudState, setHudState] = useState<EngineRenderState>({ ...renderStateRef.current });

  // Screen Wake Lock on mobile during active gameplay (§9.2)
  useWakeLock(hudState.runState);

  // Modals & UI States
  const [showStageModal, setShowStageModal] = useState<boolean>(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const {
    finishResult,
    setFinishResult,
    isNewPB,
    showResultModal,
    setShowResultModal,
    runTokenRef,
    fetchRunToken,
  } = useRunOutcome(engine, stageDef, activeCarDef, selectedCarId);

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

  // Keyboard shortcuts (R for reset, T for tuning panel, Space for start, L for leaderboard)
  useKeyboardShortcuts(
    engine,
    toggleTuningPanel,
    fetchRunToken,
    runTokenRef,
    setShowResultModal,
    setShowLeaderboardModal
  );

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
        <HudTopBar
          stageDef={stageDef}
          onOpenStageModal={() => setShowStageModal(true)}
          selectedCarId={selectedCarId}
          onPrevCar={handlePrevCar}
          onNextCar={handleNextCar}
          onResetRun={handleResetRun}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          onOpenLeaderboard={() => setShowLeaderboardModal(true)}
          showTuningPanel={showTuningPanel}
          onToggleTuningPanel={toggleTuningPanel}
        >
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
        </HudTopBar>

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
