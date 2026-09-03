"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
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
import { useStoreHydration } from "@/ui/hooks/useStoreHydration";
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
    // No visible fallback here. This slot only covers the canvas area, and the HUD is a
    // SIBLING of it in the layout — so a panel drawn here left every button, the timer and
    // the altimeter fully sharp and apparently usable while the stage was still building.
    // The loading screen is `LoadingVeil` below, which covers the whole page instead.
    loading: () => <div className="w-full h-full" />,
  }
);

export default function HomePage() {
  // Load persisted progress (unlocks, personal bests, settings) after mount. The store skips
  // automatic hydration so the first client render matches the server HTML; see the hook.
  useStoreHydration();

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

  // Cleared by the first frame the renderer actually draws — see handleStateUpdate. That is
  // the honest signal for "the stage is ready": the canvas chunk has loaded, the terrain,
  // road and scenery are built, and something is on screen. Keyed on nothing else, so it
  // cannot get stuck if a build is slow.
  const [sceneReady, setSceneReady] = useState<boolean>(false);

  // The veil clears on the first frame the renderer draws. If that frame never comes — a
  // WebGL context the device refuses, a build that throws while assembling the stage — the
  // veil is all the player ever sees, with nothing to do about it and nothing said. Reported
  // from a phone as the loading screen getting stuck. After this long it stops claiming to
  // be loading and offers a way out.
  const [slowLoad, setSlowLoad] = useState<boolean>(false);
  /** 0..1 across the stage build, reported by the renderer while it slices the terrain. */
  const [buildProgress, setBuildProgress] = useState<number>(0);
  /** True while a stage is generating, including a switch after the first load. */
  const [building, setBuilding] = useState<boolean>(true);

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
    staleBuild,
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
  const sceneReadyRef = useRef(false);

  useEffect(() => {
    if (sceneReady) return;
    const t = window.setTimeout(() => {
      if (!sceneReadyRef.current) setSlowLoad(true);
    }, 12_000);
    return () => window.clearTimeout(t);
  }, [sceneReady]);
  const handleStateUpdate = useCallback((s: EngineRenderState) => {
    renderStateRef.current = s;
    // Once only: this runs on every rendered frame, and React would otherwise be handed a
    // state update sixty times a second to bail out of.
    if (!sceneReadyRef.current) {
      sceneReadyRef.current = true;
      setSceneReady(true);
    }
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
    <main className={`hud-root w-screen h-screen bg-slate-950 text-white font-sans select-none${sceneReady && !building ? "" : " hud-loading"}`}>
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
          onBuildProgress={setBuildProgress}
          onBuildingChange={setBuilding}
        />

        {/* Prominent Tap to Start Prompt — centred on the canvas, not on the
            portrait control dock. */}
        {hudState.runState === "ready" && (
          <div className="hud-start-prompt absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
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
          isRunning={hudState.runState === "running"}
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

      {/* A deploy landed while this tab was open. Said before the run rather than after it:
          the run would be rejected on submission, and finding that out three minutes later
          is the worst possible moment. */}
      {staleBuild && (
        <div className="fixed top-0 inset-x-0 z-[55] flex items-center justify-center gap-3 px-4 py-2 bg-amber-500 text-slate-950 font-mono text-[11px] sm:text-xs font-bold tracking-wide">
          <span className="text-center">
            A NEW VERSION OF THE GAME IS LIVE — RELOAD BEFORE DRIVING, OR YOUR TIME CANNOT BE SUBMITTED.
          </span>
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 px-3 py-1 rounded-md bg-slate-950 text-amber-400 uppercase tracking-wider active:scale-95 transition-transform"
          >
            Reload
          </button>
        </div>
      )}

      {/* Loading veil — the WHOLE page, not just the canvas.
          Fixed and above the HUD grid (z-20) and the tap-to-start prompt (z-30), so the
          controls behind it are genuinely blurred and genuinely inert rather than merely
          unclickable: the veil itself takes the pointer events. */}
      {(!sceneReady || building) && (
        <div
          className="vb-veil fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-950 text-white font-mono"
          role="status"
          aria-live="polite"
        >
          <div className="text-2xl sm:text-3xl tracking-[0.35em] text-amber-400 font-black uppercase pl-[0.35em]">
            Loading
            <span className="vb-dot" style={{ animationDelay: "0ms" }}>.</span>
            <span className="vb-dot" style={{ animationDelay: "200ms" }}>.</span>
            <span className="vb-dot" style={{ animationDelay: "400ms" }}>.</span>
          </div>

          {/* A stretch of road, filling in as the stage is built. Real progress rather than
              an indeterminate loop: the terrain reports where it is, and on a slow device
              the difference between "working" and "hung" is the whole question. */}
          <div className="vb-track mt-6 w-56 sm:w-72 h-3 rounded-full overflow-hidden border border-slate-700/70">
            <div
              className="vb-fill h-full rounded-full transition-[width] duration-200 ease-linear"
              style={{ width: `${Math.max(3, Math.round(buildProgress * 100))}%` }}
            />
          </div>
          <div className="mt-2 text-[10px] tracking-widest text-slate-500 tabular-nums">
            {Math.round(buildProgress * 100)}%
          </div>

          {slowLoad ? (
            <div className="mt-5 flex flex-col items-center gap-3 px-6 text-center">
              <div className="text-[11px] tracking-wide text-slate-300 max-w-xs leading-relaxed">
                This is taking longer than it should. The stage may have failed to start on
                this device.
              </div>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black tracking-widest uppercase active:scale-95 transition-transform"
              >
                Reload
              </button>
            </div>
          ) : (
            <div className="text-[11px] tracking-widest text-slate-400 mt-5 uppercase">
              Val Borbera Hillclimb
            </div>
          )}
        </div>
      )}

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
