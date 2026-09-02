"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Engine } from "@/game/Engine";
import { CarDef } from "@/game/vehicle/cars";
import { StageDef } from "@/game/track/TrackSpline";
import { useGameStore, PersonalBest } from "@/store/gameStore";
import { SplitRecord } from "@/game/timing/Timer";
import { ReplayFrame } from "@/game/timing/ReplayRecorder";
import { SIM_VERSION } from "@/game/vehicle/vehicleTuning";

export interface FinishResult {
  totalTimeSeconds: number;
  rawTimeSeconds: number;
  totalPenaltySeconds: number;
  splits: SplitRecord[];
  driftScore: number;
  replayFrames: ReplayFrame[];
  runTokenData?: { runId: string; token: string; serverTime: number };
}

export type RunToken = { runId: string; token: string; serverTime: number };

/**
 * Owns the run-token fetch, the engine's finish callback, and the
 * personal-best save / car-unlock side effects that follow a finished run.
 */
export function useRunOutcome(engine: Engine, stageDef: StageDef, activeCarDef: CarDef, selectedCarId: string) {
  const savePersonalBest = useGameStore((s) => s.savePersonalBest);
  const unlockCar = useGameStore((s) => s.unlockCar);

  const [showResultModal, setShowResultModal] = useState<boolean>(false);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [isNewPB, setIsNewPB] = useState<boolean>(false);

  const runTokenRef = useRef<RunToken | null>(null);

  /**
   * True when the server is running different physics from this tab.
   *
   * The leaderboard rests on deterministic replay, so the validator rejects a submission
   * whose `simVersion` differs from its own — correctly, since a run recorded under other
   * physics cannot be re-simulated. But the check only ran at SUBMIT time, which is after
   * the player has driven the whole stage: deploy a new build while somebody has the game
   * open and their next three minutes are wasted on a run that was never going to count,
   * and the message they get is "Simulation version mismatch (server is 13, submission is
   * 12)".
   *
   * `/api/run/start` has always returned the server's `simVersion` and this hook has always
   * thrown it away. Comparing it here means the mismatch is known when the run STARTS, so
   * the player can be told to reload before driving rather than after.
   */
  const [staleBuild, setStaleBuild] = useState<boolean>(false);

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
        setStaleBuild(
          typeof data.simVersion === "number" && data.simVersion !== SIM_VERSION
        );
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

  return {
    finishResult,
    setFinishResult,
    isNewPB,
    showResultModal,
    setShowResultModal,
    runTokenRef,
    fetchRunToken,
    staleBuild,
  };
}
