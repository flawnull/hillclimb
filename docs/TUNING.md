# Val Borbera Hillclimb — Physics Tuning Documentation

All vehicle and simulation constants reside in [`src/game/vehicle/vehicleTuning.ts`](src/game/vehicle/vehicleTuning.ts).

| Constant | Default Value | Unit / Range | Description & Handling Effect |
|---|---|---|---|
| `PHYSICS_DT` | `1/60` (0.01667) | s | Fixed physics simulation timestep. Mandatory for deterministic lap times & anti-cheat replay. |
| `GRAVITY` | `9.81` | m/s² | Earth gravity. Affects downforce, normal load, and grade resistance. |
| `DRAG_COEFF` | `0.42` | dimensionless | Aerodynamic drag coefficient scaling with $v^2$. Sets realistic high-speed air resistance. |
| `ROLL_RESIST` | `14.0` | N / (m/s) | Rolling resistance friction force against tires on asphalt. |
| `GRADE_SCALE` | `1.0` | multiplier | Grade sensitivity multiplier. Uphill climb saps momentum; downhill descent accelerates car. |
| `CORNER_STIFFNESS` | `18.0` | rad⁻¹ | Lateral tire stiffness. Determines turn-in grip linearity before tire breakaway/slide. |
| `DOWNFORCE_K` | `0.00015` | (m/s)⁻² | Downforce multiplier scaling with $v^2$. Increases high-speed cornering grip. |
| `MAX_DOWNFORCE_BOOST` | `0.25` | +25% | Maximum downforce grip bonus cap at peak velocity. |
| `YAW_RESPONSE` | `9.5` | rad/s | Responsiveness of yaw rate blending toward target kinematic Ackerman turn. |
| `STEER_SPEED_SENSITIVITY` | `40.0` | m/s (~144 km/h) | Speed at which max steering angle smoothly scales down to prevent twitchy phone controls. |
| `MIN_STEER_RATIO` | `0.35` | 0..1 | Steering angle scaling floor at high speeds for high-speed stability. |
| `DIGITAL_STEER_RAMP` | `3.2` | rad/s | Ramp rate for digital keyboard / touch button steering. |
| `STEER_RETURN_RATE` | `5.0` | rad/s | Auto-centering return speed when steering input is released. |
| `PEDAL_RAMP_RATE` | `10.0` | 1/s | Pedal application smoothing (0 to 1 in 0.1s) for responsive yet smooth acceleration/braking. |
| `HANDBRAKE_YAW_MUL` | `1.6` | multiplier | Yaw rotation amplifier when handbrake is engaged for snapping into tight hairpins. |
| `HANDBRAKE_GRIP_MUL` | `0.45` | multiplier | Rear tire grip reduction multiplier during handbrake pull to induce intentional drift. |
| `RWD_OVERSTEER_POWER_PENALTY` | `0.30` | 0..1 | Engine force reduction when power sliding on RWD cars to demand throttle feathering. |
| `STEERING_ASSIST_BLEND` | `0.12` | 0..1 | Blending ratio aligning car toward road tangent when speed > 25 m/s and no steering input. |
| `STEERING_ASSIST_SPEED_THRESHOLD` | `25.0` | m/s (90 km/h) | Speed threshold above which tangent steering assist subtly engages. |
| `SLIP_SMOKE_THRESHOLD_RAD` | `0.1047` (~6°) | rad | Slip angle threshold above which tires emit smoke particles and audio squeal. |
| `SURFACE_PROPERTIES.asphalt` | grip: `1.0`, roll: `1.0` | - | Standard dry road ribbon baseline. |
| `SURFACE_PROPERTIES.worn` | grip: `0.92`, roll: `1.02` | - | Darker patched mountain asphalt with slightly lower grip. |
| `SURFACE_PROPERTIES.gravel` | grip: `0.62`, roll: `1.9` | - | 0.8m verge strip each side. Slows car down and induces slide. |
| `SURFACE_PROPERTIES.grass` | grip: `0.45`, roll: `3.2` | - | Off-road alpine pasture. Heavy rolling drag and low friction. |

## Local workflow: never build while a dev server is running

`next dev` and `next build` both write to `distDir`, and their output is not
interchangeable. Running a production build while a dev server is live replaces the dev
chunks; the running server then fails with `Cannot find module './611.js'`.

`next.config.ts` honours `NEXT_DIST_DIR`, and `npm run build:verify` points it at
`.next-verify`. That keeps the *main* build output away from `.next`, but Next still
writes a small manifest/type cache into `.next` regardless, so it is only a partial
guard. The reliable sequence is:

1. stop the dev server
2. `npm run build` (or `npm run build:verify`)
3. `rm -rf .next`
4. restart `npm run dev`

If you hit the error, `rm -rf .next` and restart the dev server. Nothing is wrong with
the source; only the build directory is corrupt.
