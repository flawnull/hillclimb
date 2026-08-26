"use client";

import React, { useState } from "react";
import { StageDef } from "@/game/track/TrackSpline";
import { CarDef } from "@/game/vehicle/cars";
import { SplitRecord } from "@/game/timing/Timer";
import { ReplayFrame, computeReplayHash } from "@/game/timing/ReplayRecorder";
import { SIM_VERSION } from "@/game/vehicle/vehicleTuning";

import {
  Trophy,
  Medal,
  RotateCcw,
  ArrowRight,
  Flame,
  Send,
  CheckCircle2,
  Globe,
} from "lucide-react";

interface ResultModalProps {
  stage: StageDef;
  car: CarDef;
  totalTimeSeconds: number;
  rawTimeSeconds: number;
  totalPenaltySeconds: number;
  splits: SplitRecord[];
  isNewPB: boolean;
  driftScore: number;
  replayFrames?: ReplayFrame[];
  runTokenData?: { runId: string; token: string; serverTime: number };
  onRestart: () => void;
  onSelectStage: () => void;
  onOpenLeaderboard?: () => void;
}

export const ResultModal: React.FC<ResultModalProps> = ({
  stage,
  car,
  totalTimeSeconds,
  rawTimeSeconds,
  totalPenaltySeconds,
  splits,
  isNewPB,
  driftScore,
  replayFrames,
  runTokenData,
  onRestart,
  onSelectStage,
  onOpenLeaderboard,
}) => {
  const [playerName, setPlayerName] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("vb_player_name") || "Ligurian Driver";
    }
    return "Ligurian Driver";
  });
  const [playerId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      let id = localStorage.getItem("vb_player_id");
      if (!id) {
        id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        localStorage.setItem("vb_player_id", id);
      }
      return id;
    }
    return "anon_player";
  });
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Determine Medal
  let medal: "gold" | "silver" | "bronze" | "finish" = "finish";
  if (totalTimeSeconds <= stage.goldTime) {
    medal = "gold";
  } else if (totalTimeSeconds <= stage.silverTime) {
    medal = "silver";
  } else if (totalTimeSeconds <= stage.bronzeTime) {
    medal = "bronze";
  }

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t * 1000) % 1000);
    return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };

  const handleSubmitScore = async () => {
    if (!playerName.trim()) return;
    if (!replayFrames || replayFrames.length === 0) {
      setSubmitError("No replay data available to submit");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("vb_player_name", playerName.trim());
      }

      // 1. Get or use pre-minted Run Token
      let rId = runTokenData?.runId;
      let tkn = runTokenData?.token;
      let sTime = runTokenData?.serverTime;

      if (!rId || !tkn || !sTime) {
        const startRes = await fetch("/api/run/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId: stage.id, carId: car.id }),
        });

        if (!startRes.ok) throw new Error("Failed to initialize score submission");
        const startData = await startRes.json();
        rId = startData.runId;
        tkn = startData.token;
        sTime = startData.serverTime;
      }

      const inputHash = computeReplayHash(replayFrames);

      // 2. Submit Run with Replay trace, inputHash, and persistent playerId
      const submitRes = await fetch("/api/run/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: rId,
          token: tkn,
          stageId: stage.id,
          carId: car.id,
          playerId,
          playerName: playerName.trim(),
          timeMs: Math.round(rawTimeSeconds * 1000),
          penaltyMs: Math.round(totalPenaltySeconds * 1000),
          checkpointsMs: splits.map((s) => Math.round(s.timeSeconds * 1000)),
          issuedAt: sTime,
          inputHash,
          simVersion: SIM_VERSION,
          replays: replayFrames,
        }),
      });




      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(submitData.error || "Submission failed");
      }

      setSubmitSuccess(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Submission error";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md font-mono select-none">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-5 sm:p-6 shadow-2xl text-white max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-amber-500/20 border-2 border-amber-400 mb-2 shadow-lg shadow-amber-500/30">
            <Trophy className="w-6 h-6 sm:w-7 sm:h-7 text-amber-400" />
          </div>
          <h2 className="text-base sm:text-lg font-black tracking-widest uppercase text-white">
            STAGE COMPLETE
          </h2>
          <p className="text-xs text-slate-400">{stage.name} · {car.name}</p>
        </div>

        {/* New PB Banner */}
        {isNewPB && (
          <div className="mb-3 py-1.5 px-3 bg-emerald-500/20 border border-emerald-500/60 rounded-xl text-center flex items-center justify-center gap-2 text-emerald-300 text-xs font-black tracking-widest animate-pulse">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            NEW PERSONAL BEST!
          </div>
        )}

        {/* Main Time Readout */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-center mb-3">
          <span className="text-[10px] text-slate-400 font-sans tracking-widest uppercase">
            Official Final Time
          </span>
          <div className="text-3xl sm:text-4xl font-black italic text-amber-400 tracking-tight my-1">
            {formatTime(totalTimeSeconds)}
          </div>
          {totalPenaltySeconds > 0 && (
            <div className="text-xs text-rose-400 font-semibold">
              Raw: {formatTime(rawTimeSeconds)} (+{totalPenaltySeconds.toFixed(1)}s penalties)
            </div>
          )}
        </div>

        {/* Medal & Drift Score */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 mb-3 text-xs">
          <div className="flex items-center gap-2">
            <Medal
              className={`w-4 h-4 ${
                medal === "gold" ? "text-amber-400" : medal === "silver" ? "text-slate-300" : "text-amber-700"
              }`}
            />
            <span className="font-bold uppercase tracking-wider text-slate-200">
              {medal === "gold" ? "Gold Trophy" : medal === "silver" ? "Silver Trophy" : medal === "bronze" ? "Bronze Trophy" : "Finisher"}
            </span>
          </div>
          <div className="flex items-center gap-1 text-slate-400 text-[11px]">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span>Drift: {Math.round(driftScore)} pts</span>
          </div>
        </div>

        {/* Global Leaderboard Submission Form */}
        <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 mb-4">
          <div className="text-[10px] text-slate-400 font-bold mb-1.5 flex items-center gap-1">
            <Globe className="w-3 h-3 text-cyan-400" /> POST TO GLOBAL LEADERBOARD
          </div>

          {submitSuccess ? (
            <div className="flex items-center justify-between py-1 text-xs text-emerald-400 font-bold">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Time posted successfully!
              </span>
              {onOpenLeaderboard && (
                <button
                  onClick={onOpenLeaderboard}
                  className="text-amber-400 underline text-[11px]"
                >
                  View Board
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={24}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Driver Name"
                className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
              />
              <button
                onClick={handleSubmitScore}
                disabled={isSubmitting || !playerName.trim()}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-lg transition flex items-center gap-1 shadow-md shadow-amber-500/20"
              >
                {isSubmitting ? (
                  <div className="w-3 h-3 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
                SUBMIT
              </button>
            </div>
          )}

          {submitError && (
            <div className="text-[10px] text-rose-400 mt-1">{submitError}</div>
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={onRestart}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            RETRY (R)
          </button>
          <button
            onClick={onSelectStage}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shadow-lg shadow-amber-500/30 active:scale-95"
          >
            STAGES
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
