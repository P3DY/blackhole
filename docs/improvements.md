# Improvements

Known bugs and suggested improvements that haven't been made yet, from a review of the code and an investigation into stuttering on mid-range phones. They're roughly in order of priority within each section. Function names are a safer guide than line numbers, which drift.

When you fix one, take it out of this list, and update the other docs if it changes what they describe.

## Bugs

None known.

## Gameplay and UX

- **Checkpoints don't survive a reload.** Growing to tier 28 is a long game. The last checkpoint could go to IndexedDB. The opening's alive flags are now bit-packed (about 77 KB), so a checkpoint is small; what's missing is serialising it (the holes' `Vector3`s, the streamer's `Map` of deltas) and loading it at startup.

## Performance

### Phones

- **Graphics.** The Video tab now caps the pixel ratio (1.5 by default on touch screens) and can turn bloom off. If the game still stutters on a phone, the next step is to scale the resolution with the frame time. `fitToRenderer()` in `game.js` already follows any change to the renderer's pixel ratio, so it would only need something to watch the frame time and call `renderer.setPixelRatio()`, with some hysteresis.
- **A shorter reverb.** The live reverb's 4 s impulse is now about a third of the audio thread's work. A 3 s one would save about a fifth of the total, at the cost of an audibly shorter tail. A mono reverb (`channelCount: 1`) measured slower in Chrome, not faster.
- **Loading.** Building the opening's 618,183 stars runs on the main thread: a task of about 2 s with the CPU throttled 4× (`spiralParticles`, `looseStars`, `buildGrid`), then about 0.5 s for the first frame's uploads. The page shows nothing meanwhile. It could move to a worker the way the cells past the opening did (`buildCellParts()` / `fieldsOf()`). Mind the seeded stream: `planUniverse()` and `buildFields()` share one `mulberry32(UNIVERSE_SEED)`, so the worker would have to run both, in the same order.
- **`update()` on a slow CPU.** With the CPU throttled 4×, `update()` took 4–6.5 ms at the median but 12–17 ms at the 95th percentile and 18–31 ms at the 99th, a frame's whole budget at 60 Hz. The software renderer was competing for the same cores, so these are pessimistic. Profiling on a real phone (Chrome remote debugging) would show whether it matters. `disk.update()` and the capture queries are where to look.

### CPU and memory

- **Disk uploads** (`src/disk.js`). Colors and scales are now uploaded only when particles come or go, but positions and `aHole` (each particle's black hole centre and shadow) still go up every frame. `aHole` could become a uniform array of 128 `vec4`s indexed by slot, with the slot as a byte attribute, which would leave only positions to upload each frame.
- **The opening's fields stay in GPU memory** for good, hidden once you outgrow them. Freeing their buffers after they fade, and rebuilding them on Start over or a Retry back into the opening, would save memory late in the game. `reset()` relies on them staying, so this is a bigger change.

## Robustness

- **Embedding only works full-window.** `game.js` now follows the renderer's own size and pixel ratio, but `hud.js` (`placeMarker`), `hints.js` (`pin`) and `pointer.js` still use `window.innerWidth` and `innerHeight` and the pointer's client coordinates, and their overlays are fixed to the window. Use the canvas's bounding rect there to embed the game in part of a page. The README says it only works full-window for now.

## Tooling

- **More tests.** `test/` covers the pure modules (balance rules, `queryGrid()`, `pack()` / `unpack()`, the disk pool, `cellAt()`). The checkpoint round trip lives in `game.js`'s closure, so it can only be checked through the smoke test for now. Exposing `saveCheckpoint()` / `restore()` from a dev build would let a test check that a restore gives back exactly what was saved.

## Already done

Since the review:

- **Retry could freeze the game.** `removeHole()` now lets go of anything falling into the hole it removes, and `restore()` does the same for a hole saved falling into something that didn't come back. Checked by making one rival fall into another, removing the eater, then saving and retrying: no errors, and frames kept coming.
- **Place names are part of checkpoints** (`visited`).
- **R needs a hold while you're alive** (`RETRY_HOLD`), and a tap once you've been swallowed.
- **Pause:** P or Esc, and while the settings menu is open.
- **A Video tab:** resolution (the pixel ratio: 2, 1.5 by default on touch screens, or 1), bloom, and full screen. The pixel ratio follows changes in the screen's density.
- **Phones:** `env(safe-area-inset-*)` keeps the gear, the mass readout and place names clear of a notch.
- **Cheaper uploads and copies:** `aAlive` is a byte a star; checkpoints bit-pack the opening's alive flags (2.5 MB down to about 77 KB); the disk uploads colors and scales only when they change; jets simulate and upload only their live stretch; the HUD finds the nearest black holes without sorting a copy of the list and writes to the DOM only on change.
- **Worker failures** fall back to building cells on the main thread.
- **No WebGL 2:** the page says so instead of staying blank.
- **Tooling:** Vitest unit tests (`npm test`), ESLint (`npm run lint`), a Playwright smoke test (`npm run smoke`), and a Check workflow that runs them and the build on pull requests.

Before that, commit `17f596f` fixed the audio breaking up and the game stalling on phones. `docs/architecture.md` describes the details:

- Sound effects are disconnected once they end. They used to stay in the audio graph until a retry. 300 of them tripled the audio thread's work, so the longer you played, the worse the sound got.
- Only the chosen feeding sound is built. All six used to run, with five of them silent.
- Phones and tablets ask for a bigger audio buffer (`latencyHint: 'playback'`).
- The slow part of the audio (the context, the noise and the reverb) is made while the page is idle. The first tap or key press went from 0.9 s to 60 ms with the CPU throttled 4×.
- The music loops its rendered buffer and sets its level with a gain, instead of rescaling and copying it: 0.4 s down to 60 ms at 4×.
- Every shader is compiled at load, with the composer's buffer bound. The rings' shader used to compile the first time a black hole came near.
- The renderer no longer asks for MSAA, which only ever applied to the composer's final full-screen copy.

## Measured and ruled out

These looked like possible causes of stutter, but weren't:

- **Checkpoint saves** take 5–17 ms with the CPU throttled 4×, a dropped frame at most.
- **Streaming cells** past the opening caused no spikes in `update()` while flying through new cells at tier 10.
- **The hints' CSS animations** (some animate `box-shadow`, which repaints) only run while a lesson is showing.

## How it was measured

All of it ran headless, with Playwright and the Chromium that comes with it. That Chromium renders WebGL in software (SwiftShader), so frame rates and GPU timings mean nothing, but JavaScript and audio timings do.

- **CPU like a phone's:** `Emulation.setCPUThrottlingRate` at 4 through a CDP session, as DevTools' mid-tier mobile preset does.
- **Long tasks:** a `PerformanceObserver` for `longtask`, together with a CPU profile (`Profiler.start` / `Profiler.stop`). To tell what each task was, the profile's clock was lined up with `performance.now()` by spinning in a uniquely named function at a known time. Then the samples inside each task were tallied by the innermost function from `src/`.
- **Shader compiles:** `renderer.info.programs.length` each frame, and `renderer.properties.get(material).currentProgram` for each object, from `window.blackHole` in a dev build.
- **The audio thread's work:** an init script replaced `window.AudioContext` with a subclass of `OfflineAudioContext` (20 s at 48 kHz). The game built its graph as usual, the render loop was stopped, and `startRendering()` was timed. With the CPU to itself, 20 s of the old graph took about 1.65 s to render and the new one about 0.96 s. Adding 300 leftover effect outputs made the old graph take 4.6 s.
- **Autoplay:** Playwright's Chromium allows autoplay by default. Pass `ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required']` to see the context wait for the first input, and watch the console for Chrome's "The AudioContext was not allowed to start" warnings.
