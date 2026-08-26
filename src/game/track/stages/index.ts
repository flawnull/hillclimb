/**
 * VAL BORBERA HILLCLIMB — Stages Registry
 */

import { StageDef } from "../TrackSpline";
import { createBorberaSprintStage } from "./borberaSprint";
import { createSalitaCosolaStage } from "./salitaCosola";
import { createCrestaEbroStage } from "./crestaEbro";

export const STAGES: Record<string, () => StageDef> = {
  'borbera-sprint': createBorberaSprintStage,
  'salita-cosola': createSalitaCosolaStage,
  'cresta-ebro': createCrestaEbroStage,
};

/**
 * Stage definitions are pure functions of their authoring DSL, so building one is
 * deterministic — but it walks thousands of spline samples. validate.ts calls
 * getStageDef() on every leaderboard submission, so memoize.
 */
const STAGE_CACHE = new Map<string, StageDef>();

export function getStageDef(stageId: string): StageDef {
  const id = STAGES[stageId] ? stageId : 'borbera-sprint';
  let def = STAGE_CACHE.get(id);
  if (!def) {
    def = STAGES[id]();
    STAGE_CACHE.set(id, def);
  }
  return def;
}

function fmtAlt(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(3).replace('.', ',')}m` : `${Math.round(m)}m`;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * Menu metadata DERIVED from the built stage rather than hand-written beside it.
 * These used to be literals ("11.5 km", "560m -> 1,500m") that had drifted away from
 * the geometry the builder actually produces, so the menu and the in-game header
 * disagreed with each other. Deriving them makes that class of bug impossible.
 */
export const STAGE_LIST = [
  {
    id: 'borbera-sprint',
    route: 'Cabella <-> Rocchetta',
    character: 'Fast valley sprint, river stone bridges, high speed.',
    unlocked: true,
  },
  {
    id: 'salita-cosola',
    route: 'Cabella -> Capanne di Cosola',
    character: 'The Main Event. Relentless hairpins, vertical drama.',
    unlocked: true,
  },
  {
    id: 'cresta-ebro',
    route: 'Monte Ebro Ridge Road',
    character: 'Knife-edge ridge, drops on both sides, blind crests.',
    unlocked: true,
  },
].map((entry) => {
  const def = getStageDef(entry.id);
  return {
    ...entry,
    name: def.name,
    lengthKm: `${(def.length / 1000).toFixed(1)} km`,
    elevation: `${fmtAlt(def.startAltitude)} -> ${fmtAlt(def.endAltitude)}`,
    goldTime: fmtTime(def.goldTime),
  };
});

