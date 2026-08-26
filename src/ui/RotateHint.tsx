"use client";

import React, { useEffect, useState } from "react";
import { RotateCw, X } from "lucide-react";

const STORAGE_KEY = "vb.rotateHintSeen";

/**
 * One-time "rotate for a better view" nudge (§9.1).
 *
 * Portrait is a fully supported play mode, so this is a dismissible hint and
 * never an interstitial: it occupies its own HUD grid row, covers nothing, and
 * auto-retires after ten seconds. Once dismissed it does not come back.
 */
export const RotateHint: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private mode / storage disabled: show the hint, just don't persist it.
    }
    if (seen) return;

    setVisible(true);
    const timer = setTimeout(() => dismiss(), 10_000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Ignored.
    }
  };

  if (!visible) return null;

  return (
    <div className="hud-hint pointer-events-none flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 bg-slate-950/90 backdrop-blur-md border border-amber-500/40 px-3 py-1.5 rounded-full shadow-2xl max-w-full">
        <RotateCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-[10px] sm:text-xs font-mono font-bold text-slate-200 tracking-wide truncate">
          Rotate for a better view — portrait works too
        </span>
        <button
          onClick={dismiss}
          aria-label="Dismiss rotate hint"
          className="shrink-0 -mr-1 p-1 text-slate-400 hover:text-white active:scale-90 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
