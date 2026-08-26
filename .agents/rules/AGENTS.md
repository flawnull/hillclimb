# Val Borbera Hillclimb — Agentic Constraints & Game Plan

## Tech Stack
- **Frontend Framework**: Next.js (App Router, hosted on Vercel)
- **3D Rendering**: Three.js (Vanilla, WebGLRenderer with PCFSoftShadowMap)
- **Game Engine & Physics**: Custom Vanilla TypeScript (Deterministic math, RK4 integrators)
- **Procedural Generation**: Canvas API (used for textures and road generation)

## Core Directives & Tips
- **Visually Premium Aesthetics**: The game must look high-end and professional. Avoid flat, unlit PS1-era shading, "coder art", or basic uncoordinated noise. Always aim for rich lighting, smooth gradients, and visually stunning procedural textures (e.g., proper micro-detail bump maps for terrain, detailed asphalt for roads).
- **Verify with Builds & Tests**: Run `npm test` as soon as you complete a feature or task to ensure the rigorous physics, math, and rendering budgets remain unbroken. Avoid running `npm run build` while `npm run dev` is running in the background, as Next.js will corrupt the shared `.next` cache and cause runtime "Cannot find module" chunk errors.
- **Utilize Browser Subagents**: Use the `browser_subagent` tool to visit `localhost:3000`, test the visual output of your work, and read the console for runtime errors. Iterate immediately if the visual output doesn't match the premium vibe.
- **Generate UI/UX Assets**: Use the `generate_image` tool to ideate and mock up UI components before building them, keeping prompts consistent.
- **Log Decisions in Artifacts**: Use `implementation_plan.md` to guide complex architectural changes. Track ongoing tasks in `task.md`, and summarize completions in `walkthrough.md` to record your thought process and decisions.
- **Look Before You Code**: Do not guess what existing systems do. Always read the code, understand the rendering orchestration, chunking logic, and state management before modifying it. Follow SOLID design principles.

## Development Loop
1. **Plan**: Define the feature, rendering changes, or physics updates in `implementation_plan.md`.
2. **Execute**: Modify the modular TypeScript systems (e.g., `RenderingOrchestrator`, `Terrain`, `RoadTextureGenerator`).
3. **Verify**: Ensure the math and geometry hold up via automated tests.
4. **Visually Inspect**: Confirm the rendering output in the browser console/screenshots.
