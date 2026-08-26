/**
 * VAL BORBERA HILLCLIMB — Global Game State (Zustand)
 * High-level orchestration, preferences, car/stage selection, and settings.
 * Hot loop reads mutable engine refs directly (§13.2).
 */

import { create } from "zustand";
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

export const useGameStore = create<GameStoreState>((set, get) => ({
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
}));
