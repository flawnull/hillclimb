import { VehicleModel, GroundQuery, InputState } from "../src/game/vehicle/VehicleModel";
import { PHYSICS_DT } from "../src/game/vehicle/vehicleTuning";
const ground: GroundQuery = { groundY: 0, roadPitch: 0, roadBank: 0, surface: "asphalt", onRoad: true, baseAltitude: 560 };

function run(car: string, input: InputState, entryKmh: number, secs: number) {
  const v = new VehicleModel(car);
  const acc: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: false };
  let g = 0; while (v.state.speedKmh < entryKmh && g++ < 8000) v.step(PHYSICS_DT, acc, ground, false);
  const coast: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  for (let i = 0; i < 30; i++) v.step(PHYSICS_DT, coast, ground, false);
  const entry = v.state.speedKmh;
  let peakSlip = 0, radius = 0;
  for (let i = 0; i < secs * 60; i++) {
    v.step(PHYSICS_DT, input, ground, false);
    const slip = Math.abs(Math.atan2(v.state.vLateral, Math.abs(v.state.vForward) + 0.5)) * 180 / Math.PI;
    peakSlip = Math.max(peakSlip, slip);
    if (i === Math.floor(secs * 30)) radius = Math.abs(v.state.yawRate) > 1e-3 ? v.state.speedMs / Math.abs(v.state.yawRate) : Infinity;
  }
  return { entry, exit: v.state.speedKmh, keep: v.state.speedKmh / entry, peakSlip, radius };
}

const CAR = "weiss-blau-30";
const cases: [string, InputState, number, number][] = [
  ["steady corner, part throttle", { steer: 0.45, throttle: 0.55, brake: 0, handbrake: false }, 60, 3],
  ["hairpin, coasting          ", { steer: 1.0, throttle: 0, brake: 0, handbrake: false }, 45, 2.5],
  ["flick + handbrake          ", { steer: 0.9, throttle: 0.4, brake: 0, handbrake: true }, 55, 1.5],
  ["gentle sweeper             ", { steer: 0.22, throttle: 0.8, brake: 0, handbrake: false }, 80, 3],
];
for (const [label, input, entry, secs] of cases) {
  const r = run(CAR, input, entry, secs);
  console.log(`${label}  ${r.entry.toFixed(0)} -> ${r.exit.toFixed(0)} km/h (keeps ${(r.keep*100).toFixed(0)}%)  peak slip ${r.peakSlip.toFixed(0)}deg  radius ${r.radius.toFixed(0)} m`);
}
