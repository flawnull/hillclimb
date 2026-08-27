"use client";

import { useEffect } from "react";
import { Engine } from "@/game/Engine";
import { RunToken } from "@/ui/hooks/useRunOutcome";

/**
 * Global keyboard shortcuts (R for reset, T for tuning panel, Space for
 * start, L for leaderboard).
 */
export function useKeyboardShortcuts(
  engine: Engine,
  toggleTuningPanel: () => void,
  fetchRunToken: () => Promise<void>,
  runTokenRef: React.MutableRefObject<RunToken | null>,
  setShowResultModal: (show: boolean) => void,
  setShowLeaderboardModal: (updater: (s: boolean) => boolean) => void
) {
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
}
