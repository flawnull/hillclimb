/**
 * VAL BORBERA HILLCLIMB — Car Definitions & Perks
 * Pure data definitions for the 4 playable vehicles.
 * Strictly fictional homage marques per Section 3 of specification.
 */

import { SurfaceType } from "./vehicleTuning";

export type CarClass = 'Classic' | 'Rally' | 'Utility' | 'Sport';
export type DriveType = 'RWD' | 'AWD' | 'FWD';

export interface Perk {
  id: string;
  name: string;
  description: string;
  shortTag: string;
}

export interface CarDef {
  id: string;
  name: string;
  subtitle: string;
  className: CarClass;
  mass: number;            // kg
  powerMul: number;        // multiplies base engine force (base ~ 3800 N)
  vMax: number;            // m/s theoretical max speed
  brakeForce: number;      // N/kg braking deceleration capacity
  grip: number;            // lateral grip coefficient (base 1.0)
  maxSteerAngle: number;   // rad (~30-38 degrees)
  wheelbase: number;       // m
  drive: DriveType;
  surfaceBias: { [K in SurfaceType]?: number };
  perk: Perk;
  colorways: {
    name: string;
    primary: string;
    secondary: string;
    accent: string;
    bodyStyle: 'coupe' | 'rally_hatch' | 'box_utility' | 'sport_mid';
  }[];
  unlockedByDefault: boolean;
  unlockRequirement?: string;
}

export const CAR_DEFS: Record<string, CarDef> = {
  'weiss-blau-30': {
    id: 'weiss-blau-30',
    name: 'Weiss-Blau 3.0 Coupé',
    subtitle: 'Classic Bavarian Straight-Six GT',
    className: 'Classic',
    mass: 1350,
    powerMul: 1.00,
    vMax: 62.0, // ~223 km/h
    brakeForce: 11.0,
    grip: 1.00,
    maxSteerAngle: 0.58, // ~33.2 deg
    wheelbase: 2.62,
    drive: 'RWD',
    surfaceBias: {
      asphalt: 1.0,
      worn: 0.95,
      gravel: 0.85,
      grass: 0.80,
    },
    perk: {
      id: 'momentum-six',
      name: 'Momentum Six',
      description: 'Engine output +12% when holding slip angle in the 6°–14° sweet spot.',
      shortTag: '+12% DRIFT POWER',
    },
    colorways: [
      { name: 'Chamonix White', primary: '#f0f3f6', secondary: '#1e3a8a', accent: '#dc2626', bodyStyle: 'coupe' },
      { name: 'Inka Orange', primary: '#ea580c', secondary: '#18181b', accent: '#f59e0b', bodyStyle: 'coupe' },
      { name: 'Nachtblau Metallic', primary: '#1e293b', secondary: '#94a3b8', accent: '#38bdf8', bodyStyle: 'coupe' },
    ],
    unlockedByDefault: true,
  },

  'lanzo-alta-4wd': {
    id: 'lanzo-alta-4wd',
    name: 'Lanzo Alta 4WD',
    subtitle: 'Group-A Apennine Special',
    className: 'Rally',
    mass: 1250,
    powerMul: 1.05,
    vMax: 58.0, // ~208 km/h
    brakeForce: 12.0,
    grip: 1.05,
    maxSteerAngle: 0.62, // ~35.5 deg
    wheelbase: 2.48,
    drive: 'AWD',
    surfaceBias: {
      asphalt: 1.0,
      worn: 1.0,
      gravel: 1.25, // cuts hairpins through gravel easily
      grass: 1.20,
    },
    perk: {
      id: 'all-surface',
      name: 'All-Surface',
      description: 'Gravel and grass grip penalties reduced by 45%. Apex cutting encouraged.',
      shortTag: '-45% OFFROAD PENALTY',
    },
    colorways: [
      { name: 'Rosso Corsa', primary: '#dc2626', secondary: '#ffffff', accent: '#fbbf24', bodyStyle: 'rally_hatch' },
      { name: 'Martini Livery White', primary: '#f8fafc', secondary: '#0284c7', accent: '#e11d48', bodyStyle: 'rally_hatch' },
      { name: 'Giallo Ginestra', primary: '#eab308', secondary: '#171717', accent: '#059669', bodyStyle: 'rally_hatch' },
    ],
    unlockedByDefault: true,
  },

  'pandino-4x4': {
    id: 'pandino-4x4',
    name: 'Pandino 4x4',
    subtitle: 'The Mountain Local Hero',
    className: 'Utility',
    mass: 900,
    powerMul: 0.62,
    vMax: 42.0, // ~151 km/h
    brakeForce: 9.0,
    grip: 0.88,
    maxSteerAngle: 0.65, // ~37.2 deg
    wheelbase: 2.16,
    drive: 'AWD',
    surfaceBias: {
      asphalt: 0.95,
      worn: 0.98,
      gravel: 1.15,
      grass: 1.15,
    },
    perk: {
      id: 'nonnas-nerve',
      name: "Nonna's Nerve",
      description: 'Recovers from steep drops under 35° with only a +3.0s penalty instead of +8.0s.',
      shortTag: 'SAFE SCRAMBLE (+3s)',
    },
    colorways: [
      { name: 'Verde Bosco', primary: '#166534', secondary: '#475569', accent: '#ca8a04', bodyStyle: 'box_utility' },
      { name: 'Sabbia Val Borbera', primary: '#d97706', secondary: '#334155', accent: '#78716c', bodyStyle: 'box_utility' },
      { name: 'Bordeaux Rustico', primary: '#881337', secondary: '#1e293b', accent: '#f59e0b', bodyStyle: 'box_utility' },
    ],
    unlockedByDefault: true,
  },

  'alpe-a110': {
    id: 'alpe-a110',
    name: 'Alpe A-110',
    subtitle: 'Ultra-Lightweight Ridge Slicer',
    className: 'Sport',
    mass: 800,
    powerMul: 1.02,
    vMax: 66.0, // ~237 km/h
    brakeForce: 14.0,
    grip: 1.12,
    maxSteerAngle: 0.55, // ~31.5 deg
    wheelbase: 2.30,
    drive: 'RWD',
    surfaceBias: {
      asphalt: 1.05,
      worn: 0.90,
      gravel: 0.70,
      grass: 0.60,
    },
    perk: {
      id: 'featherweight',
      name: 'Featherweight',
      description: 'Braking distance −18%, but wall impacts cost 70% speed instead of 55%.',
      shortTag: '-18% BRAKING DISTANCE',
    },
    colorways: [
      { name: 'Bleu Alpine', primary: '#2563eb', secondary: '#0f172a', accent: '#f8fafc', bodyStyle: 'sport_mid' },
      { name: 'Noir Étoilé', primary: '#09090b', secondary: '#3b82f6', accent: '#e11d48', bodyStyle: 'sport_mid' },
      { name: 'Gris Tonnerre', primary: '#475569', secondary: '#0284c7', accent: '#f59e0b', bodyStyle: 'sport_mid' },
    ],
    unlockedByDefault: false,
    unlockRequirement: 'Beat Gold target time on any stage',
  },
};

export const DEFAULT_CAR_ID = 'weiss-blau-30';
