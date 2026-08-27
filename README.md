# Hillclimb

A browser-based, high-performance 3D racing game built from scratch using **Next.js**, **Three.js (Vanilla WebGL)**, and a **Custom Deterministic Physics Engine**.

![Salita di Cosola — stacked switchbacks](./docs/screenshots/salita-cosola.png)
*Salita di Cosola: two tiers of a switchback with continuous hillside between them.*

| Borbera Sprint | Cresta Ebro |
|---|---|
| ![Borbera Sprint](./docs/screenshots/borbera-sprint.png) | ![Cresta Ebro](./docs/screenshots/cresta-ebro.png) |
| Valley floor, with the Borbera and its gravel bed | High ridge road, drops to both sides |

*Screenshots are generated reproducibly from fixed camera poses via `npm run visual-check`.*

## Why This Project Stands Out

This project intentionally avoids off-the-shelf game engines (like Unity or Unreal) and pre-packaged physics libraries (like Cannon.js or Ammo.js) to demonstrate deep understanding of core 3D math, physics simulation, and rendering optimization. 

Key engineering challenges solved in this project include:

### 1. Custom Deterministic Physics Engine
Instead of relying on black-box physics libraries, the vehicle dynamics are simulated entirely from scratch. The interesting problem here is not model complexity — it is **bit-level reproducibility across JavaScript engines**, because the anti-cheat re-simulates every submitted run server-side and compares it to the claimed time within a 5 ms tolerance.

- **Fixed-step semi-implicit Euler**: A 60 Hz fixed timestep driven by an accumulator, interpolated for rendering, so the simulation is entirely frame-rate independent. Semi-implicit (symplectic) Euler is chosen over a higher-order integrator deliberately: at a fixed 60 Hz it is stable for this model, and every extra force evaluation is another opportunity for cross-engine floating-point divergence.
- **Deterministic math kernel**: `Math.sin`/`cos`/`tan`/`atan2` are **not** bit-identical across V8, JavaScriptCore and Hermes, so the entire simulation path routes through a hand-written kernel (`deterministicMath.ts`) built only from `+ - * /` and comparisons. A source-purity test scans every file on that path — vehicle, spline, timer, track builder and stage definitions — and fails the build if a native trig call or `Math.PI` appears in any of them.
- **Tire model**: Slip angles are computed per-axle from the velocity vector and yaw rate, producing a lateral force that is linear in slip angle up to a grip ceiling scaled by surface, downforce and handbrake state. This is a deliberate simplification, not a Pacejka curve — there is no peak-then-falloff beyond the limit, and longitudinal and lateral forces are currently clamped independently rather than sharing a friction circle. Combined-slip coupling is the most worthwhile next step for the handling model.
- **Verified end to end**: The re-simulation runs the real `VehicleModel` against the recorded input trace on the Edge runtime and reproduces the client's time and penalty totals exactly, including across off-road respawns. That equivalence is asserted by the test suite on every stage.

### 2. Procedural 3D Generation & Rendering
- **Spline-Based Track Generation**: The road geometry, complex switchbacks (tornanti), and varying camber are generated dynamically at runtime from Frenet-Serret frames along mathematical splines.
- **Unified Height-Field Terrain**: Near ground and distant mountains are one continuous surface — a single height field sampled by a single mesh builder, rather than two independently-generated surfaces that have to be kept in visual agreement. The field composes a base-altitude layer, a world-space ridge layer, and a road-carve layer that takes a minimum over every road tier within 90 m (each faded toward the surrounding landscape by its own falloff), which is what guarantees the ground stays below every nearby road, including both tiers of a stacked switchback. Ground clearance beneath the road is a property of the field itself rather than a post-process, so terrain intruding on the racing line is unrepresentable rather than merely tuned away. Geometry is built as a distance-graded quadtree — 4 m cells at the roadside easing out to 256 m at the horizon, with LOD skirts closing the seams between cell sizes — then spatially chunked so the WebGL frustum culler can still reject unseen geometry. Measured per-stage terrain triangle counts run 42k–82k (about a fifth of that is skirts), with full-scene totals (road, terrain, vegetation) of 74k–282k across the three stages.
- **Procedural Textures**: Utilizing the HTML5 Canvas API to generate high-frequency micro-detail noise maps and asphalt grain procedurally, drastically reducing network payload size without sacrificing visual fidelity.

### 3. Server-Verified Anti-Cheat
Leaderboard times are not trusted from the client. Submitting a run sends the full input trace, and the Edge runtime replays it through the identical `VehicleModel`, `TrackSpline` and `Timer` used in the browser:
- The submitted time must match the re-simulated time within 5 ms, which is only achievable because the whole simulation path is bit-reproducible (see above).
- The replay must actually reach the final checkpoint — a trace that merely runs long enough is rejected, since elapsed time alone is just a frame count.
- Run tokens are HMAC-signed over `runId | stageId | carId | issuedAt | simVersion`, expire in 30 minutes, and a wall-clock check rejects submissions faster than real time.
- `SIM_VERSION` re-keys the leaderboards whenever anything on the simulation path changes, so runs recorded under different physics can never be ranked against each other.

### 4. Dynamic WebAudio Synthesis
- A custom audio orchestrator synthesizes the vehicle's engine sound dynamically using the Web Audio API. Pitch, volume, and resonance are mapped in real-time to the engine's RPM, gear state, and throttle load, creating an authentic, reactive auditory experience without looping static MP3s.

## Tech Stack
- **Frontend Framework**: Next.js (App Router)
- **Language**: TypeScript
- **3D Rendering**: Three.js (Vanilla WebGLRenderer — no react-three-fiber in the hot path; the renderer is a plain imperative class driving a bare `<canvas>`)
- **Styling**: Tailwind CSS (UI Layer)

## Running Locally

To run the game locally, you'll need Node.js installed.

1. Clone the repository:
   ```bash
   git clone https://github.com/flawnull/hillclimb.git
   cd hillclimb
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note**: Avoid running `npm run build` and `npm run dev` concurrently, as they share the `.next` directory and can cause cache corruption.

## Testing

The custom physics and rendering budgets are strictly enforced by a comprehensive test suite.
```bash
npm test
```
*(Currently 169/169 physics, rendering, anti-cheat and mathematical constraint tests passing.)*
