/**
 * VAL BORBERA HILLCLIMB — Global Game State (Zustand)
 * High-level orchestration, preferences, car/stage selection, and settings.
 * Hot loop reads mutable engine refs directly (§13.2).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_CAR_ID } from "@/game/vehicle/cars";

export type QualityTier = 'high' | 'medium' | 'low';
export type TouchControlMode = 'slider' | 'buttons';
export type CameraViewMode = 'chase' | 'hood' | 'bumper';

export interface GameSettings {
  qualityTier: QualityTier;
  steeringAssist: boolean;
  autoThrottle: boolean;
  touchControlMode: TouchControlMode;
  cameraView: CameraViewMode;
  useTilt: boolean;
  useMph: boolean;
  soundVolume: number;
  engineVolume: number;
  haptics: boolean;
}

export interface PersonalBest {
  stageId: string;
  carId: string;
  timeMs: number;
  splitsMs: number[];
  achievedAt: string;
}

export interface GameStoreState {
  // Navigation & Game State
  selectedCarId: string;
  selectedStageId: string;
  selectedColorIndex: number;
  unlockedCarIds: string[];
  
  // Game Flow
  isPaused: boolean;
  isPlaying: boolean;
  showTuningPanel: boolean;
  
  // Settings
  settings: GameSettings;
  
  // Personal Bests (Local)
  personalBests: Record<string, PersonalBest>; // key: `${stageId}:${carClass}`
  
  // Actions
  selectCar: (carId: string) => void;
  selectColorIndex: (index: number) => void;
  selectStage: (stageId: string) => void;
  unlockCar: (carId: string) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsPaused: (paused: boolean) => void;
  toggleTuningPanel: () => void;
  updateSettings: (settings: Partial<GameSettings>) => void;
  savePersonalBest: (pb: PersonalBest, carClass: string) => boolean; // returns true if new PB
}

const DEFAULT_SETTINGS: GameSettings = {
  qualityTier: 'high',
  steeringAssist: true,
  autoThrottle: false,
  touchControlMode: 'slider',
  cameraView: 'chase',
  useTilt: false,
  useMph: false,
  soundVolume: 0.8,
  engineVolume: 0.9,
  haptics: false,
};

/**
 * Progress is persisted to localStorage.
 *
 * Without this, unlocking the Alpe A-110 by beating a gold time lasted until the next page
 * load, personal bests vanished on refresh (taking the result modal's PB delta with them),
 * and quality/control settings reset on every visit.
 *
 * `skipHydration` is deliberate. The server renders with the defaults below; reading
 * localStorage during render would make the first client render disagree with that HTML and
 * produce a hydration mismatch. Instead the app rehydrates explicitly after mount — see
 * `useStoreHydration`. Only durable progress and preferences are persisted; transient UI
 * state (paused, playing, panel visibility) is deliberately excluded so a reload always
 * starts from a clean interface.
 */
export const useGameStore = create<GameStoreState>()(
  persist(
    (set, get) => ({
  selectedCarId: DEFAULT_CAR_ID,
  selectedStageId: 'borbera-sprint',
  selectedColorIndex: 0,
  unlockedCarIds: ['weiss-blau-30', 'lanzo-alta-4wd', 'pandino-4x4'],
  isPaused: false,
  isPlaying: false,
  showTuningPanel: false,
  settings: DEFAULT_SETTINGS,
  personalBests: {},

  selectCar: (carId: string) => set({ selectedCarId: carId, selectedColorIndex: 0 }),
  selectColorIndex: (index: number) => set({ selectedColorIndex: index }),
  selectStage: (stageId: string) => set({ selectedStageId: stageId }),
  
  unlockCar: (carId: string) => {
    const { unlockedCarIds } = get();
    if (!unlockedCarIds.includes(carId)) {
      set({ unlockedCarIds: [...unlockedCarIds, carId] });
    }
  },

  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),
  setIsPaused: (paused: boolean) => set({ isPaused: paused }),
  toggleTuningPanel: () => set((s) => ({ showTuningPanel: !s.showTuningPanel })),

  updateSettings: (newSettings) =>
    set((s) => ({ settings: { ...s.settings, ...newSettings } })),

  savePersonalBest: (pb: PersonalBest, carClass: string) => {
    const key = `${pb.stageId}:${carClass}`;
    const current = get().personalBests[key];
    if (!current || pb.timeMs < current.timeMs) {
      set((s) => ({
        personalBests: {
          ...s.personalBests,
          [key]: pb,
        },
      }));
      return true;
    }
    return false;
  },
}),
    {
      name: "val-borbera-hillclimb",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        selectedCarId: s.selectedCarId,
        selectedStageId: s.selectedStageId,
        selectedColorIndex: s.selectedColorIndex,
        unlockedCarIds: s.unlockedCarIds,
        settings: s.settings,
        personalBests: s.personalBests,
      }),
    }
  )
);
