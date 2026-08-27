"use client";

import React, { useState, useEffect, useId } from "react";
import { EngineRenderState, Engine } from "@/game/Engine";
import { CAR_DEFS } from "@/game/vehicle/cars";
import { Sliders, RefreshCw, X, Zap, Gauge, Compass } from "lucide-react";
import { useModalDialog } from "@/ui/useModalDialog";

interface TuningPanelProps {
  engine: Engine;
  renderStateRef: React.MutableRefObject<EngineRenderState>;
  onClose: () => void;
}

export const TuningPanel: React.FC<TuningPanelProps> = ({
  engine,
  renderStateRef,
  onClose,
}) => {
  // Live tuning state initialized from active car and constants
  const [powerMul, setPowerMul] = useState(engine.vehicle.car.powerMul);
  const [grip, setGrip] = useState(engine.vehicle.car.grip);
  const [mass, setMass] = useState(engine.vehicle.car.mass);
  const [brakeForce, setBrakeForce] = useState(engine.vehicle.car.brakeForce);

  // Live telemetry (polled at 15 Hz to keep React light)
  const [telemetry, setTelemetry] = useState<EngineRenderState>({ ...renderStateRef.current });

  const titleId = useId();
  const { panelRef } = useModalDialog({ onClose });

  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry({ ...renderStateRef.current });
    }, 66); // ~15 Hz
    return () => clearInterval(interval);
  }, [renderStateRef]);

  // Apply tuning values directly to vehicle instance
  const applyTuning = (
    newPower: number,
    newGrip: number,
    newMass: number,
    newBrake: number
  ) => {
    engine.vehicle.car.powerMul = newPower;
    engine.vehicle.car.grip = newGrip;
    engine.vehicle.car.mass = newMass;
    engine.vehicle.car.brakeForce = newBrake;
  };

  const handleResetDefaults = () => {
    const def = CAR_DEFS[engine.vehicle.car.id] || CAR_DEFS['weiss-blau-30'];
    setPowerMul(def.powerMul);
    setGrip(def.grip);
    setMass(def.mass);
    setBrakeForce(def.brakeForce);
    applyTuning(def.powerMul, def.grip, def.mass, def.brakeForce);
  };

  const slipDeg = (Math.abs(telemetry.slipAngle) * 180 / Math.PI).toFixed(1);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed top-4 left-4 z-50 w-84 sm:w-96 max-h-[92vh] overflow-y-auto touch-auto bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl p-4 text-white shadow-2xl font-mono text-xs select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-700/70 mb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-amber-400" />
          <span id={titleId} className="font-bold text-sm tracking-wider uppercase text-amber-400">
            M1 Vehicle Tuning Panel
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetDefaults}
            title="Reset to default car values"
            aria-label="Reset tuning to default car values"
            className="p-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            aria-label="Close tuning panel"
            className="p-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Telemetry HUD Grid */}
      <div className="grid grid-cols-3 gap-2 mb-4 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Gauge className="w-3 h-3 text-cyan-400" /> SPEED
          </span>
          <span className="text-base font-bold text-cyan-300">
            {Math.round(telemetry.speedKmh)} <span className="text-[10px] font-normal text-slate-400">km/h</span>
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Compass className="w-3 h-3 text-emerald-400" /> SLIP ANGLE
          </span>
          <span className={`text-base font-bold ${telemetry.isSliding ? "text-amber-400 animate-pulse" : "text-emerald-300"}`}>
            {slipDeg}°
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" /> RPM / GEAR
          </span>
          <span className="text-base font-bold text-amber-300">
            G{telemetry.gear} <span className="text-[10px] font-normal text-slate-400">{Math.round(telemetry.rpm)}</span>
          </span>
        </div>
      </div>

      {/* Active Car & Perk Indicator */}
      <div className="mb-4 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
        <div className="flex justify-between items-center mb-1">
          <span className="text-slate-300 font-semibold">{engine.vehicle.car.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-600/50">
            {engine.vehicle.car.className} · {engine.vehicle.car.drive}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">PERK:</span>
          <span className={`text-[10px] px-2 py-0.5 rounded font-bold transition-all ${
            telemetry.perkActive
              ? "bg-amber-500 text-black shadow-lg shadow-amber-500/50"
              : "bg-slate-700 text-slate-300"
          }`}>
            {engine.vehicle.car.perk.shortTag}
          </span>
        </div>
      </div>

      {/* Live Sliders */}
      <div className="space-y-3.5">
        {/* Power Multiplier */}
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-300">Engine Power Multiplier</span>
            <span className="text-amber-400 font-bold">{powerMul.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.4"
            max="1.8"
            step="0.05"
            value={powerMul}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setPowerMul(v);
              applyTuning(v, grip, mass, brakeForce);
            }}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {/* Lateral Grip */}
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-300">Tire Grip Coefficient</span>
            <span className="text-emerald-400 font-bold">{grip.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.6"
            max="1.6"
            step="0.02"
            value={grip}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setGrip(v);
              applyTuning(powerMul, v, mass, brakeForce);
            }}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
        </div>

        {/* Mass */}
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-300">Vehicle Mass (kg)</span>
            <span className="text-cyan-400 font-bold">{mass} kg</span>
          </div>
          <input
            type="range"
            min="600"
            max="1800"
            step="25"
            value={mass}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              setMass(v);
              applyTuning(powerMul, grip, v, brakeForce);
            }}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Brake Force */}
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-300">Braking Decel Force</span>
            <span className="text-rose-400 font-bold">{brakeForce.toFixed(1)} N/kg</span>
          </div>
          <input
            type="range"
            min="6.0"
            max="20.0"
            step="0.5"
            value={brakeForce}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setBrakeForce(v);
              applyTuning(powerMul, grip, mass, v);
            }}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-400"
          />
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-4 pt-3 border-t border-slate-800 text-[10px] text-slate-400 space-y-1">
        <p>• <strong className="text-slate-300">W / Up</strong>: Throttle | <strong className="text-slate-300">S / Down</strong>: Brake / Reverse</p>
        <p>• <strong className="text-slate-300">A / D</strong>: Steer | <strong className="text-slate-300">Space</strong>: Handbrake</p>
        <p>• <strong className="text-slate-300">R</strong>: Reset Car | <strong className="text-slate-300">T</strong>: Toggle Tuning Panel</p>
      </div>
    </div>
  );
};
