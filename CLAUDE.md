# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser game built on three.js and Vite: you're a black hole that eats stars, galaxy cores and rival black holes, from a hand-made opening of 16 real galaxies out through an endless universe of giant galaxies, groups, clusters, superclusters and great walls, until you outweigh the observable universe. Plain ES modules in JavaScript (no TypeScript), and `three` is the only runtime dependency. Needs Node 20.19+ / 22.12+ (Vite 8).

## Commands

```bash
npm install
npm run dev       # dev server with HMR at http://localhost:5173
npm run build     # static build into dist/ (base: './', so paths are relative)
npm run preview   # serve dist/ (dist/index.html can't be opened over file://)
```

There's no test suite, linter or formatter. To check a change, run the dev server and play the game. A build that passes only proves the code bundles. In development, `?tier=N` in the address starts you at tier N, beside a cell of ring N, so you can try any scale without playing up to it. `window.blackHole` holds the renderer, camera and scene for the console.

## Docs to read first

The `docs/` folder is detailed and accurate. Read the relevant page before you change a system:

- `docs/architecture.md`: module graph, the endless universe (rings of cells, streaming, deltas, fading), the 13-step frame order in `update()`, the rendering pipeline, the spatial grid / disk pool / hole slots / jet pool data structures, and the performance budget.
- `docs/gameplay.md`: rules, mass/shadow/reach scaling, the galaxy tier table, the scales past the opening and their real names, and the rival AI state machine (feed / travel / hunt / flee).
- `docs/tuning.md`: how the constants in `src/config.js` depend on each other, and the capacity limits.

These docs quote numbers derived from `config.js` (tier tables, rival masses, star counts, inequalities). If you change a constant, update the docs that quote it.

## Architecture in brief

- `main.js` is a minimal host: it owns the renderer, camera and `OrbitControls`, and runs the loop. Delta is clamped to 0–0.1 s. The game scales the camera's near and far planes with you each frame.
- `game.js` `createGame({ renderer, camera, controls })` is one closure that owns **all** game state and returns `{ scene, update(elapsed, delta), render(delta), dispose() }`. The rival AI, movement, capture and camera code live here because they share that state.
- Every other module is a factory or a set of pure helpers. Factories hold only what they make: the disk and jet pools, and the streamer's records. `config.js` holds every gameplay and rendering constant.
- **The universe past the opening is streamed.** `cosmos.js` lays it out as rings of cells, pure and deterministic, with names from `names.js`. `stream.js` keeps a record for each cell near you. It makes the cell's core (and maybe a rival) at once through callbacks into `game.js`, and its star fields arrive a few frames later from a worker, `builder.js`, because building one takes about 20 ms. Records far away or long outgrown are dropped, and what you changed in them is kept as a delta. Everything you outgrow fades out, the opening included.
- Physics is 2D on the **x/z plane**. Distances and velocities ignore y, which only adds visual thickness.
- Most quantities are in **shadow radii** (`S = SHADOW_SIZE · ∛mass`), so the game feels the same at every size.
- `reset()` restores the starting state without rebuilding the opening's geometry, and `restore()` puts back a checkpoint the same way. Each core or rival you swallow saves one (`saveCheckpoint()`) once it's safe. **R** and the menu's Retry call `retry()`, which restores the last checkpoint, or resets if there isn't one. A checkpoint copies the opening's alive flags, the streamer's deltas, every hole (by key), the disk pool and the stats. If you add state that changes during play, add it to the checkpoint too, and if it lives in a cell of the endless universe, to its delta.
- The settings menu is tabbed. `hud.js` adds the Game tab (Retry, Start over), `audio.js` the Sound tab and `pointer.js` the Touch tab, in that order.
- **Game time can run slow.** `hints.js` returns a time scale (4% during a slowed moment), and `update()` multiplies the host's delta by it before simulating. Anything that's part of the game world must use that scaled `delta`. The hints and the audio take the real frame delta, and OrbitControls runs in real time.

## Invariants that span files

- **The warp has two copies.** The field vertex shader in `shaders.js` and `warpToward()` in `holes.js` must compute the same distortion, so that a captured star starts its orbit exactly where it was drawn. Change both together. Both read `WARP` from `config.js`.
- **Shaders are template strings.** `shaders.js` interpolates config values (`MAX_WARPS`, `MAX_LENSES`, `WARP.*`, `EINSTEIN`) straight into the GLSL source, through `#define` and the `glsl()` float formatter. Changing those constants changes the compiled shaders.
- **Seeded random streams.** The opening's `planUniverse()` (`universe.js`) and `buildFields()` (`fields.js`) share a single `mulberry32(UNIVERSE_SEED)` stream. Anything that changes how many random values the planning step consumes reshuffles all the opening's galaxy geometry generated after it. Past the opening, every cell has its own streams from `seedOf(UNIVERSE_SEED, ring, sector, …)`: one for its layout (`cellAt()`), one for whether it has a rival, and one for its particles (`buildCellParts()`). So cells can be built in any order, on any thread, and come out the same. Rival timers and jets use `Math.random()` on purpose. `audio.js` renders its music from its own `mulberry32` seed, so it never touches these streams.
- **Black holes live in slots.** Each hole stores its slot as `index`, and disk particles refer to their owner by slot. `addHole()` and `removeHole()` (in `game.js`) are the only way in and out: removing releases the slot's disk particles and marks the hole `gone`. `holes` lists them with the player first, so it wins ties. Slots get reused, so anything kept across a checkpoint refers to holes by `key`.
- **Capacity limits:**
  - `MAX_WARPS` (8) caps how many roamers can warp *and capture* stars, so new rivals only appear while fewer than 7 are about.
  - `MAX_LENSES` (32) caps how many holes get drawn by the lens pass. Past the opening there can be more, and the biggest on screen win.
  - `MAX_HOLES` (128) caps the slots. `disk.js` stores owners in a `Uint8Array`, so it can't go past 256.
  - If you add rivals, galaxies or cells, check these first (see `docs/tuning.md`).
- **Balance rules:**
  - `1 + STARS_MASS + CORE_MASS` should stay close to `TIER_GROWTH³`.
  - `∛(1 / HUNT_PREY) · e^((HAWKING + BOOST_COST) · HUNT_TIME / 3) · RIVAL_PACE.hunt < BOOST` must hold, or some hunts can't be escaped (boosting costs mass, which makes you slower).
- **Partial GPU uploads.** Captured stars are hidden through a per-particle `aAlive` attribute, and only the dirty index range is uploaded (`addUpdateRange`). The disk pool keeps live particles packed in `[0, count)`. Keep these patterns when you touch those buffers.
- **One shader, a material per field.** Every star field has its own `ShaderMaterial` for its `uFade`, sharing the other uniforms' objects (`fieldUniforms` in `game.js`), so three.js compiles a single program. Write shared uniforms to `fieldUniforms`, not to one field's material.
- **`dispose()` doesn't own the host's objects.** It removes the game's listeners, HUD and GPU resources, and stops the streamer's worker, but leaves the renderer, camera and controls alone.
