# Improvements

Known bugs and suggested improvements that haven't been made yet, from reviews of the code, a short play-through, and an investigation into stuttering on mid-range phones. They're roughly in order of priority within each section. Function names are a safer guide than line numbers, which drift.

When you fix one, take it out of this list, and update the other docs if it changes what they describe.

## Bugs

None known.

## Balance

From playing the opening for a couple of minutes on a desktop, with the mouse.

- **Skipping ahead beats the main path.** A star is worth its galaxy's `STARS_MASS` × arrival mass divided by its star count, whoever eats it, so a Cartwheel star is worth about 17× a Sextans Dwarf star (0.0021 against 0.00012). Cartwheel (tier 2.6) is 22.3 from the start with a radius of 13.6, so its rim is under 5 from the starting galaxy's. Flying in a straight line along that rim for about 50 s took a new player from 1.0 to 5.5, past tier 1's arrival mass, without eating the home galaxy. The risk is small: Cartwheel's core has a danger radius of about 1.5 against a mass-1 player, in a galaxy 13.6 wide, and no rival hunts anything under a quarter of its mass. The same holds at every scale, since the mass a reach sweeps up grows with the galaxy's radius. Pick one:
  - cap what a star gives as a share of the eater's mass (in `capture()` or where `disk.js` adds it up), so stars from far above your tier are worth no more than ones your size;
  - make stars from a field more than a tier or so above you too heavy to pull loose, as faded fields already can't be eaten (`captureNearby()`);
  - keep it as a strategy but make it dangerous: a wider danger radius for cores far heavier than you, or rivals that take small prey when it strays into their galaxy;
  - or only move Cartwheel away from the start (`SIDE_TRIPS`, which reshuffles the opening), which hides the shortcut without closing it.

## Gameplay and UX

Everything here should follow [Keeping it immersive](gameplay.md#keeping-it-immersive): say it in the world first, only when it matters, on request, fading with familiarity, and with bookkeeping kept out of play. The items below are written that way. Do them in this order, since the map takes over from the labels and the camera reset.

- **The compass and labels are always on.** Since the navigation aids went in, a chevron and up to three labels (a name and a time in seconds) stay on screen whenever their targets are off screen, which is most of the time. That's the most text on screen during play since the HUD was stripped down, and it undoes much of that change. Gate them instead:
  - The compass's chevron fades in only once you've been starving for a while (`appetite` near zero for about 8 s, a new `COMPASS` setting) and fades out once you're feeding again. `chooseCompass()` can keep choosing all the time, so the target is ready the moment it shows.
  - Labels are hidden by default. They show while you hold the look key (**Tab**, or a long press on touch; Tab must `preventDefault()` so it doesn't move focus), and fade in for a couple of seconds the first time a new target or arrow appears, then fade out. The arrows themselves stay: they're color, not words.
  - Fade, don't pop: the chevron and labels ease in and out over about half a second.
  - `hud.update()` needs to know whether you're starving and whether the key is held; `placeLabel()` keeps its layout as it is.
- **A map, as the look key held longer.** Holding Tab for more than a moment pulls the real camera up and out over the scene, not a 2D panel, while game time slows (the time scale `hints.js` already returns, multiplied in `update()`). Names fade in over the galaxies, structures and rivals around you, places mostly eaten out dim, and the compass's target is marked. Letting go glides the camera back to its default angle and zoom (`CAMERA_ELEVATION`, `CAMERA_DISTANCE`), which is also **the camera reset** after you've zoomed out to look around. The far plane and the fields' fading follow your mass, so pulling out further than the game normally allows needs checking against both. Don't use **M**, which already toggles sound.
- **How much more do you need? Show it in the ring.** A black hole is red or blue and nothing in between, so near a heavier core you can't tell whether to keep feeding or leave. Instead of a label with your shortfall, let the tint and the ring move through violet as your mass nears theirs: full red at twice your mass or more, violet near a tie, then blue once you outweigh it. That means blending `TINTS` and `RINGS` by the mass ratio where `game.js` picks a photon ring's color (`PHOTON`) and a ring's, instead of choosing one by side, with the side change's flare and notes left as they are. The exact numbers can go on the map.
- **Progress toward the universe, off the play screen.** The mass readout doesn't say how far 10²³ M☉ is. Put a thin log-scale bar (`massTier(mass)` out of 27.8) with the current scale's name on the pause screen (`setStatus()`) and the end card, not under the feeding meter. Scale names already appear once, as place names, when you reach a new scale.
- **An Interface setting in the Game tab:** *Minimal* (the gating above) or *Guided* (the compass and labels always on, as now). It starts on Guided, and switches to Minimal once the lessons are done, unless you've chosen.
- **The compass can point you up the shortcut.** It suggests galaxies that expect up to 6× your mass (`COMPASS.fit`), which is how far ahead skipping pays (see [Balance](#balance)). Narrow it if the shortcut is closed.
- **The boost lesson never gives up.** It pulses low in the middle of the screen until you boost, which can be the whole session for someone who doesn't want to burn mass. Retire a control lesson after a few loops unseen (`teach()` in `hints.js`), or the first time you've grown a tier without it.
- **Volume.** Sound, Music and Effects are switches. Sliders for the three buses (`AUDIO.music`, `ambience`, `effects`) would let you turn the music down without losing it.
- **Gamepads.** There's no support. A stick maps straight onto `steerStick()` in `pointer.js` (thrust by how far it's pushed), a trigger onto boost, the right stick onto the camera, Start onto pause, and a face button onto the look key.
- **What you did since the last checkpoint is lost on a reload.** Only checkpoints are stored, and one is saved only after you swallow a core or a rival. Saving one on `pagehide` (when it would be safe, by the same rule as step 10 of the frame in `docs/architecture.md`) would keep more of a run, but a write that late isn't guaranteed to finish, so it's a bonus rather than a promise.

## Ideas for more game

Bigger than the fixes above, and none of them designed yet. Past the opening, tiers 7 to 27.8 change what you see and what it's called, but the loop is the same one twenty times over, so the first of these matters most. Each comes with how it would show itself without adding words during play (see [Keeping it immersive](gameplay.md#keeping-it-immersive)).

- **A mechanic for each scale**, so each band of `BANDS` plays differently: a cluster's hot gas that feeds you slowly but drags on you; a supercluster's threads as fast lanes, with more thrust along them; voids where Hawking radiation costs more; cores that orbit each other in pairs. Each would live in the cell's plan (`cellAt()` in `cosmos.js`), and anything that changes during play in its delta. Show each one in the world, with a glow for the gas, brighter threads, and a darker, quieter void, and explain it at most once, in the place name's subtitle the first time you meet it.
- **Slingshots.** Gravity is already simulated for every roamer (`move()`). Grazing a heavier hole's red ring without crossing it could give a kick of speed, or pay back some of the boost's cost, so the ring is something to play with as well as avoid. Its feedback is a flare along the ring and a whoosh, not a number.
- **Rivals with characters.** All of them run the same four modes (`think()`). The seven named ones could each bend it: one that waits in ambush beside a core, one that barely moves but pulls much harder, Sköll and Hati hunting as a pair. Check the hunt inequality in [tuning.md](tuning.md#rivals) for any that changes pace or range. Their characters show in how they move and sound; their names only on the map and the look key.
- **Feeding streaks.** Holding the feeding meter full for a while could widen your reach or strengthen your jets for as long as it lasts, and jets could push lighter rivals about. `appetite` is already there for every roamer. Show a streak through a brighter disk, longer jets and an extra layer in the music, with no meter or counter of its own.
- **Records and goals.** Your best time and peak mass, and the time you reached each scale, kept in localStorage and shown on the end card beside this run's. A few goals to go with them: swallow all seven of the opening's rivals, take Sagittarius A\*, win without boosting. They stay on the end card and in the menu; a goal met during play earns at most the same brief note a checkpoint does.
- **Seeded runs.** `UNIVERSE_SEED` already shapes everything, and `fits()` already turns away a checkpoint from another seed. A seed in the address, or one for each day, would give a new universe to race through. The opening is built in a worker from the seed, so it would need passing in.
- **A logbook.** A tab in the settings menu listing what you've swallowed and where you've been (`visited`), with a line about the real object behind each name in `names.js`.

## Performance

### Phones

- **`update()` on a slow CPU.** With the CPU throttled 4×, `update()` took 4–6.5 ms at the median but 12–17 ms at the 95th percentile and 18–31 ms at the 99th, a frame's whole budget at 60 Hz. The software renderer was competing for the same cores, so these are pessimistic. Profiling on a real phone (Chrome remote debugging) would show whether it matters. `disk.update()` and the capture queries are where to look.

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

- **Navigation aids.** A compass at the screen edge points to the galaxy or structure most worth heading for (`chooseCompass()` in `game.js`, tuned by `COMPASS`), and the arrows toward the nearest heavier and the nearest lighter black hole carry its name. Both show how far it is, in seconds at your top speed.
- **Lessons are remembered across reloads**, like checkpoints: which lessons are done and which slowed moments you've seen, in localStorage.
- **A reduced-motion mode** follows `prefers-reduced-motion`: the lessons' gestures stand still, slowed moments light their ring without pulsing, and rings that change sides brighten without swelling.
- **A faster `update()`.** The disk's shader looks each particle's black hole up in a uniform array by slot (`uHoles`, `aSlot`), so only positions are uploaded each frame, and its loop uses `Math.sqrt` instead of `Math.hypot` and `**`. `queryGrid()` no longer makes arrays as it walks. With the CPU throttled 4× at tier 8, `disk.update()` went from 0.9 / 4.9 / 8.0 ms (median / p95 / p99) to 0.4 / 2.5 / 4.8 ms, and the whole of `update()` from 14.4 / 19.9 ms to 9.5 / 13.2 ms at the 95th / 99th percentile.
- **Sound effects are rendered ahead** into buffers, and desktops ask for a slightly bigger audio buffer (`'balanced'`). Chimes synthesised live, several a second while you fed, were most of the audio thread's work, so the music and effects stuttered whenever you fed: 20 s with 8 chimes a second took 5.8 s to render offline, and 2.1 s from buffers. Glides toward the value a param already has are skipped too.
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
- **Cheaper uploads and copies:** `aAlive` is a byte a star; checkpoints bit-pack the opening's alive flags (2.5 MB down to about 77 KB); the disk uploads colors and scales only when they change; jets simulate and upload only their live stretch; the HUD finds the nearest black holes without sorting a copy of the list and writes to the DOM only on change.
- **A shorter reverb:** the live reverb's impulse is 3 s instead of 4, about a fifth less work for the audio thread.
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
