# Hillclimb

A browser-based, high-performance 3D racing game built from scratch using **Next.js**, **Three.js (Vanilla WebGL)**, and a **Custom Deterministic Physics Engine**.

![Hillclimb Gameplay](./public/apple-touch-icon-precomposed.png) *(Placeholder - Add your screenshots here)*

## Why This Project Stands Out

This project intentionally avoids off-the-shelf game engines (like Unity or Unreal) and pre-packaged physics libraries (like Cannon.js or Ammo.js) to demonstrate deep understanding of core 3D math, physics simulation, and rendering optimization. 

Key engineering challenges solved in this project include:

### 1. Custom Deterministic Physics Engine
Instead of relying on black-box physics libraries, the vehicle dynamics are simulated entirely from scratch:
- **RK4 Integrators**: High-precision Runge-Kutta 4th order numerical integration for stable, deterministic vehicle movement.
- **Tire Dynamics**: Real-time calculation of tire slip angles, friction circles, and lateral/longitudinal grip limits based on Pacejka's Magic Formula concepts.
- **Weight Transfer**: Dynamic simulation of chassis roll and pitch affecting individual tire grip during acceleration, braking, and cornering.

### 2. Procedural 3D Generation & Rendering
- **Spline-Based Track Generation**: The road geometry, complex switchbacks (tornanti), and varying camber are generated dynamically at runtime from Frenet-Serret frames along mathematical splines.
- **Unified Height-Field Terrain**: Near ground and distant mountains are one continuous surface — a single height field sampled by a single mesh builder, rather than two independently-generated surfaces that have to be kept in visual agreement. The field composes a base-altitude layer, a world-space ridge layer, and a road-carve layer that takes a minimum over every road tier within 90 m (each faded toward the surrounding landscape by its own falloff), which is what guarantees the ground stays below every nearby road, including both tiers of a stacked switchback. Ground clearance beneath the road is a property of the field itself rather than a post-process, so terrain intruding on the racing line is unrepresentable rather than merely tuned away. Geometry is built as a distance-graded quadtree — 4 m cells at the roadside easing out to 256 m at the horizon, with LOD skirts closing the seams between cell sizes — then spatially chunked so the WebGL frustum culler can still reject unseen geometry. Measured per-stage terrain triangle counts run 42k–82k (about a fifth of that is skirts), with full-scene totals (road, terrain, vegetation) of 74k–282k across the three stages.
- **Procedural Textures**: Utilizing the HTML5 Canvas API to generate high-frequency micro-detail noise maps and asphalt grain procedurally, drastically reducing network payload size without sacrificing visual fidelity.

### 3. Dynamic WebAudio Synthesis
- A custom audio orchestrator synthesizes the vehicle's engine sound dynamically using the Web Audio API. Pitch, volume, and resonance are mapped in real-time to the engine's RPM, gear state, and throttle load, creating an authentic, reactive auditory experience without looping static MP3s.

## Tech Stack
- **Frontend Framework**: Next.js (App Router)
- **Language**: TypeScript
- **3D Rendering**: Three.js (Vanilla WebGLRenderer, Custom Shaders)
- **Styling**: Tailwind CSS (UI Layer)

## Running Locally

To run the game locally, you'll need Node.js installed.

1. Clone the repository:
   ```bash
   git clone https://github.com/ivanKbyte/hillclimb.git
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
*(Currently 163/163 physics, rendering, and mathematical constraint tests passing).*
