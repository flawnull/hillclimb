"use client";

import { useEffect, useRef } from "react";
import { RunState } from "@/game/timing/Timer";

/**
 * Screen Wake Lock hook (§9.2 & M8)
 * Keeps mobile display awake during active racing runs to avoid display dimming/sleep.
 */
export function useWakeLock(runState: RunState): void {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let isMounted = true;

    const requestLock = async () => {
      if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
        try {
          if (!wakeLockRef.current) {
            const sentinel = await navigator.wakeLock.request("screen");
            if (isMounted) {
              wakeLockRef.current = sentinel;
              sentinel.addEventListener("release", () => {
                wakeLockRef.current = null;
              });
            } else {
              sentinel.release();
            }
          }
        } catch {
          // Wake lock may fail if tab not active or battery saver on
        }
      }
    };

    const releaseLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        } catch {
          // Ignore release errors
        }
      }
    };

    if (runState === "running") {
      requestLock();
    } else {
      releaseLock();
    }

    return () => {
      isMounted = false;
      releaseLock();
    };
  }, [runState]);
}
