# Architecture

How the code is put together: what runs each frame, how everything is drawn, how the endless universe past the opening is built around you, and the data structures that keep around a million capturable stars cheap.

## Modules

```
main.js ──► game.js ──┬─► config.js        constants (imported by most modules)
                      ├─► universe.js      planUniverse(random) → the opening, as plain data
                      ├─► cosmos.js ──► names.js   cellAt, cellsNear: the universe past it, as plain data
                      ├─► stream.js ──► builder.js (a worker running cosmos.js and fields.js)   createStreamer
                      ├─► fields.js ──► grid.js (buildGrid)
                      ├─► grid.js          queryGrid
                      ├─► holes.js         createHole, dangerRadius, warpToward, …
                      ├─► disk.js          createDisk
                      ├─► jets.js          createJets
                      ├─► shaders.js       GLSL strings
                      ├─► settings.js ──► settings.css   createSettings (the tabbed gear menu), localStorage helpers
                      ├─► pointer.js       createPointer (mouse and touch steering, in three touch modes)
                      ├─► audio.js         createAudio (synthesised music, ambience, effects)
                      ├─► hud.js ──► hud.css
                      ├─► hints.js ──► hints.css   createHints (control lessons, slowed moments)
                      └─► utils.js         mulberry32, seedOf, createStarfield, disposeObject
```

- **`main.js`** is the host. It creates the `WebGLRenderer`, the `PerspectiveCamera` (60° fov, near 0.1 and far 5000 to start, which the game scales as you grow; see [The frame](#the-frame)) and `OrbitControls` with damping. It calls `createGame()` and runs the loop, clamping each frame's delta to 0–0.1 s: a backgrounded tab doesn't jump forward, and the first frame, whose timestamp can come before the start time, doesn't run backward. In development it puts `{ renderer, camera, scene }` on `window.blackHole` for poking at from the console.
- **`game.js`** holds `createGame({ renderer, camera, controls })`, a closure that owns all game state. It returns `{ scene, update, render, dispose }`. The rival AI, capture, movement and camera code live in it because they share that state.
- Every other module is a factory or a set of pure helpers with no game state of its own. The factories keep only the state of what they make: the disk and jet pools, and the streamer's records of the cells around you (see [The endless universe](#the-endless-universe)).

## World layout

The game is effectively 2D. Physics runs on the **x/z plane** (y = 0, "the galactic plane"). Positions, velocities and distances all ignore y. Stars and disks have a little vertical thickness, which is only visual.

There are three kinds of object:

| Object | Moves? | Made by | Drawn as |
|--------|--------|---------|----------|
| **Fields**: the opening's 16 galaxies, 7 nebulae and 1 set of loose stars; past it, each cell's structure, maybe a nebula, and its loose stars | Galaxies rotate in place | `fields.js` | One `THREE.Points` each, sharing one shader, each with its own material so it can fade |
| **Black holes**: 1 player; the opening's 7 rivals, and up to 7 at a time past it; 16 cores, plus one per cell built | Player and rivals roam; cores are fixed | `holes.js` | Nothing directly. The lens pass draws them, with a photon ring tinted by which side of you they're on, plus a flat ring quad near you (see [Rings](#rings-ringfragmentshader)) |
| **Particles in flight**: accretion disks and jets | Simulated on the CPU | `disk.js`, `jets.js` | One `THREE.Points` each, for all black holes combined |

Every black hole has a **slot** (see [Hole slots](#hole-slots)), stored on it as `hole.index`, and disk particles refer to their black hole by slot. `holes` lists every black hole with a slot, the player first, so it wins ties over stars. `roamers` is the player and the rivals. Black holes come and go: rivals as they're swallowed or let go, cores as the cells around you are built and dropped.

## Startup

1. `mulberry32(UNIVERSE_SEED)` gives a seeded random stream.
2. `planUniverse(random)` lays out the opening as plain objects: the main path, side trips, nebulae, start point and rival spawns.
3. `buildFields(plan, random, fieldMaterial)` builds geometry for every field of the opening **from the same random stream**, each with its own material. It also builds each field's spatial grid once. These fields stay for good.
4. The player and the opening's cores take the first slots. The disk pool, the jet pool, the streamer (which starts its worker), the post-processing chain, the HUD and the hints are created.
5. `reset()` puts everything at its starting state. For the opening it rebuilds nothing: it only refills the alive flags, restores the holes and clears the pools. It makes the opening's rivals afresh, clears the streamer, and has it open the cells around you, of which there are none at the start. Retrying from a checkpoint works much the same way (see [Checkpoints](#checkpoints)).

Because steps 2 and 3 share one random stream, any change that consumes a different number of random values in `planUniverse` changes all of the opening's galaxy geometry after it. The cells past the opening don't use that stream: each has streams of its own (see [The endless universe](#the-endless-universe)). Rival timers and jets use `Math.random()`, so runs differ slightly even though the universe is fixed.

## The endless universe

Past the opening, the universe is made on demand by three modules. `cosmos.js` says what's where, `stream.js` makes it real around you, and `builder.js` builds the particles off the main thread.

- **Rings of cells (`cosmos.js`).** Ring *n*, from `COSMOS.firstRing` (7) on, starts `COSMOS.span` (5) × `radiusOf(n)` from the centre and ends `TIER_GROWTH` times further out. Each ring is 1.6× bigger than the last, and each holds the same `COSMOS.sectors` (7) cells, turned by a twist of its own. A cell holds one structure of tier *n*, or up to `COSMOS.shrink` (0.6) tiers smaller, kept clear of the cell's edges, so nothing overlaps. Ring 7 starts at 537, past the opening's edge at 464.
  - Cells grow with you, so the number near you is the same at every size.
  - Progress needs no guided path: every ring offers seven structures of about your tier, just outward from where you are.
- **Cells are pure data.** `cellAt(ring, sector)` seeds `mulberry32(seedOf(UNIVERSE_SEED, ring, sector))` and returns, memoised, everything about the cell:
  - position, size, band and shape
  - colors and shape parameters
  - its core's name and mass
  - maybe a rival and a nebula

  Whether a cell has a rival is decided on a stream of its own (`seedOf(…, 1)`), so rivals can be counted in ring order to name them. Each cell's particles come from another (`seedOf(…, 2)`), so changing a shape never moves anything. `cellsNear(x, z, reach, minTier)` lists the cells whose structure comes within `reach`.
- **Bands and names (`names.js`).** `BANDS` in `config.js` says what each ring holds: giant galaxies (spiral or elliptical) from ring 7, galaxy groups from 12, clusters from 14, superclusters from 17 and great walls from 20. From ring 28 on, the walls are "beyond the observable universe".
  - Each band has a list of real names, dealt to its cells in a seeded shuffle, so real names turn up all through the band.
  - Cells past the end of a list, and every cell from ring 28, get a catalogue-style designation built from their position: `SDSS J…` for galaxies, `MCXC J…` for groups and clusters, `SCl J…` for superclusters, `LSS J…` for walls. Right ascension comes from the cell's direction around the centre, declination from its own seed.
  - Cores take their black hole's proper name where it has one (M87\*, NGC 4889\*, the Great Attractor), otherwise "the *name* core".
  - Rivals are named for real quasars, then `QSO J…`.
- **The streamer (`stream.js`).** `createStreamer()` keeps a **record** for every cell near you: `{ key, cell, name, x, z, radius, tier, core, field, fields, dropped }`. Records have the same `{ x, z, radius, field, core }` as the opening's galaxies, so the rival AI treats both alike. Four times a second the streamer works out which cells it wants: those whose structure is within `STREAM.build` (10) of your galaxy radii (`radiusOf` your tier), and no more than `STREAM.fade[0]` (3.5) tiers below you.
  - A wanted cell gets a record **at once**. `onBuild` makes its core, and its rival the first time round if fewer than 7 rivals are about. Then the cell goes to the worker. Its fields arrive a few frames later (about 20 ms of work each, which would stall a frame on the main thread), and up to two a frame go into the scene. So a core never turns up late, on top of you.
  - A record is **dropped** once its structure is beyond `STREAM.drop` (14) galaxy radii, or 0.3 tiers further below you than it was wanted, so it doesn't flicker in and out. Its fields are removed and disposed, and `onDrop` frees its core's slot. If the worker answers for a record that's been dropped meanwhile, the answer is thrown away.
- **Deltas.** What you changed in a cell lives on after it's dropped, keyed by cell. Each field keeps its eaten stars as a bitset, with the count left. The core keeps its mass, or that it's gone. The cell keeps whether its rival has come out. A cell built again is as you left it. Galaxies' angles aren't kept: a cell's fields start at `spinRate × game time`.
- **Fading.** Every field, the opening's included, fades as you outgrow it. Its own material's `uFade` goes from 1 at `STREAM.fade[1]` (2.5) tiers below you to 0 at `fade[0]` (3.5), and at 0 it's hidden and can't be captured from.
  - The opening's fields are hidden, never dropped, so `reset()` still rebuilds nothing. Its loose stars fade with its biggest galaxy, IC 1101.
  - "Your tier" comes from your shadow, which eases, so fading is smooth.
- **Rivals let go.** A rival that isn't hunting is removed once it's outgrown (more than 2.5 tiers below you) and beyond 32 of your reach radii, or once it's more than `STREAM.drop` galaxy radii away. That frees room for new ones. The opening's rivals go this way soon after you leave it.

## The frame

`update(elapsed, frameDelta)` first scales the host's delta: `delta = frameDelta · timeScale`. The time scale is 1 except while a hint slows the game down (see [Hints](#hints-hintsjs)). Steps 1–12 run on that scaled game time; the hints and the audio get the real `frameDelta`. Then it runs these steps in order:

1. **Sizes.** Each shadow eases toward `shadowOf(mass)`. A falling hole's drawn size shrinks with the square root of how far it has fallen.
2. **Steer.** Turns input into thrust for the player. Held keys win, and they push relative to the camera's flattened forward direction. Otherwise `pointer.steer()` supplies a push of length 0–1. With a mouse, it aims at the point on the galactic plane under the cursor, which it finds by raycasting. With touch, it depends on the touch mode: the joystick's offset or the phone's tilt is mapped onto the same camera axes as the keys, or the black hole aims at the point under the finger, as it does for the cursor. See [Pointer input](#pointer-input-pointerjs).
3. **Think.** Each live rival picks a mode and sets its thrust (see [gameplay.md](gameplay.md#rivals)).
4. **Move.** Each live roamer integrates thrust, drag and the gravity of every other live hole in **4 substeps**, so close passes stay accurate. Shadow crossings and reach captures are checked inside each substep and start a `fall()`.
5. **Sink.** Falling holes ride along with their eater, spiral in, and are `swallow()`ed at 0.6 of its shadow. Rivals swallowed this frame then give up their slots, unless you're gone: the camera follows whatever ate you, which might be one of them.
6. **Stream.** `streamer.update()` keeps the cells around you (or whatever swallowed you) up to date and puts newly built fields into the scene, and rivals left behind are let go (see [The endless universe](#the-endless-universe)).
7. **Rotate and fade fields.** Each galaxy's angle advances by its spin rate, and each field's fade follows your tier. While you're alive, a new band, or a galaxy you've just entered for the first time this run, puts its name on screen (see [HUD](#hud-hudjs)).
8. **Capture.** Builds the list of *warpers*: live roamers, at most `MAX_WARPS`. For each one, it queries the grid of every nearby field that hasn't faded out, and moves stars within reach into the disk.
9. **Disk update.** Advances every disk particle and absorbs those inside their hole's shadow. It returns the absorbed mass and count per slot. Rivals' gains are multiplied by `RIVAL_APPETITE`, and the smoothed feed rate drives `appetite` and the jets. Then the player loses `HAWKING` of its mass per second, plus `BOOST_COST` if `steer()` flagged it as boosting.
10. **Sides, rings, win check and checkpoint.** Recomputes who outweighs you and the vignette strength, checks for victory (outweighing `UNIVERSE_MASS`), and saves a checkpoint if one is waiting and it's safe (see [Checkpoints](#checkpoints)). For each black hole it:
   - eases `hole.tint` toward its side's photon ring color (`TINTS`; all neutral once you're not alive), in real time
   - places its ring near you: solid red at its danger radius if it outweighs you, dashed blue at `RINGS.prey` shadow radii if not, never under `RINGS.minPixels` on screen (measured with last frame's camera)
   - notices when it changes sides within ring range. Its `flash` goes to 1 and fades over `SIDE_CHANGE.flash` real seconds, brightening and swelling the ring, and `audio.sideChange()` plays once per frame at most. `hole.cuedAt` keeps it quiet for `SIDE_CHANGE.cooldown` seconds of game time.

   While a hint is explaining a black hole (`hints.focus`, from last frame), its ring pulses, with a pale ring at your reach as well for a lighter one.
11. **Camera.** Follows the player, or whatever swallowed it, and smoothly scales the orbit offset as you grow. This keeps the user's chosen orbit angle and zoom. `minDistance` and `maxDistance` are set each frame to 2.5×–40× your reach.
    - The clip planes grow with you: near is 0.25× your reach, and far is 600× it (at least 5000). They're only updated when either changes by more than 1%.
    - The backdrop starfield is moved to the camera so it reads as infinitely far away. It's scaled with your reach, its points with it, so it stays between the clip planes.
12. **Uniforms.** Writes the warpers into `uWarps` and the on-screen black holes into the lens pass's `uLenses`, with their tints in `uTints`. If there are more than `MAX_LENSES`, it keeps the biggest on screen. `uTime` is `elapsed` minus the time slow motion has cost, so the stars twinkle on game time.
13. **HUD, hints and audio.** Updates the mass readout, the feeding meter, the edge arrows and the vignette. `hints.update()` advances the lessons and any slowed moment and returns the time scale for the next frame. Then the audio layers get the danger, your feeding rate, speed and mass, the stars you absorbed this frame, and the time scale. See [Audio](#audio-audiojs).

`render(delta)` then calls `composer.render()`.

## Rendering pipeline

```
RenderPass ──► lens ShaderPass ──► UnrealBloomPass ──► OutputPass
 (scene)       (bend, shadows,      (strength 0.75,      (color-space
               photon rings)         radius 0.4,          conversion)
                                     threshold 0.55)
```

### Star fields (`fieldVertexShader`)

- These are static geometry. Only the `Points` object's `rotation.y` changes.
- Each field has its own `ShaderMaterial`. They all share the `uSize`, `uTime`, `uWarps` and `uWarpCount` uniform objects, so three.js compiles one program for all of them. A field's own `uFade` dims it as you outgrow it.
- **Captured stars** are hidden by a per-particle `aAlive` float. The shader moves dead points outside the clip volume. Only the changed index range (`dirtyMin…dirtyMax`) is uploaded each frame, through `BufferAttribute.addUpdateRange()`. A field with nothing left is hidden.
- **Gravity warp.** Within 2.2× reach of up to 8 roaming holes, stars are drawn pulled in, twisted and flattened. `warpToward()` in `holes.js` is the **exact CPU mirror** of this shader code, so a captured star starts its orbit precisely where it was drawn. If you change the warp in one place, change it in the other.
- Points below one pixel are drawn one pixel wide and dimmed instead, which stops them flickering.

### Accretion disks (`diskVertexShader`)

- Positions are world-space and come from the CPU. `aHole` carries each particle's black hole center and shadow radius, so a single draw call can shade every disk.
- **Heat:** the particle's own color shifts through orange and white to blue-white as it nears the shadow.
- **Beaming:** the side orbiting toward the camera is brighter.

### Lensing (`lensFragmentShader`)

- Up to 32 black holes (`MAX_LENSES`) per frame. Each is projected to screen space on the CPU. It's skipped if its shadow is under 0.4 px, or if it's off screen by more than its deflection reach. If more than 32 are left, the 32 biggest on screen are drawn.
- For each lens, the shader:
  - applies the **point-lens equation**, so light at distance *d* comes from *d − E²/d*, with *E* = 1.3 × shadow. This wraps the background into an Einstein ring.
  - fades the deflection out between 6× and 14× *E*
  - blacks out the shadow
  - adds a photon ring whose brightness follows `appetite`, in the hole's color from `uTints`: red if it outweighs you, blue if not, warm for you.
- UVs that bend off screen are mirrored back rather than clamped, which avoids smeared edges.

### Rings (`ringFragmentShader`)

- Every slot but yours has a ring mesh, made the first time the slot is used, plus one more for your reach during a hint. They share one quad lying on the galactic plane (±1.3, so a ring of radius 1 fits with room for its stroke), and each has its own `ShaderMaterial`, so its color, opacity and dashes are uniforms.
- The stroke is at least `uWidth` pixels thick (`RINGS.width` × the pixel ratio), using `fwidth()` of the distance from the centre, or 3% of the radius when that's thicker. So a ring stays crisp seen edge-on or from far away.
- `uDashes` > 0 cuts it into that many dashes (`RINGS.dashes`), which is how prey rings differ from danger rings without relying on color.
- The CPU keeps the radius on screen at least `RINGS.minPixels`: `leastRingRadius()` turns that into world units at the hole's depth.

## Data structures

### Spatial grid (`grid.js`)

- Each field gets a square grid over its **local** x/z, built once with a counting sort. Cell *c* holds `items[start[c]] … items[start[c+1] − 1]`. There are about four particles per cell, and grids range from 8×8 to 128×128.
- Rotating galaxies don't need a rebuilt grid. The query transforms the black hole's position *into* the field's local frame instead.
- `queryGrid` walks **square rings of cells outward** from the hole, so the nearest stars are captured first. It stops as soon as the visitor returns `false`, which is how the per-frame capture budget is enforced. Rings that miss the grid entirely are skipped.

### Disk pool (`disk.js`)

- One pool of `DISK_CAPACITY` (32,768) particles is shared by every black hole. The arrays are stored per attribute, and each particle carries an `owners[i]` slot.
- Live particles are **kept packed** at the front. Absorbing one swaps the last particle into its slot. Only `[0, count)` is drawn (`setDrawRange`) and uploaded (`addUpdateRange`).
- Orbits are applied as an **exact rotation** of `ORBIT_SPEED · (S/r)^1.5 · Δt` plus inflow, so tight orbits don't drift outward the way Euler steps would. A newly captured star keeps the difference between its own velocity and the flow as a drift, which decays at `SETTLE`. That way it eases into orbit instead of snapping.
- When a hole is swallowed, `transfer(from, to)` reassigns its particles to the eater. When a slot is freed, `release(slot)` drops whatever particles still name it.
- `load(saved, remap)` puts a checkpoint's particles back, moving each to the slot its black hole has now (`remap`) and dropping those whose black hole is gone.
- `owners` is a `Uint8Array`, so there can be at most 256 slots. `MAX_HOLES` is 128.

### Hole slots

- `slots[MAX_HOLES]` maps each slot to its black hole.
- `addHole()` gives a black hole the lowest free slot and that slot's ring, and adds it to `holes` (and to `roamers` if it roams).
- `removeHole()` releases the slot's disk particles, frees the slot, hides the ring, and marks the hole object `gone`, so anything still holding it (a hint's moment, say) sees it gone. Slots are reused; hole objects never are.
- Each black hole has a lasting `key`: `player`, `rival:<name>`, `core:opening:<i>`, `core:cell:<ring>:<sector>` or `rival:cell:<ring>:<sector>`. Checkpoints keep black holes by key, since their slots can change.
- The opening's cores are permanent. A cell's core comes and goes with its record. Once swallowed, it stays in its slot until the cell is dropped, and isn't made again. Rivals are made afresh on every reset and restore.

### Jet pool (`jets.js`)

- A ring buffer of `JET_CAPACITY` (4,096) particles. New particles overwrite the oldest.
- Each roaming hole emits up to 600 particles per second, scaled by `appetite` and split between both poles. Each particle lives `JET_LIFE` (0.8 s).

## Performance budget

| Thing | Count |
|-------|------:|
| Capturable stars in the opening (galaxies + nebulae + loose) | 618,183 |
| Capturable stars per cell past it | 24,000 in its structure (`COSMOS.stars`), 2,400 in a nebula if it has one, about 5,000 loose |
| Cells built at once | about 13 at tier 8 and 21 at tier 15: 1–1.5 million particles in all, the opening's included (most of it faded and hidden by then) |
| Disk particles (max) | 32,768 |
| Jet particles (max) | 4,096 |
| Backdrop stars | 3,000 |
| Draw calls for the scene | 1 per visible field in view, + disk, jets and backdrop, + 1 per visible ring (rings around black holes near you, and the reach ring during a hint) |
| Full-screen passes | lens, bloom (several mip levels), output |

- **CPU cost** is dominated by `disk.update()`, which is O(live disk particles), and by capture queries, which only touch cells near each roamer. Gravity is O(roamers × holes), about 8 × 50 past the opening.
- **Building cells** takes about 20 ms each (generating the particles and their grid), so the worker does it. The main thread only wraps the arrays it hands back in geometry, two cells a frame at most. Flying through new cells at tier 8 kept frames under 14 ms (p99) on a 144 Hz display. In development the worker loads three.js unbundled, so the first cells take a few seconds to arrive; in a build they arrive within a fraction of a second.
- **Memory** is about 100 MB of JS heap at tier 15. Saving a checkpoint takes about 6 ms.
- **Fields are frustum-culled** as whole `Points` objects, so only fields in view cost vertex work, and faded fields are hidden. The four giants past Andromeda are capped at 60,000 stars each (`MAX_GALAXY_STARS` in `universe.js`), and each cell's structure has 24,000. Their stars are drawn bigger to match, so they look about as full without the load.
- **GPU cost** is dominated by fill rate: additive points, plus bloom and lensing at full resolution. The renderer caps the pixel ratio at 2. On weak GPUs, lowering it to 1 in `main.js` is the biggest win.

## HUD (`hud.js`)

- Plain DOM layered over the canvas, at z-index 5. The hints sit at 6 (their letterbox bars at 4, under the HUD), the end-of-game card at 11 and the settings gear at 12.
- It's kept minimal for immersion: a frameless mass readout with a thin feeding meter, the danger vignette, and edge arrows. There's no intro panel. The only other things on screen during play are the hints, a line under the meter for 4 s when a checkpoint is saved ("Checkpoint · Triangulum core"), and a name at the top of the screen when you get somewhere new. The checkpoint line is one CSS animation, restarted for each checkpoint.
- **Place names** (`notePlace(text, scale)`) fade in and out at the top centre over 4.5 s: a galaxy or structure the first time you're inside it this run, or, set a little larger, a new band ("Galaxy clusters") the first time your mass reaches it. They queue, so two never talk over each other. Start over clears the queue.
- Edge arrows are drawn for the five nearest live black holes, and only while they're off screen. They move with `transform` only and never change text, so nothing is measured or laid out per frame.
- Only the end card accepts pointer events, so you can orbit the camera behind it. (The settings gear in the top-left corner belongs to `settings.js`.)
- The game-over card offers **Retry (R)** and **Start over** once you have a checkpoint, and **Try again (R)** before that. The victory card's **Keep drifting** hides it, and **Play again** starts over.
- Black holes are named in sentences by `called()`: "the Triangulum core", but "Sagittarius A\*" or "Sköll" (each hole's `article` says which).
- `formatMass()` names the scale, from million up to sextillion, then writes larger masses as a power of ten.
- `createHud()` also adds the settings menu's Game tab: **Retry**, with what it goes back to in small print, and **Start over**. Start over throws the checkpoint away, so its first press only turns it into "Press again to start over" for 4 s, or until the menu closes.

## Hints (`hints.js`)

The game starts with no introduction. `createHints({ controls })` teaches it as you play, keeping its own DOM and progress the same way the HUD does. Progress survives a retry or a restart but not a reload.

- **Control lessons.** Drift, then boost, then look around, each a gesture that loops on a 4.4 s period: fade in, play, fade out, pause. Each comes `LESSONS.wait` seconds after the one before it is done, and shows until you've done enough of it (`LESSONS` in `config.js`). Use counts from the start whether or not its lesson is showing, so a lesson you've already done is skipped.
  - Drift counts seconds at full thrust (`|thrust| / (THRUST · S · boost)`), boost counts seconds of `player.boosting`, and look counts the radians the camera turns, read from `controls.getAzimuthalAngle()` and `getPolarAngle()`. Only you turn the camera: the game's follow moves it but keeps its angles.
  - Each lesson has a mouse-and-keyboard version and a touch version. `hints.css` picks one with a `(hover: none) and (pointer: coarse)` media query. With a mouse, drift draws a ghost cursor gliding away from the black hole at the screen's centre (the camera always targets you), over a W A S D cluster lighting in turn. With touch, look is two fingers swinging side to side, and drift and boost follow the touch mode, which `update()` is given as `touch` and keeps on the root as `data-touch`:

    | Touch mode | Drift | Boost |
    |------------|-------|-------|
    | joystick | A ghost fingertip opens the joystick ring and drags | The same, out past the ring, which lights up |
    | follow | A fingertip lands ahead of you and a dashed trail draws out to it | Tap, then touch again and hold, glowing |
    | tilt | A phone outline tips away, then to the right, with a marble rolling the way you'd go | One fingertip held down, glowing |
  - The gestures are pure CSS animations sharing one period, so they stay in step and cost nothing per frame. When a lesson is done while showing, it flares and fades from wherever its pulse was (`--from`). Its class is dropped on `animationend`, which stops the gestures looping unseen.
  - Lessons hide while a moment is playing or you're not alive.
- **Slowed moments.** The first time you near a black hole heavier than you, and the first time you near a lighter one, time slows to `SLOW_MOTION.scale` (4%) while a label explains it:

  | Moment | Starts when | Label | In the world |
  |--------|-------------|-------|--------------|
  | heavier | Within `SLOW_MOTION.heavier` (6) of its danger radii while closing in and on screen, or half that regardless | "Heavier than you · Don't cross its red ring" | Its red ring pulses |
  | lighter | Within `SLOW_MOTION.lighter` (6) of your reach radii, and on screen | "Lighter than you · Bring it inside your reach to swallow it" | Its dashed blue ring pulses, and a pale ring with a "your reach" tag marks your reach |

  - The time scale eases down over `ease` (0.3 s of real time), holds for `hold` (3.5 s), then recovers over `recover` (0.8 s). It's interpolated as `scale^depth` (depth 0 to 1), so the change feels even. You can still steer and orbit the camera meanwhile; steering just acts in slow motion.
  - "On screen" means the hole's centre is inside 90% of the view, so on a narrow screen a hole at the edge waits until you turn toward it.
  - The label is pinned each frame (by `transform`) to the top of the ring on screen, and clamped to the viewport. The "your reach" tag sits under your reach ring. Letterbox bars slide in while time is slowed.
  - A moment ends early if you stop being alive or restart. If the black hole it's about is swallowed, it skips to the recovery.
  - The audio follows the time scale: while you're alive, the music's `playbackRate` drags toward half speed and the horizon filter closes toward 900 Hz. Once you're falling in, `fall()` and `swallowed()` take over both, as before.

## Pointer input (`pointer.js`)

- `createPointer({ camera, controls, element, settings })` listens for pointer events on the canvas and keeps its own input state, the same way the HUD keeps its DOM. It adds the Touch tab to the settings menu.
- **Mouse.** Thrust grows from 0 at `POINTER.dead` to full at `POINTER.full`. Both are measured as on-screen distance from the black hole, as shares of the screen height, so the feel doesn't change with zoom or tilt. A cursor above the horizon falls back to the ray's flattened direction.
  - While the left button is down, OrbitControls is orbiting the camera, so the last push is held rather than following a cursor that moves with the camera.
  - The right button boosts. Pan is disabled, so OrbitControls doesn't use that button.
  - Holding a movement key calls `yieldToKeys()`, which ignores the mouse until it moves again.
- **Touch.**
  - `controls.touches` is set to `{ ONE: null, TWO: DOLLY_ROTATE }`, so one finger belongs to the game and two fingers move the camera.
  - Only a lone finger counts. A second finger cancels it, and nothing more happens until every finger has lifted.
  - What it does depends on the touch mode, picked in the **Touch** tab of the settings menu (only shown where `(any-pointer: coarse)` matches) and kept in `localStorage`. The default is `TOUCH_MODE` (`joystick`). `pointer.mode` reports the one in use.

    | Mode | Steer | Boost |
    |------|-------|-------|
    | joystick | A joystick centred where the finger lands (`STICK`) | Drag past `STICK.boost` × the ring |
    | follow | Toward the point under the finger, exactly as for the cursor (`POINTER`) | Double-tap and hold: a touch landing within `DOUBLE_TAP.gap` of a tap shorter than `DOUBLE_TAP.tap` |
    | tilt | Tip the phone, measured from a level reading (`TILT`) | Any lone finger held down |

  - **Joystick.** The `.bh-stick` element is moved only on pointer events, not every frame. Its **Visible** switch hides it; the joystick works the same either way.
  - **Tilt.** It reads `deviceorientation`. From `beta` and `gamma` it works out which way a marble on the screen would roll (gravity along the screen, which doesn't depend on the compass heading `alpha`), then turns that into screen axes using `screen.orientation.angle`. The first reading, after you pick tilt, is the level that the lean is measured from. A retry or restart (`recentre()`), picking tilt again, or the screen rotating all take a new level. The lean's size, as an angle, goes through the `TILT.dead` / `TILT.full` ramp, and its direction maps onto the camera axes: tipping the top away is forward, like pushing the joystick up.
  - Where `DeviceOrientationEvent.requestPermission` exists (iOS, and some Chrome builds), tilt asks first. Browsers only show that prompt during a tap, so if tilt is a remembered choice at load, it asks at the next tap. If permission is refused, or no reading arrives within 2 s (there's no sensor, or the page isn't served over https), Tilt is greyed out and you steer with the joystick. The stored choice stays, in case it works next time.

## Audio (`audio.js`)

Every sound is synthesised with the Web Audio API. There are no audio files, and `three` is still the only dependency. `createAudio({ camera, settings })` keeps its own nodes, the same way the HUD keeps its DOM, and adds the Sound tab to the settings menu: its switches and the Feeding section.

- **Startup.** Browsers allow sound only after a click, tap or key press, so the `AudioContext` and the live layers are built at the first one (`pointerdown`, `pointerup`, `touchend` or `keydown`). The music doesn't need a gesture to render, so that starts as soon as the module loads.
- **Mixing.** Each bus sets its level from `AUDIO` in `config.js`:

  ```
  music ────┐
            ├─► horizon (lowpass) ──┐
  ambience ─┘                       ├─► master ──► highpass 30 Hz ──► limiter ──► speakers
  effects ──────────────────────────┤
  reverb (generated impulse) ───────┘
  ```

- **Music.** A 40 s loop in D minor: four chords of detuned sawtooth pads, a root drone, a high shimmer, and a sparse hummed melody, all in a 6 s reverb. It's rendered once in an `OfflineAudioContext` at 32 kHz and played by a looping `AudioBufferSourceNode`.
  - **Hums.** Each melody note, star chime and note of the reward chord is a hum (`hum()`): two sines a few cents apart, so they beat slowly, with quiet harmonics and no strike. In the melody, they swell up at the pad's own pitch.
  - Everything still sounding after the 40 s (the last chord's release, the hums and the reverb) is added back onto the start of the buffer. That's what the next pass round the loop would hear, so the loop has no seam.
  - The melody's timing comes from the music's own `mulberry32` seed, never the universe's stream.
- **Ambience.** These layers run all the time and follow the game at 20 Hz:
  - wind: band-passed pink noise, brighter and louder with speed
  - rumble: low brown noise, heavier as you grow
  - tension: two low sawtooths a semitone apart, opening up and throbbing faster as `danger` rises. The music also backs off as `danger` rises.
- **Feeding.** While `appetite` is up, you hear a swirl of band-passed noise with one of the `FEEDS` under it. Each star crossing your shadow also plays a short hum from the D minor pentatonic scale, D3 to D4. Chimes are rate-limited to one every 60–220 ms, louder when more stars land at once.
  - The six feeding sounds are all built at startup and all keep running, but only the chosen one is turned up. Each one's `follow(feeding)` sets it from the feeding rate at 20 Hz. Gulps are events instead, fired from `update()`.

    | Key | Sound |
    |-----|-------|
    | `crackle` | Sparse, bright clicks above 1.8 kHz (the original) |
    | `tuned` | Pink noise through six narrow band-passes on D minor chord tones (D2 up to D4), like breath across a bottle. The top three come in as feeding rises |
    | `drone` | A low D–A chord of slowly beating oscillators, whose lowpass opens as feeding rises |
    | `rain` | Longer, sparser grains than the crackle, kept between 250 and 800 Hz, and pattering faster as feeding rises |
    | `whoosh` | Low brown noise panned around you at the disk's speed, swelling as it passes the middle |
    | `gulps` | Soft low notes sliding down into place, 1 to 4 a second as feeding rises |

  - Which one plays is the player's choice. The default is `AUDIO.feeding` (`tuned`). The **Feeding** section of the settings menu's Sound tab picks another, which is kept in `localStorage`. Picking one plays it for 2.5 s as if you were feeding hard, so you hear what you chose without flying into stars. Their levels were matched by measurement, allowing for low sounds seeming quieter, so switching doesn't change how loud feeding is.
- **Events.** `fall()` and `swallow()` in `game.js` call these, and step 9 of the frame calls `sideChange`:

  | Call | When | Sound |
  |------|------|-------|
  | `sideChange` | A black hole near you changes sides | Two hummed notes: A3 up to D4 if it's now prey, A3 down to E♭3 if it now outweighs you |
  | `pull` | A black hole starts falling into you | A rising rush |
  | `devour` | You swallow it | A falling sub-bass thud, plus a hummed Dsus2 chord rolling upward |
  | `fall` | You start falling in | A wavering, falling tone over a building roar |
  | `swallowed` | You're swallowed | A final thud |
  | `distant` | Two other holes merge | A muffled thud, panned by the camera and quieter with distance |

  When you fall in, the horizon filter closes and the music's `playbackRate` drops to a quarter, so time seems to stall. `reset()` opens the filter again, restores the rate, and silences any effect that's still ringing.
- **Mute.** The settings menu's Sound tab has switches for Sound (the master mute, also **M**), Music and Effects (which covers the ambience too), and below them the Feeding choices (see [Settings](#settings-settingsjs)). Each setting is kept in `localStorage`. The master mute fades out and then suspends the context, so muted audio costs nothing; Music and Effects just zero their bus gains. The context is also suspended while the tab is hidden.

## Settings (`settings.js`)

- `createSettings()` builds the gear in the top-left corner and its panel, and owns nothing else. The panel is a row of tabs, each showing one page, so no page gets crowded. Each module adds its tab with `addTab(name)`, in the order they're created: the HUD's **Game** tab, the audio's **Sound** tab, then the pointer's **Touch** tab. A tab made with `{ touch: true }` only shows where `(any-pointer: coarse)` matches.
- Modules fill their page with `addGroup(page, heading)`, `addSwitch(parent, …)`, `addChoices(group, …)` and `addButton(parent, label, key, onClick)`. A button has a line of small print under its label, and the key it's bound to beside it. A group with the `bh-columns` class puts its choices two to a row, as the feeding sounds are. `onClose(callback)` runs something whenever the panel closes, and `close()` closes it.
- The tab you picked stays picked while the panel is closed, and the tabs stay at the top while a long page scrolls.
- Each module keeps its own settings and remembers them with `readFlag` / `writeFlag` / `readChoice` / `writeChoice`, which treat unavailable `localStorage` (private browsing, `file://`) as nothing stored.
- The panel closes on a click or tap outside it, or Escape. It scrolls when it's taller than the screen, as on a phone held sideways. Inputs blur after each change, so Space and the arrow keys go back to the game.

## Checkpoints

Each core or rival you swallow makes a checkpoint due (`pending` in `game.js`). Step 9 saves it in the first frame where you're alive, nothing heavier is within `CHECKPOINT.safe` (8) of its danger radii (`danger < 1 / safe²`), and no rival is hunting you. So a retry never drops you somewhere you can't get away from. If you're swallowed before it's saved, Retry goes back to the checkpoint before.

- `saveCheckpoint()` copies everything that changes as you play:
  - each of the opening's fields' alive flags, remaining count and rotation
  - the streamer's deltas (`streamer.save()`, which first notes the state of every cell still built)
  - each black hole by key, with its slot, kind, name, starting mass, mass, sizes, state, eater (by key), fall progress, feeding, side of you, position, velocity and rival AI (its galaxy by key)
  - the disk pool (`disk.save()`, live particles only)
  - the stats, whether you've won, and the camera's offset and zoom

  The opening's alive flags are most of it, about 2.5 MB. Only the last checkpoint is kept, in memory, so a reload loses it.
- `restore()` puts the opening's alive flags back and uploads them whole, like `reset()`. The black holes and cells then go back in this order:
  1. `streamer.load()` drops every record (freeing their cores) and takes the saved deltas.
  2. Every rival is removed and the saved ones are made again.
  3. You go back to where you were, and `streamer.sync()` opens the cells around you, making their cores from the deltas.
  4. Every saved state goes back to the black hole with its key. Then eaters and rivals' galaxies are relinked by key.
  5. `disk.load()` moves each particle to its black hole's new slot (a slot-to-slot `remap`).

  Jets are cleared, not saved. `disk.load()` sets the draw range to 0 until the next `update()` places the particles and uploads them. The cells' fields arrive from the worker a few frames later, with the stars you'd eaten still gone.
- `reset()` and `restore()` both end in `resume()`. It puts the camera back on you, clears the jets, drops a checkpoint that was still waiting, hides the end card, ends any slowed moment, re-levels tilt and resets the audio.
- **R** and Retry call `retry()`: the last checkpoint, or `reset()` if there isn't one. Start over (`startOver()`) forgets the checkpoint and resets.
- Anything you add that changes during play has to be saved and restored here too. Otherwise a retry carries it over from the run you just lost. Changes inside a cell of the endless universe belong in its delta, so they also survive the cell being dropped.

## Lifecycle

`dispose()` removes the window listeners (keyboard, blur, resize), the pointer and tilt listeners, the audio's unlock and visibility listeners, the Start over button's timer, and the HUD, hints, joystick and settings menu elements. It stops the streamer's worker, closes the `AudioContext`, and disposes the post-processing passes, the composer, and every geometry, material and texture in the scene. It leaves the renderer, camera and controls alone, because the host owns them.
