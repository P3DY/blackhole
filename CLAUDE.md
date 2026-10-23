# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser game built on three.js and Vite: you're a black hole that eats stars, galaxy cores and rival black holes. Plain ES modules in JavaScript (no TypeScript), and `three` is the only runtime dependency. Needs Node 20.19+ / 22.12+ (Vite 8).

## Commands

```bash
npm install
npm run dev       # dev server with HMR at http://localhost:5173
npm run build     # static build into dist/ (base: './', so paths are relative)
npm run preview   # serve dist/ (dist/index.html can't be opened over file://)
```

There's no test suite, linter or formatter. To check a change, run the dev server and play the game. A build that passes only proves the code bundles.

## Docs to read first

The `docs/` folder is detailed and accurate. Read the relevant page before you change a system:

- `docs/architecture.md`: module graph, the 12-step frame order in `update()`, the rendering pipeline, the spatial grid / disk pool / jet pool data structures, and the performance budget.
- `docs/gameplay.md`: rules, mass/shadow/reach scaling, the galaxy tier table, and the rival AI state machine (feed / travel / hunt / flee).
- `docs/tuning.md`: how the constants in `src/config.js` depend on each other, and the capacity limits.

These docs quote numbers derived from `config.js` (tier tables, rival masses, star counts, inequalities). If you change a constant, update the docs that quote it.

## Architecture in brief

- `main.js` is a minimal host: it owns the renderer, camera and `OrbitControls`, and runs the loop. Delta is clamped to 0.1 s.
- `game.js` `createGame({ renderer, camera, controls })` is one closure that owns **all** game state and returns `{ scene, update(elapsed, delta), render(delta), dispose() }`. The rival AI, movement, capture and camera code live here because they share that state.
- Every other module is a stateless factory or a set of pure helpers. `config.js` holds every gameplay and rendering constant.
- Physics is 2D on the **x/z plane**. Distances and velocities ignore y, which only adds visual thickness.
- Most quantities are in **shadow radii** (`S = SHADOW_SIZE · ∛mass`), so the game feels the same at every size.
- `reset()` (also bound to **R**) restores state without rebuilding geometry.

## Invariants that span files

- **The warp has two copies.** The field vertex shader in `shaders.js` and `warpToward()` in `holes.js` must compute the same distortion, so that a captured star starts its orbit exactly where it was drawn. Change both together. Both read `WARP` from `config.js`.
- **Shaders are template strings.** `shaders.js` interpolates config values (`MAX_WARPS`, `MAX_LENSES`, `WARP.*`, `EINSTEIN`) straight into the GLSL source, through `#define` and the `glsl()` float formatter. Changing those constants changes the compiled shaders.
- **One seeded random stream.** `planUniverse()` (`universe.js`) and `buildFields()` (`fields.js`) share a single `mulberry32(UNIVERSE_SEED)` stream. Anything that changes how many random values the planning step consumes reshuffles all the galaxy geometry generated after it. Rival timers and jets use `Math.random()` on purpose. `audio.js` renders its music from its own `mulberry32` seed, so it never touches this stream.
- **The `holes` array order is `[player, ...rivals, ...cores]`.** Each hole stores its index, and disk particles refer to their owner by that index. The player goes first so it wins ties.
- **Capacity limits:**
  - `MAX_WARPS` (8) caps how many roamers can warp *and capture* stars.
  - `MAX_LENSES` (24) caps how many holes get drawn by the lens pass.
  - `disk.js` stores owners in a `Uint8Array`, so there's a hard limit of 256 holes.
  - If you add rivals or galaxies, check these first (see `docs/tuning.md`).
- **Balance rules:**
  - `1 + STARS_MASS + CORE_MASS` should stay close to `TIER_GROWTH³`.
  - `∛(1 / HUNT_PREY) · e^((HAWKING + BOOST_COST) · HUNT_TIME / 3) · RIVAL_PACE.hunt < BOOST` must hold, or some hunts can't be escaped (boosting costs mass, which makes you slower).
- **Partial GPU uploads.** Captured stars are hidden through a per-particle `aAlive` attribute, and only the dirty index range is uploaded (`addUpdateRange`). The disk pool keeps live particles packed in `[0, count)`. Keep these patterns when you touch those buffers.
- **`dispose()` doesn't own the host's objects.** It removes the game's listeners, HUD and GPU resources, but leaves the renderer, camera and controls alone.
