"use client";

import React, { useState, useEffect } from "react";
import { STAGE_LIST } from "@/game/track/stages";
import { CAR_DEFS, CarClass } from "@/game/vehicle/cars";
import { Trophy, Medal, X, RefreshCw, Car, Crown, Globe } from "lucide-react";

interface LeaderboardEntry {
  rank: number;
  runId: string;
  playerName: string;
  carId: string;
  carClass: string;
  timeMs: number;
  penaltyMs: number;
  totalScoreMs: number;
  createdAt: string;
}

interface LeaderboardModalProps {
  initialStageId: string;
  onClose: () => void;
}

const CAR_CLASSES: (CarClass | "Overall")[] = ["Overall", "Classic", "Rally", "Utility", "Sport"];

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  initialStageId,
  onClose,
}) => {
  const [selectedStage, setSelectedStage] = useState<string>(initialStageId);
  const [selectedClass, setSelectedClass] = useState<CarClass | "Overall">("Overall");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchLeaderboard = async (stage: string, cls: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/leaderboard?stage=${stage}&class=${cls}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (e) {
      console.error("Failed to load leaderboard:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard(selectedStage, selectedClass);
  }, [selectedStage, selectedClass]);

  const formatTime = (ms: number) => {
    const totalSec = ms / 1000;
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const millis = Math.floor(ms % 1000);
    return `${m}:${s.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md font-mono select-none">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-2xl text-white flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-black tracking-wider uppercase text-amber-400">
                Global Leaderboards
              </h2>
              <p className="text-xs text-slate-400">Verified Apennine Time-Attack Records</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchLeaderboard(selectedStage, selectedClass)}
              title="Refresh"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stage Tabs */}
        <div className="flex items-center gap-2 my-3 overflow-x-auto pb-1">
          {STAGE_LIST.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStage(s.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                selectedStage === s.id
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        {/* Class Filter Chips */}
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
          {CAR_CLASSES.map((cls) => (
            <button
              key={cls}
              onClick={() => setSelectedClass(cls)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                selectedClass === cls
                  ? "bg-slate-700 text-amber-400 border border-amber-400/50"
                  : "bg-slate-800/50 text-slate-400 hover:text-slate-200"
              }`}
            >
              {cls}
            </button>
          ))}
        </div>

        {/* Leaderboard Table */}
        <div className="flex-1 overflow-y-auto min-h-[250px] bg-slate-950/60 rounded-xl border border-slate-800 p-2">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-xs gap-2 py-12">
              <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              Loading rankings...
            </div>
          ) : entries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs py-12">
              <Trophy className="w-8 h-8 text-slate-600 mb-2" />
              <span>No times posted yet for this class.</span>
              <span className="text-[10px] text-slate-500 mt-1">Be the first to claim the mountain crown!</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((entry) => {
                const carDef = CAR_DEFS[entry.carId] || CAR_DEFS["weiss-blau-30"];
                const isTop1 = entry.rank === 1;
                const isTop3 = entry.rank <= 3;

                return (
                  <div
                    key={entry.runId}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition ${
                      isTop1
                        ? "bg-amber-500/15 border-amber-500/50 shadow-md shadow-amber-500/10"
                        : isTop3
                        ? "bg-slate-800/80 border-slate-700"
                        : "bg-slate-900/60 border-slate-800"
                    }`}
                  >
                    {/* Rank & Player */}
                    <div className="flex items-center gap-3">
                      <div className="w-6 text-center font-black">
                        {isTop1 ? (
                          <Crown className="w-4 h-4 text-amber-400 inline" />
                        ) : isTop3 ? (
                          <span className="text-amber-300">#{entry.rank}</span>
                        ) : (
                          <span className="text-slate-500">#{entry.rank}</span>
                        )}
                      </div>
                      <div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span>{entry.playerName}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Car className="w-3 h-3 text-slate-500" />
                          <span>{carDef.name}</span>
                          <span className="opacity-60">({entry.carClass})</span>
                        </div>
                      </div>
                    </div>

                    {/* Official Time */}
                    <div className="text-right">
                      <div className={`font-black italic text-sm ${isTop1 ? "text-amber-400" : "text-slate-100"}`}>
                        {formatTime(entry.totalScoreMs)}
                      </div>
                      {entry.penaltyMs > 0 && (
                        <div className="text-[9px] text-rose-400">
                          +{ (entry.penaltyMs / 1000).toFixed(1) }s pen
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
