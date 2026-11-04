# Improvements

Known bugs and suggested improvements that haven't been made yet, from a review of the code and an investigation into stuttering on mid-range phones. They're roughly in order of priority within each section. Function names are a safer guide than line numbers, which drift.

When you fix one, take it out of this list, and update the other docs if it changes what they describe.

## Bugs

None known.

## Gameplay and UX

- **Lessons start again on a reload, though the run doesn't.** Since checkpoints survive a reload, a returning player carries on mid-run but is taught steering and boosting again, slowed moments and all. `hints.js` keeps its progress (`current`, and which slowed moments have been shown) only in memory. Remembering it with the `readChoice` / `writeChoice` helpers in `settings.js` would fix it; Start over should keep it, as it does now.
- **What you did since the last checkpoint is lost on a reload.** Only checkpoints are stored, and one is saved only after you swallow a core or a rival. Saving one on `pagehide` (when it would be safe, by the same rule as step 10 of the frame in `docs/architecture.md`) would keep more of a run, but a write that late isn't guaranteed to finish, so it's a bonus rather than a promise.
- **No reduced-motion mode.** Only the loading screen honours `prefers-reduced-motion`. The hints' looping gestures (`hints.css`), the rings' flares on a change of side and the slowed moments could calm down or stop for those who ask.

## Performance

### Phones

- **Try the resolution scaler on real phones.** `PACE` in `pacer.js` was tuned in theory and in unit tests. Headless Chromium draws WebGL in software and barely speeds up at a lower resolution, so it couldn't show the scaler helping. Each change it makes also costs a hitch (see the next item but one), so if a phone keeps stepping back and forth, lengthen `holdOff` or `upAfter`.
- **The rest of loading.** The longest task left while loading (0.5–0.7 s at 4×) hasn't been broken down: evaluating the script, wrapping the opening's arrays in geometry (`fieldsOf()`), `renderer.compile()` and the first frame's uploads all fall in it. A profile would show whether any of it can move or shrink.
- **A shorter reverb.** The live reverb's 4 s impulse is now about a third of the audio thread's work. A 3 s one would save about a fifth of the total, at the cost of an audibly shorter tail. A mono reverb (`channelCount: 1`) measured slower in Chrome, not faster.
- **`update()` on a slow CPU.** Timed section by section with the CPU throttled 4× (90 s each, steering and boosting, with the resolution fixed), `update()` now takes 2–4 ms at the median, 6–10 ms at the 95th percentile and 11–13 ms at the 99th, at tiers 0 and 8. The slowest frames are spread over the capture queries, `disk.update()` and the audio (mostly `chime()` making its nodes, 5–10 ms each), with no single culprit left. Next steps, if a real phone (Chrome remote debugging) shows it still matters: let the capture queries skip grid cells whose stars are all eaten (a live count per cell, which `reset()`, `restore()` and the streamer's `fill()` would have to recount), and reuse chime voices instead of making new nodes. Two hitches are known and left alone: getting swallowed (the end card and its sound, about 65 ms at 4×), and each change the resolution scaler makes (the canvas and every buffer are remade, 100–240 ms at 4× in headless Chromium).

### CPU and memory

- **The opening's fields stay in GPU memory** for good, hidden once you outgrow them. Freeing their buffers after they fade, and rebuilding them on Start over or a Retry back into the opening, would save memory late in the game. `reset()` relies on them staying, so this is a bigger change.

## Robustness

- **A saved checkpoint only checks the opening's shape.** `fits()` in `save.js` turns away a save from another `SAVE_VERSION`, another seed, or an opening whose fields have other star counts. But a change to `cosmos.js` or the constants that size the cells' fields would let an old save's cell deltas unpack onto different stars without complaint (`unpack()` doesn't check lengths). Storing each delta's star count beside its bits and skipping any that don't match in the streamer's `fill()`, or storing a fingerprint of the constants that shape the universe, would close it. Until then, bump `SAVE_VERSION` with any such change.
- **Embedding only works full-window.** `game.js` now follows the renderer's own size and pixel ratio, but `hud.js` (`placeMarker`), `hints.js` (`pin`) and `pointer.js` still use `window.innerWidth` and `innerHeight` and the pointer's client coordinates, and their overlays are fixed to the window. Use the canvas's bounding rect there to embed the game in part of a page. The README says it only works full-window for now.

## Tooling

- **Test the fallbacks in the smoke test.** The opening's worker failing (so it's built on the main thread) and IndexedDB being unavailable were checked by hand. The smoke test could block `builder-*.js` with `page.route()` for one pass, and delete `indexedDB` in an init script for another, and check the game still starts with only warnings.
- **A dev-only profiler.** Timing `update()` section by section meant patching `game.js` by hand (see [How it was measured](#how-it-was-measured)). A `?profile` switch in development, timing the same sections into `window.blackHole`, would make it repeatable.
- **More tests.** `test/` covers the pure modules (balance rules, `queryGrid()`, `pack()` / `unpack()`, the disk pool, `cellAt()`, `fits()`), and the smoke test checks a checkpoint's round trip through a reload. A unit test of `restore()` itself would need `game.js`'s closure in a test without WebGL.

## Already done

Since the review:

- **A faster `update()`.** The disk's shader looks each particle's black hole up in a uniform array by slot (`uHoles`, `aSlot`), so only positions are uploaded each frame, and its loop uses `Math.sqrt` instead of `Math.hypot` and `**`. `queryGrid()` no longer makes arrays as it walks. With the CPU throttled 4× at tier 8, `disk.update()` went from 0.9 / 4.9 / 8.0 ms (median / p95 / p99) to 0.4 / 2.5 / 4.8 ms, and the whole of `update()` from 14.4 / 19.9 ms to 9.5 / 13.2 ms at the 95th / 99th percentile.
- **Chimes and gulps are disconnected once they end**, like the other effects. Chrome drops unreferenced nodes only when it collects garbage, and until then they kept costing the audio thread.
- **The resolution adapts to the frame rate** (`pacer.js`, on by default in the Video tab): it drops a step at a time while the game runs under about 50 fps, keeps a step only if it helped, and climbs back when there's room. Its thresholds haven't been tried on a real phone yet.
- **Loading.** The opening's stars are built in the worker, behind a loading screen, so the page no longer freezes for 2 s (4× throttled) while it loads. The longest task left is 0.5–0.7 s.
- **Checkpoints survive a reload.** `save.js` keeps the last one in IndexedDB, and the game carries on from it when it starts. The smoke test saves one, reloads and checks that what comes back matches.
- **Retry could freeze the game.** `removeHole()` now lets go of anything falling into the hole it removes, and `restore()` does the same for a hole saved falling into something that didn't come back. Checked by making one rival fall into another, removing the eater, then saving and retrying: no errors, and frames kept coming.
- **Place names are part of checkpoints** (`visited`).
- **R needs a hold while you're alive** (`RETRY_HOLD`), and a tap once you've been swallowed.
- **Pause:** P or Esc, and while the settings menu is open.
- **A Video tab:** resolution (the pixel ratio: 2, 1.5 by default on touch screens, or 1), bloom, and full screen. The pixel ratio follows changes in the screen's density.
- **Phones:** `env(safe-area-inset-*)` keeps the gear, the mass readout and place names clear of a notch.
- **Cheaper uploads and copies:** checkpoints bit-pack the opening's alive flags (2.5 MB down to about 77 KB); the disk uploads colors and scales only when they change; jets simulate and upload only their live stretch; the HUD finds the nearest black holes without sorting a copy of the list and writes to the DOM only on change.
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
- **Storing a checkpoint in IndexedDB** takes 19–94 ms from start to stored with the CPU throttled 4×, at tiers 0 and 8, but nearly all of it is waiting on the database: no main-thread task over 50 ms.
- **Garbage collection** isn't behind the big spikes in `update()` it first looked like. Those were the resolution scaler resizing and the end card being built.

## How it was measured

All of it ran headless, with Playwright and the Chromium that comes with it. That Chromium renders WebGL in software (SwiftShader), so frame rates and GPU timings mean nothing, but JavaScript and audio timings do.

- **CPU like a phone's:** `Emulation.setCPUThrottlingRate` at 4 through a CDP session, as DevTools' mid-tier mobile preset does.
- **Long tasks:** a `PerformanceObserver` for `longtask`, together with a CPU profile (`Profiler.start` / `Profiler.stop`). To tell what each task was, the profile's clock was lined up with `performance.now()` by spinning in a uniquely named function at a known time. Then the samples inside each task were tallied by the innermost function from `src/`.
- **Shader compiles:** `renderer.info.programs.length` each frame, and `renderer.properties.get(material).currentProgram` for each object, from `window.blackHole` in a dev build.
- **The audio thread's work:** an init script replaced `window.AudioContext` with a subclass of `OfflineAudioContext` (20 s at 48 kHz). The game built its graph as usual, the render loop was stopped, and `startRendering()` was timed. With the CPU to itself, 20 s of the old graph took about 1.65 s to render and the new one about 0.96 s. Adding 300 leftover effect outputs made the old graph take 4.6 s.
- **`update()` section by section:** a temporary patch to `game.js` read `performance.now()` between the steps of the frame (AI and movement, streaming, fields, capture, disk, jets, rings, camera and lenses, HUD, hints, audio) and kept each frame's times, with the Video tab's adapting turned off (`localStorage['black-hole:no-adapt'] = '1'`). Playwright held W, turned and boosted for 90 s at each tier, after a 10 s warm-up at 4× so the audio and the first cells were ready. Then median, 95th and 99th percentiles per section, and each section's share of the slowest 5% of frames.
- **Leftover audio nodes:** an `OfflineAudioContext` rendering 20 s with a reverb and five chimes a second, plus 1,000 chimes that rang in the first second and were then left connected, disconnected, or left with nothing holding them (with and without a forced collection, `--js-flags=--expose-gc`). Keep the nodes out of any array in the unpruned case, or you're measuring held nodes.
- **Autoplay:** Playwright's Chromium allows autoplay by default. Pass `ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required']` to see the context wait for the first input, and watch the console for Chrome's "The AudioContext was not allowed to start" warnings.
