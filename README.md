# Black Hole

A three.js game. You are a black hole drifting through a universe of galaxies. Capture stars to grow, swallow galaxy cores and rival black holes once you outweigh them, and run from the ones that outweigh you. You win when you're the last black hole left.

Everything is procedural (seeded, so the universe is the same on every visit) and rendered with GPU particle fields, CPU-simulated accretion disks, and screen-space gravitational lensing and bloom.

## Quick start

Requires Node.js 20.19+ (or 22.12+), which Vite 8 needs.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default).

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the `dist/` build locally to check it |

## Controls

| Input | Action |
|-------|--------|
| Mouse | Drift toward the cursor. The further the cursor is from you, the harder you thrust |
| **W A S D** / arrow keys | Drift, relative to where the camera looks. Keys take over from the mouse until it moves again |
| **Shift** / hold right mouse button | Boost (1.8× thrust, burns mass) |
| Left-drag | Orbit the camera. You hold your course while you drag |
| Scroll | Zoom |
| **R** | Restart |

On a touch screen:

| Gesture | Action |
|---------|--------|
| One-finger drag | Joystick, centred where your finger lands. Drag further for more thrust |
| Drag past the ring | Boost |
| Two fingers | Pinch to zoom, drag to orbit |

## How to play

- Drift into stars to capture them. They spiral into your accretion disk and add to your mass when they cross your shadow.
- **Red rings** mark black holes that outweigh you, at the distance where their pull beats your thrust. Cross one and you won't get back out.
- Every galaxy has a **supermassive core**. Once you outweigh it, fly into it to take its mass.
- Five **rivals** roam between galaxies and eat the same stars. They keep only 30% of what they eat, so you can outgrow them. Rivals hunt you while you're smaller (boosting outruns them) and flee once you're bigger.
- **Hawking radiation** slowly shrinks you (0.3% of your mass per second), and boosting burns another 1.5% per second, so keep eating.
- The HUD stays out of the way: your mass and feeding rate in the corner, and arrows at the screen edge toward the nearest black holes when they're out of view (blue: you outweigh it, red: it outweighs you). There are no pop-up messages during play.
- You win when every core and every rival is gone.

[docs/gameplay.md](docs/gameplay.md) has the full rules and the rival AI.

## Project structure

```
index.html          page shell, intro panel (title, pitch, controls)
vite.config.js      relative base path for portable builds
src/
  main.js           renderer, camera, OrbitControls, render loop
  game.js           createGame(): the scene, the simulation and the frame update
  config.js         every gameplay and rendering constant
  universe.js       procedural layout: galaxies, nebulae, rivals, start point (plain data)
  fields.js         star fields built from that layout: galaxy, nebula and loose-star geometry
  grid.js           spatial grid used to find stars within reach
  holes.js          black hole objects and the shared gravity helpers
  disk.js           pooled accretion-disk particle simulation
  jets.js           ring-buffered relativistic-jet particles
  shaders.js        all GLSL: star fields, disks, jets, lensing pass
  pointer.js        mouse and touch steering, and the touch joystick
  hud.js / hud.css  DOM overlay: mass readout, edge arrows, vignette, end-of-game card
  style.css         page base styles and intro panel
  utils.js          seeded random, backdrop starfield, GPU disposal helper
docs/
  gameplay.md       rules, scaling, rival AI
  architecture.md   frame loop, rendering pipeline, data structures, performance
  tuning.md         what the constants in config.js do and how they interact
```

## Deploying

`npm run build` writes a static site to `dist/`. Because `base` is `'./'`, every asset path is relative, so you can upload the folder anywhere: GitHub Pages, Netlify, an itch.io HTML5 upload (zip the contents of `dist/`), or any static host. Don't open `dist/index.html` straight from disk, because browsers block ES modules on `file://`. Use `npm run preview` or a static server instead.

## Embedding

`createGame({ renderer, camera, controls })` in `src/game.js` takes an existing three.js renderer, a `PerspectiveCamera` and `OrbitControls`. It returns `{ scene, update(elapsed, delta), render(delta), dispose() }`. Call `update` and then `render` every frame. `dispose()` removes the game's listeners, its HUD and its GPU resources. `src/main.js` is the minimal host.

## Browser support

The game needs WebGL 2, which every current desktop and mobile browser has. It plays with keyboard, mouse or touch. The intro panel fades out at the first click, touch, key press or scroll, or after 20 seconds. Performance depends mostly on fill rate: with additive particles, bloom and lensing at full resolution, a low-end GPU at a high pixel ratio is the usual bottleneck. The renderer caps the pixel ratio at 2.

## Origin

This started as demo #7 of a three.js animation playground. There, the galaxies came from that project's Particle Galaxy demo. This repository is the game on its own, with no dependencies beyond `three`.
