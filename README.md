# Black Hole

A three.js game. You are a black hole drifting through a universe of galaxies. Capture stars to grow, swallow galaxy cores and rival black holes once you outweigh them, and run from the ones that outweigh you. Start among 16 real galaxies, then keep growing through an endless universe of giant galaxies, galaxy groups, clusters, superclusters and great walls, all named for real ones. You win when you outweigh the observable universe.

Everything is procedural (seeded, so the universe is the same on every visit) and rendered with GPU particle fields, CPU-simulated accretion disks, and screen-space gravitational lensing and bloom. Past the opening, the universe is built around you as you go, in a background worker.

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
| **R** | Retry from your last checkpoint (or from the start, if you haven't reached one) |
| Gear menu (top left), Game tab | **Retry**, or **Start over** from the beginning (press it twice, since it throws your checkpoint away) |
| **M** / gear menu, Sound tab | Mute or unmute. The Sound tab also mutes music or effects on their own. Settings are remembered |
| Feeding, in the Sound tab | Pick the sound you hear while you feed: Crackle, Tuned (default), Drone, Rain, Whoosh or Gulps. Picking one plays it for a moment. Your choice is remembered |

On a touch screen:

| Gesture | Action |
|---------|--------|
| One finger | Steer, in the mode picked in the gear menu's Touch tab (remembered) |
| Two fingers | Pinch to zoom, drag to orbit |

| Touch mode | Steer | Boost |
|------------|-------|-------|
| Joystick (default) | Drag from where your finger lands; further means more thrust. Its **Visible** switch hides the ring | Drag past the ring |
| Follow finger | Touch where you want to go | Double-tap and hold |
| Tilt | Tilt the phone; tipping the top away goes forward. Retrying, starting over or picking Tilt again re-centres it | Hold a finger down |

Tilt needs a motion sensor and a page served over https (iOS asks for permission first). Where it can't work, it's greyed out.

## How to play

There's no intro screen: the game starts straight away. Each control is shown as a small looping gesture until you've used it, and the first time you near a black hole heavier or lighter than you, time slows almost to a stop while a label explains it.

- Drift into stars to capture them. They spiral into your accretion disk and add to your mass when they cross your shadow.
- **Red** means heavier than you, **blue** means prey. Each black hole's photon ring glows in its color, and near you, heavier ones get a solid red ring at the distance where their pull beats your thrust. Cross one and you won't get back out. Lighter ones get a dashed blue ring. When one changes sides, its ring flares and a two-note tone rises or falls.
- Every galaxy has a **supermassive core**. Once you outweigh it, fly into it to take its mass. Some carry their real black hole's name: Sagittarius A\* in the Milky Way, M31\* in Andromeda, M87\* at the heart of the Virgo Cluster.
- Past the 16 galaxies of the opening, the universe goes on forever, a little bigger every ring outward: giant galaxies, then galaxy groups, clusters, superclusters and great walls. Each scale is named for real ones (the Coma Cluster, Laniakea, the Sloan Great Wall…), and the name of each place appears as you reach it. Things you've long outgrown fade away.
- **Rivals** roam between galaxies and eat the same stars: seven in the opening, then new ones named for real quasars. They keep only 30% of what they eat, so you can outgrow them. Rivals hunt you while you're smaller (boosting outruns them) and flee once you're bigger.
- **Hawking radiation** slowly shrinks you (0.3% of your mass per second), and boosting burns another 1.5% per second, so keep eating.
- Every core or rival you swallow saves a **checkpoint**, as soon as nothing heavier is close and nothing is hunting you. If you're swallowed, **Retry** (or **R**) takes you back to it. Checkpoints last until you reload the page.
- The HUD stays out of the way: your mass and feeding rate in the corner, and arrows at the screen edge toward the nearest black holes when they're out of view (blue: you outweigh it, red: it outweighs you). Apart from those hints and a brief note when a checkpoint is saved, there are no pop-up messages during play.
- You win when you outweigh all the matter in the observable universe, about 10²³ suns. You can keep drifting after that.

[docs/gameplay.md](docs/gameplay.md) has the full rules and the rival AI.

## Project structure

```
index.html          page shell
vite.config.js      relative base path for portable builds
src/
  main.js           renderer, camera, OrbitControls, render loop
  game.js           createGame(): the scene, the simulation and the frame update
  config.js         every gameplay and rendering constant
  universe.js       the opening's layout: galaxies, nebulae, rivals, start point (plain data)
  cosmos.js         the endless universe past it: rings of cells, each a structure (plain data)
  names.js          real names for each scale, and catalogue-style designations
  stream.js         builds the cells around you and drops the ones left behind, remembering what you ate
  builder.js        worker that builds a cell's particles off the main thread
  fields.js         star fields: spiral, elliptical, group, cluster, supercluster, wall, nebula and loose-star geometry
  grid.js           spatial grid used to find stars within reach
  holes.js          black hole objects and the shared gravity helpers
  disk.js           pooled accretion-disk particle simulation
  jets.js           ring-buffered relativistic-jet particles
  shaders.js        all GLSL: star fields, disks, jets, rings, lensing pass
  pointer.js        mouse and touch steering: joystick, follow-finger and tilt modes
  settings.js / .css the gear menu: tabs that the HUD, the audio and the touch settings fill
  audio.js          synthesised music loop, ambience and sound effects
  hud.js / hud.css  DOM overlay: mass readout, edge arrows, vignette, checkpoint note, end card, Game tab
  hints.js / .css   control lessons as looping gestures, and the slowed moments that explain weight
  style.css         page base styles
  utils.js          seeded random and seed mixing, backdrop starfield, GPU disposal helper
docs/
  gameplay.md       rules, scaling, the scales past the opening, rival AI
  architecture.md   frame loop, the endless universe, rendering pipeline, data structures, performance
  tuning.md         what the constants in config.js do and how they interact
```

## Deploying

`npm run build` writes a static site to `dist/`. Because `base` is `'./'`, every asset path is relative, so you can upload the folder anywhere: GitHub Pages, Netlify, an itch.io HTML5 upload (zip the contents of `dist/`), or any static host. Don't open `dist/index.html` straight from disk, because browsers block ES modules on `file://`. Use `npm run preview` or a static server instead.

## Embedding

`createGame({ renderer, camera, controls })` in `src/game.js` takes an existing three.js renderer, a `PerspectiveCamera` and `OrbitControls`. It returns `{ scene, update(elapsed, delta), render(delta), dispose() }`. Call `update` and then `render` every frame. `dispose()` removes the game's listeners, its HUD, its GPU resources and its audio. `src/main.js` is the minimal host.

## Browser support

The game needs WebGL 2 and module workers, which every current desktop and mobile browser has. It plays with keyboard, mouse or touch, and the hints show the gestures for whichever you have. Sound starts at the first click, touch or key press, because browsers don't allow a page to play audio before one. All of it is synthesised with the Web Audio API, so there are no audio files to load. Performance depends mostly on fill rate: with additive particles, bloom and lensing at full resolution, a low-end GPU at a high pixel ratio is the usual bottleneck. The renderer caps the pixel ratio at 2.

## Origin

This started as demo #7 of a three.js animation playground. There, the galaxies came from that project's Particle Galaxy demo. This repository is the game on its own, with no dependencies beyond `three`.
