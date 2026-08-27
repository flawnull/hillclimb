"use client";

import { useState, useEffect, useMemo } from "react";
import { Engine } from "@/game/Engine";
import { CAR_DEFS, CarDef, DEFAULT_CAR_ID } from "@/game/vehicle/cars";
import { TrackSpline, StageDef } from "@/game/track/TrackSpline";
import { getStageDef } from "@/game/track/stages";
import { useGameStore } from "@/store/gameStore";

interface EngineLifecycle {
  engine: Engine;
  stageDef: StageDef;
  spline: TrackSpline;
  activeCarDef: CarDef;
}

/**
 * Owns the Engine instance and keeps its stage spline / active car in sync
 * with the selected stage and car ids from the store.
 */
export function useEngineLifecycle(selectedCarId: string, selectedStageId: string): EngineLifecycle {
  // Active Stage and Spline
  const [stageDef, setStageDef] = useState<StageDef>(() => getStageDef(selectedStageId));
  const spline = useMemo(() => new TrackSpline(stageDef), [stageDef]);

  // Engine instance
  const [engine] = useState(() => new Engine(selectedCarId));

  // Destroy engine on unmount to prevent audio leaks / overlapping contexts
  useEffect(() => {
    return () => engine.destroy();
  }, [engine]);

  const [activeCarDef, setActiveCarDef] = useState<CarDef>(CAR_DEFS[selectedCarId] || CAR_DEFS[DEFAULT_CAR_ID]);

  // Initialize stage spline in engine
  useEffect(() => {
    const sDef = getStageDef(selectedStageId);
    setStageDef(sDef);
    const newSpline = new TrackSpline(sDef);
    const pbKey = `${selectedStageId}:${activeCarDef.className}`;
    // Read the PB untracked. Depending on the `personalBests` map would re-run this effect
    // every time a run is saved — and `engine.setSpline` calls `resetToStart()`, so finishing
    // a race would immediately reset the car and timer again and rebuild the spline (an
    // expensive procedural walk) for a stage that has not changed.
    const currentPB = useGameStore.getState().personalBests[pbKey];
    engine.setSpline(newSpline, currentPB);
  }, [selectedStageId, engine, activeCarDef.className]);

  // Synchronize active car with engine
  useEffect(() => {
    const def = CAR_DEFS[selectedCarId] || CAR_DEFS[DEFAULT_CAR_ID];
    setActiveCarDef(def);
    engine.setCar(selectedCarId);
  }, [selectedCarId, engine]);

  return { engine, stageDef, spline, activeCarDef };
}
