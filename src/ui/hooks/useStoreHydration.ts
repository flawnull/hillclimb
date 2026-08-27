"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "@/store/gameStore";

/**
 * Rehydrates the persisted game store after mount.
 *
 * The store is configured with `skipHydration`, so it starts on the server defaults and
 * localStorage is not read during render. That is what keeps the first client render
 * identical to the server-rendered HTML; reading storage inline would swap in a different
 * car, stage or settings object mid-hydration and trip a mismatch.
 *
 * Returns whether rehydration has completed, for anything that needs to avoid acting on
 * default state that is about to be replaced.
 */
export function useStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // `rehydrate()` resolves once storage has been read and merged.
    void Promise.resolve(useGameStore.persist.rehydrate()).then(() => {
      if (!cancelled) setHydrated(true);
    });

    // Development-only handle, alongside the renderer's __vb* globals. `scripts/smoke-test.ts`
    // uses it to drive the store through its own public actions when checking that progress
    // survives a reload, rather than reaching into localStorage directly.
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as unknown as { __vbStore?: typeof useGameStore }).__vbStore = useGameStore;
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return hydrated;
}
