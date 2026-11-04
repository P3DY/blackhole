# Improvements

Known bugs and suggested improvements that haven't been made yet, from a review of the code and an investigation into stuttering on mid-range phones. They're roughly in order of priority within each section. Line numbers are as of commit `17f596f`; the function names are the safer guide.

When you fix one, take it out of this list, and update the other docs if it changes what they describe.

## Bugs

### Retry can freeze the game

`removeHole()` (`src/game.js:201`) frees a black hole's slot but does nothing about holes that are still falling into it. Two callers remove holes far from you, which is exactly where nobody is watching a rival mid-meal:

- `letGoOfRivals()` (`game.js:579`) removes rivals you've outgrown or left far behind. Rivals capture lighter rivals within their reach, so the one being let go can be in the middle of eating another.
- The streamer's `onDrop` (`game.js:267`) removes a dropped cell's core, which a rival can be falling into.

What follows:

1. The victim never finishes falling. `sink()` (`game.js:748`) swallows it once it's within 0.6 × its eater's size, and `removeHole()` set that size to 0. It spirals toward the gone eater forever.
2. It stays in `roamers`, so it permanently takes one of the 7 rival places (new rivals only appear while `roamers.length < MAX_WARPS`). `letGoOfRivals()` skips it because it isn't `alive`.
3. If a checkpoint is saved while it exists, `restore()` can't find its eater by key. It sets `eater = null` (`game.js:514`) but leaves the state as `'falling'`, so `game.js:958` (`hole.eater.position`) throws on every frame. The game freezes, and only a reload gets out.

It's rare in play, because a fall lasts about a second, but the result is a dead game. It was reproduced by exposing `fall`, `removeHole`, `saveCheckpoint` and `retry` from a dev build, making one rival fall into another, removing the eater, then saving and retrying: `Cannot read properties of null (reading 'position')` on every frame, and no frame rendered after it.

A fix, about five lines:

- In `removeHole()`, let go of whatever is falling into the hole: `for (const other of holes) if (other.eater === hole && other.state === 'falling') Object.assign(other, { state: 'alive', eater: null });`. Its size comes back the next frame, and it carries on as an ordinary rival.
- In `restore()`, do the same for a falling hole whose eater wasn't found, so a checkpoint saved before the fix can't freeze the game either.

Don't remove the falling holes along with their eater instead. `reset()` and `restore()` remove every rival from a copy of `roamers`, so a rival removed early would be removed again, and `holes.splice(holes.indexOf(hole), 1)` with an index of -1 drops the wrong hole. The player can also be the one falling, if you press R mid-fall.

### Place names aren't part of checkpoints

`visited` (`game.js:282`), the galaxies and structures whose names you've been shown this run, is cleared by `reset()` but neither saved nor restored by checkpoints. After a Retry, places you reached after the checkpoint don't announce themselves again, while the scale titles do (their `stats.band` is restored). CLAUDE.md asks for state that changes during play to go in the checkpoint. Save a copy of `visited` with it.

## Gameplay and UX

- **R retries without asking, mid-game** (`game.js:326`). With no checkpoint yet, R is a full restart, while the menu's Start over needs two presses. R sits right above WASD. Take R only while you're swallowed, or make it a hold-to-retry while you're alive.
- **There's no pause.** Opening the settings menu doesn't stop the game, so you can be eaten while picking a feeding sound. `update()` already scales time for the hints, so pausing is mostly one flag: set the time scale to 0 while the panel is open, and bind Esc or P.
- **Checkpoints don't survive a reload.** Growing to tier 28 is a long game. The last checkpoint could go to IndexedDB. Most of it is the opening's alive flags (about 2.5 MB as `Float32Array`s); bit-packed with `pack()` from `stream.js`, they'd be about 77 KB.
- **A graphics setting.** The biggest GPU lever is the pixel ratio (see [Performance](#performance)), but changing it means editing `main.js`. A Graphics tab in the settings menu (resolution, bloom on or off) would fit the existing tabs.
- **Phones:** there are no `env(safe-area-inset-*)` paddings, so the gear and the mass readout can sit under a notch in landscape. There's no fullscreen option either.

## Performance

### Phones

- **Graphics.** If the game still stutters on a phone, the GPU is the likely cause, and the investigation below couldn't measure it: headless Chromium renders in software. Fill rate dominates: additive points, the lens pass and bloom, all at a pixel ratio of up to 2 into half-float buffers. Options, cheapest first:
  - Cap the pixel ratio lower on touch devices, say 1.5, which cuts the pixels by 44%.
  - Scale the resolution with the frame time, which also means updating every `uSize`, the rings' `uWidth` and the composer's size when it changes.
  - Offer it as a setting (see above).
- **A shorter reverb.** The live reverb's 4 s impulse is now about a third of the audio thread's work. A 3 s one would save about a fifth of the total, at the cost of an audibly shorter tail. A mono reverb (`channelCount: 1`) measured slower in Chrome, not faster.
- **Loading.** Building the opening's 618,183 stars runs on the main thread: a task of about 2 s with the CPU throttled 4× (`spiralParticles`, `looseStars`, `buildGrid`), then about 0.5 s for the first frame's uploads. The page shows nothing meanwhile. It could move to a worker the way the cells past the opening did (`buildCellParts()` / `fieldsOf()`). Mind the seeded stream: `planUniverse()` and `buildFields()` share one `mulberry32(UNIVERSE_SEED)`, so the worker would have to run both, in the same order.
- **`update()` on a slow CPU.** With the CPU throttled 4×, `update()` took 4–6.5 ms at the median but 12–17 ms at the 95th percentile and 18–31 ms at the 99th, a frame's whole budget at 60 Hz. The software renderer was competing for the same cores, so these are pessimistic. Profiling on a real phone (Chrome remote debugging) would show whether it matters. `disk.update()`, the capture queries and the HUD are where to look.

### CPU and memory

- **Disk uploads** (`src/disk.js:114`). All four attributes are uploaded every frame, about 1.4 MB at full capacity. Colors and scales only change when particles are added or removed, so they could be uploaded only then. `aHole` (each particle's black hole centre and shadow) changes every frame, but it could become a uniform array of 128 `vec4`s indexed by slot, with the slot as a byte attribute, which leaves only positions to upload each frame.
- **Alive flags.** `aAlive` is a `Float32Array` (`src/fields.js:91`): 4 bytes per star on the GPU and in every partial upload. A `Uint8` attribute works with the same shader. Each checkpoint also copies the opening's flags whole (`game.js:450`), about 2.5 MB; bit-packing them as the streamer's deltas do would make it about 77 KB.
- **Jets** (`src/jets.js:51`). `update()` walks the whole 4,096-particle ring and uploads it all while any jet is live. Tracking the live range would trim both. It's small.
- **HUD** (`src/hud.js:181`). Every frame it filters and sorts all black holes into a new array, and writes the mass text, meter width and vignette opacity even when they haven't changed. Writing only on change saves style recalculation on phones. It's small too.
- **The opening's fields stay in GPU memory** for good, hidden once you outgrow them. Freeing their buffers after they fade, and rebuilding them on Start over or a Retry back into the opening, would save memory late in the game. `reset()` relies on them staying, so this is a bigger change.

## Robustness

- **Worker failures are silent** (`src/stream.js:17`). There's no `onerror`. If the worker can't load, every cell past the opening gets its core but no stars. `buildCellParts()` is pure, so falling back to building on the main thread would be easy.
- **No message without WebGL 2.** `new THREE.WebGLRenderer()` throws and the page stays blank. A short message would say why.
- **Embedding only works full-window.** The README says `createGame()` works with any renderer, but `game.js` (bloom size, `onResize`, `leastRingRadius`, `addLens`), `hud.js:138`, `hints.js:199` and `pointer.js:265` all use `window.innerWidth` and `innerHeight` and the pointer's client coordinates. Use the canvas's size and bounding rect, or narrow the README.
- **The pixel ratio is read once** (`main.js:11`, `game.js:102`). Moving the window to a screen with a different DPI leaves star sizes and ring widths wrong.

## Tooling

- **Tests.** There's no test suite, and CLAUDE.md states its invariants as prose. Most are checkable in a few lines with Vitest, since the modules are plain functions:
  - both balance rules from CLAUDE.md, and `MAX_HOLES ≤ 256`
  - `queryGrid()` against a brute-force search, including holes far off one side of the grid
  - `pack()` / `unpack()` round trips, and `disk.load()` remapping slots
  - `cellAt()` being deterministic, with no cells overlapping
- **A smoke test.** Playwright with Chromium's software renderer runs the game headless: load a few `?tier=N` values in the dev server, drive it with the keyboard for 10 s, and fail on any page error. See [How it was measured](#how-it-was-measured).
- **CI for pull requests.** `deploy.yml` only runs on pushes to `main`, so a broken build shows up at deploy time. A workflow that builds and tests pull requests would catch it first.
- **A linter.** The code passes ESLint's recommended rules with no warnings today. Running ESLint in that workflow would keep it that way.

## Already done

Commit `17f596f` fixed the audio breaking up and the game stalling on phones. `docs/architecture.md` describes the details:

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
