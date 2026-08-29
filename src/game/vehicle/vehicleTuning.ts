/**
 * VAL BORBERA HILLCLIMB — Vehicle Physics Tuning Constants
 * All physics constants live here. No magic numbers in code.
 * Units: SI (metres, seconds, kg, radians, Newtons)
 */

/**
 * Deterministic simulation version. Monotonically increasing integer.
 *
 * The leaderboard rests on deterministic replay: a stored input trace is
 * re-simulated server-side and rejected if the resulting time differs by more
 * than 5 ms. Any change to the simulation therefore invalidates every time
 * already recorded — legitimate old replays would be rejected as cheating,
 * while old times would linger on the board as ghosts of different physics.
 *
 * BUMP THIS (by exactly 1) for ANY edit to ANY of the following:
 *   - src/game/vehicle/vehicleTuning.ts   (this file — any physics constant)
 *   - src/game/vehicle/VehicleModel.ts    (the vehicle integrator)
 *   - src/game/vehicle/cars.ts            (per-car stats and perks)
 *   - src/game/vehicle/deterministicMath.ts (the cross-engine math kernel)
 *   - src/game/track/TrackSpline.ts       (Frenet projection / sampling)
 *   - src/game/timing/Timer.ts            (split, penalty and finish logic)
 *   - src/game/track/stages/*             (any stage definition or geometry)
 *
 * Bumping re-keys the leaderboards (lb:{sim}:{stage}:{class}) and invalidates
 * outstanding run tokens, so runs from different physics can never mix.
 * Editing any file above WITHOUT bumping silently corrupts the leaderboard.
 *
 * Also bump when the REPLAY PIPELINE changes in a way that alters what a recorded run
 * contains, since re-simulation compares against exactly those frames.
 *
 * 5 -> 6: the replay recorder dropped the frame that crosses the finish line (the timer had
 *   already flipped to 'finished' before the recording check ran), so every replay was one
 *   frame shorter than the time it claimed and the server re-simulation came out 16.67 ms
 *   low — outside the 5 ms tolerance. No legitimately completed run could validate. The same
 *   release added the missing completion check to the validator, which until then accepted a
 *   replay of all-zero inputs as a finished run. Any entry standing on the old leaderboards
 *   was therefore necessarily forged, so this bump also serves to retire them.
 *   The same release moved trackBuilder.ts off native Math.sin/cos/PI onto the deterministic
 *   kernel. That geometry feeds TrackSpline's Frenet projection on both the client and the
 *   Edge re-simulation, and native trig is not bit-identical across V8, JavaScriptCore and
 *   Hermes, so a run recorded on one engine could fail to reproduce on another. Control point
 *   positions shift by a hair as a result, which is a stage-geometry change in its own right.
 *
 * 6 -> 7: handling rework. The car understeered into a slide at any real cornering load and
 *   keyboard steering took 0.31 s to reach full lock while losing 65% of its authority by
 *   144 km/h — sim conventions that assume an analog wheel. Cornering stiffness, yaw response,
 *   the digital steering ramp, the return rate and the high-speed steering floor all changed,
 *   so lap times under the new handling are not comparable to the old ones.
 *
 * 7 -> 8: reverse could be entered by accident. Braking below 0.35 m/s engaged it, and since
 *   the condition tested forward velocity it stayed true once moving backwards, so the car
 *   accelerated in reverse without limit while the player held what they thought was the
 *   brake — reaching 30 km/h backwards, at which point steering looks inverted on screen.
 *   Reverse must now be selected (stop, release the brake, hold it again), any throttle
 *   cancels it, and reverse speed is capped at REVERSE_MAX_SPEED.
 *
 * 8 -> 9: steering was inverted on screen. The input layer uses -1 = left / +1 = right, but
 *   this model's heading convention rotates the car toward +X as heading increases, and with
 *   the chase camera behind the car +X is screen-LEFT. The command is now negated where the
 *   axis enters the model. Reported repeatedly and twice mis-verified: the spline `t` sign
 *   convention is not dependable, and measuring against the chase camera AFTER it has rotated
 *   with the car is self-referential. Measured against the camera basis sampled BEFORE the
 *   input, A moved the car +0.50 to screen-right; it now moves -0.45 to screen-left.
 *
 * 9 -> 10: steering stability. The previous pass over-corrected: full lock in 0.15 s with
 *   almost no speed sensitivity meant every key press snapped to maximum steering and the car
 *   darted rather than turning. Ramp eased to 0.24 s, yaw response reduced, and some
 *   speed-sensitive falloff restored, so inputs build weight instead of switching.
 *
 * 10 -> 11: stage geometry. Salita di Cosola rewritten from 11.5 km / 38 hairpins to 5.6 km /
 *   15, in three movements (wooded switchbacks, open traverse, exposed ridge) so the corners
 *   stop repeating and a run takes minutes rather than nine of them. Cresta Ebro is removed
 *   as a separate stage and its character — real altitude, ground falling away on both sides
 *   — folded into the new ridge finale at drop depths that read as a mountain rather than the
 *   1,300 m that made it look like a desert canyon.
 */
export const SIM_VERSION = 11;

/*
 * Version history — append a line whenever this is bumped.
 *
 *   1  Initial versioned physics.
 *   2  deterministicMath.detAtan gained two-stage range reduction: peak error fell from
 *      2.96e-2 rad (1.70 deg, with a 3.39 deg discontinuity at |x| = 1) to 3.8e-9 rad.
 *      atan2 feeds spline heading and vehicle slip angle, so every lap time shifted.
 *      Salita di Cosola also grew from 8.83 km / 1,263 m to 10.82 km / 1,505 m.
 *   3  Wall collisions became edge-triggered and now clamp the car to the road edge.
 *      Previously the +2.0 s penalty was charged EVERY physics step spent past the edge
 *      (120 s of penalty per second off-road) and nothing stopped the car leaving the
 *      road at all, so a 0.7 s brush cost 84 s and stranded the player in a field.
 *   4  Borbera Sprint hairpin turns gained outer guardrails and clearance protection
 *      so wide drifts around apex do not trigger false off-road cliff respawns.
 *   5  Spline tangent calculation upgraded to smooth central-differences, exact arc length
 *      accumulation, and rotating body-frame lateral acceleration for realistic slip angle dynamics.
 */

/** Fixed physics simulation timestep in seconds (60 Hz) */
export const PHYSICS_DT = 1 / 60;


/** Earth gravitational acceleration in m/s² */
export const GRAVITY = 9.81;

/** Aerodynamic drag coefficient (scales with v²) */
export const DRAG_COEFF = 0.42;

/** Base rolling resistance coefficient (N per m/s) */
export const ROLL_RESIST = 14.0;

/** Longitudinal grade force multiplier (uphill saps speed, downhill accelerates) */
export const GRADE_SCALE = 1.0;

/** Lateral cornering stiffness (rad^-1) for linear slip angle regime */
// Raised from 18.0. The car washed out under cornering load rather than biting, so every
// corner became a drift whether or not you wanted one. More lateral stiffness means the
// front end takes a set and holds it; the handbrake and throttle still break traction
// deliberately, which is where sliding belongs.
export const CORNER_STIFFNESS = 23.0;

/** Downforce coefficient k (downforce = 1 + k * v^2) */
export const DOWNFORCE_K = 0.00015;

/** Maximum downforce multiplier cap (+25% grip) */
export const MAX_DOWNFORCE_BOOST = 0.25;

/** Yaw response blend rate (higher = snappier direction change) */
// Raised from 9.5. Governs how quickly yaw rate converges on the kinematic target; too low
// and the car rotates lazily behind your input, which reads as floaty on a keyboard.
// Eased back from 12.5. Yaw was converging on the target so fast that the car changed
// direction almost instantly on input, with none of the weight a car carries into a turn.
// 10.5 keeps it responsive while letting the mass be felt.
export const YAW_RESPONSE = 10.5;

/** Speed in m/s (approx 144 km/h) at which steering angle lerps down to MIN_STEER_RATIO */
export const STEER_SPEED_SENSITIVITY = 40.0;

/** Minimum steering angle ratio at high speed for stability */
// Raised from 0.35. Speed-sensitive steering is a sim convention that assumes an analog
// wheel: with a keyboard you have no fine control to compensate with, so cutting lock to 35%
// just makes the car feel unresponsive. At 100 km/h the old value left only 55% of lock
// available. 0.60 keeps high-speed stability without the vagueness.
// Some speed sensitivity restored. 0.60 kept nearly full lock available at any speed, which
// is what made the car feel darty and nervous at pace — a small input at 120 km/h produced
// as much steering angle as it would in a car park. 0.48 still leaves far more authority
// than the original 0.35, without the twitchiness.
export const MIN_STEER_RATIO = 0.48;

/** Steering ramp rate in radians per second for digital input (keyboard/buttons) */
// Raised from 3.2 rad/s, which took 0.31 s to reach full lock — a third of a second of the
// car ignoring you after a key press. This game is played on a keyboard most of the time, so
// input has to commit quickly; 6.5 reaches full lock in about 0.15 s.
// 6.5 was an over-correction. Reaching full lock in 0.15 s makes every tap of the key a
// snap to maximum steering, so the car darts rather than turning: there is no range between
// 'straight' and 'fully committed'. 4.2 reaches full lock in ~0.24 s, which still responds
// promptly to a press but gives a usable band in between, so a short tap is a small
// correction and a held key is a full turn.
export const DIGITAL_STEER_RAMP = 4.2;

/** Steering auto-center return rate in radians per second */
// Raised alongside the ramp so the car straightens as promptly as it turns in.
// Return stays a little quicker than the ramp so the car settles straight rather than
// hunting, but not so fast that it snaps back the instant you release.
export const STEER_RETURN_RATE = 6.0;

/** Throttle / Brake digital ramp rate (0 to 1 in 0.1s) */
export const PEDAL_RAMP_RATE = 10.0;

/** Maximum reverse speed in m/s (~22 km/h). Reversing is for manoeuvring, not for racing. */
export const REVERSE_MAX_SPEED = 6.0;

/** Handbrake yaw rotation multiplier (encourages hairpin rotation) */
export const HANDBRAKE_YAW_MUL = 1.6;

/** Handbrake rear grip reduction multiplier */
export const HANDBRAKE_GRIP_MUL = 0.45;

/** Engine power loss ratio when sliding for RWD cars (power-on oversteer penalty) */
export const RWD_OVERSTEER_POWER_PENALTY = 0.30;

/** Steering assist blend factor toward road tangent when speed > threshold and no input */
export const STEERING_ASSIST_BLEND = 0.12;

/** Speed threshold in m/s for steering assist activation */
export const STEERING_ASSIST_SPEED_THRESHOLD = 25.0;

/** Slip angle threshold in radians (~6 degrees) for tire smoke and squeal */
export const SLIP_SMOKE_THRESHOLD_RAD = 0.1047; // ~6.0 deg

/** Maximum slip angle for drift scoring calculations (~25 degrees) */
export const MAX_DRIFT_SLIP_RAD = 0.4363; // ~25 deg

/** Surface grip and rolling resistance lookup table */
export const SURFACE_PROPERTIES = {
  asphalt: { gripMul: 1.0, rollMul: 1.0 },
  worn: { gripMul: 0.92, rollMul: 1.02 },
  gravel: { gripMul: 0.62, rollMul: 1.9 },
  grass: { gripMul: 0.45, rollMul: 3.2 },
  wet: { gripMul: 0.74, rollMul: 1.05 },
} as const;

export type SurfaceType = keyof typeof SURFACE_PROPERTIES;

/** Physics steps that must pass before another wall-collision penalty can be charged.
 *  The penalty is charged on ENTERING contact; this stops a single scrape being billed
 *  once per step at 60 Hz. 45 steps = 0.75 s. */
export const WALL_PENALTY_COOLDOWN_STEPS = 45;

/** How far past the road edge the wall sits, metres. */
export const WALL_CONTACT_MARGIN = 0.45;
