"use client";

import React from "react";
import { STAGE_LIST } from "@/game/track/stages";
import { Mountain, Flag, Trophy, X, ArrowUpRight, Compass } from "lucide-react";

interface StageSelectModalProps {
  currentStageId: string;
  onSelectStage: (stageId: string) => void;
  onClose: () => void;
}

export const StageSelectModal: React.FC<StageSelectModalProps> = ({
  currentStageId,
  onSelectStage,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md font-mono select-none">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <Mountain className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-black tracking-wider uppercase text-amber-400">
                Select Mountain Stage
              </h2>
              <p className="text-xs text-slate-400">Val Borbera · Ligurian Apennines</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stage Cards */}
        <div className="space-y-3">
          {STAGE_LIST.map((stage) => {
            const isSelected = stage.id === currentStageId;
            return (
              <div
                key={stage.id}
                onClick={() => {
                  onSelectStage(stage.id);
                  onClose();
                }}
                className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                  isSelected
                    ? "bg-amber-500/10 border-amber-400 shadow-lg shadow-amber-500/20"
                    : "bg-slate-800/60 border-slate-700/60 hover:bg-slate-800 hover:border-slate-600"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{stage.name}</span>
                      {isSelected && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">{stage.route}</span>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                      <Trophy className="w-3 h-3 text-amber-400" /> Gold: {stage.goldTime}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 mb-3">{stage.character}</p>

                <div className="flex items-center gap-4 text-[11px] text-slate-400 font-semibold border-t border-slate-700/50 pt-2">
                  <div className="flex items-center gap-1">
                    <Flag className="w-3 h-3 text-cyan-400" />
                    <span>{stage.lengthKm}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                    <span>{stage.elevation}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
