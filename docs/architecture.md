# Architecture

How the code is put together: what runs each frame, how everything is drawn, and the data structures that keep about 360,000 capturable stars cheap.

## Modules

```
main.js ──► game.js ──┬─► config.js        constants (imported by most modules)
                      ├─► universe.js      planUniverse(random) → plain data
                      ├─► fields.js ──► grid.js (buildGrid)
                      ├─► grid.js          queryGrid
                      ├─► holes.js         createHole, dangerRadius, warpToward, …
                      ├─► disk.js          createDisk
                      ├─► jets.js          createJets
                      ├─► shaders.js       GLSL strings
                      ├─► pointer.js       createPointer (mouse and touch steering)
                      ├─► hud.js ──► hud.css
                      └─► utils.js         mulberry32, createStarfield, disposeObject
```

- **`main.js`** is the host. It creates the `WebGLRenderer`, the `PerspectiveCamera` (60° fov, near 0.1, far 1000) and `OrbitControls` with damping. It calls `createGame()` and runs the loop, clamping each frame's delta to 0.1 s so a backgrounded tab doesn't jump forward.
- **`game.js`** holds `createGame({ renderer, camera, controls })`, a closure that owns all game state. It returns `{ scene, update, render, dispose }`. The rival AI, capture, movement and camera code live in it because they share that state.
- Every other module is a factory or a set of pure helpers with no game state of its own.

## World layout

The game is effectively 2D. Physics runs on the **x/z plane** (y = 0, "the galactic plane"). Positions, velocities and distances all ignore y. Stars and disks have a little vertical thickness, which is only visual.

There are three kinds of object:

| Object | Moves? | Made by | Drawn as |
|--------|--------|---------|----------|
| **Fields**: 12 galaxies, 5 nebulae, 1 set of loose stars | Galaxies rotate in place | `fields.js` | One `THREE.Points` each, sharing one `ShaderMaterial` |
| **Black holes**: 1 player, 5 rivals, 12 cores | Player and rivals roam; cores are fixed | `holes.js` | Nothing directly. The lens pass draws them, plus a red `RingGeometry` mesh when they're dangerous |
| **Particles in flight**: accretion disks and jets | Simulated on the CPU | `disk.js`, `jets.js` | One `THREE.Points` each, for all black holes combined |

The order of the `holes` array matters: `[player, ...rivals, ...cores]`. Each hole's index is stored on it, and disk particles refer to their black hole by that index. The player comes first, so it wins ties over stars.

## Startup

1. `mulberry32(UNIVERSE_SEED)` gives a seeded random stream.
2. `planUniverse(random)` lays out the main path, side trips, nebulae, start point and rival spawns as plain objects.
3. `buildFields(plan, random, starMaterial)` builds geometry for every field **from the same random stream**. It also builds each field's spatial grid once.
4. Black holes, rings, the disk pool, the jet pool, the post-processing chain and the HUD are created.
5. `reset()` puts everything at its starting state. **R** calls the same function, so a restart rebuilds nothing. It only refills the alive flags, restores the holes and clears the pools.

Because steps 2 and 3 share one random stream, any change that consumes a different number of random values in `planUniverse` changes all of the galaxy geometry after it. Rival timers and jets use `Math.random()`, so runs differ slightly even though the universe is fixed.

## The frame

`update(elapsed, delta)` runs these steps in order:

1. **Sizes.** Each shadow eases toward `shadowOf(mass)`. A falling hole's drawn size shrinks with the square root of how far it has fallen.
2. **Steer.** Turns input into thrust for the player. Held keys win, and they push relative to the camera's flattened forward direction. Otherwise `pointer.steer()` supplies a push of length 0–1. With a mouse, it aims at the point on the galactic plane under the cursor, which it finds by raycasting. With touch, the joystick offset is mapped onto the same camera axes as the keys. See [Pointer input](#pointer-input-pointerjs).
3. **Think.** Each live rival picks a mode and sets its thrust (see [gameplay.md](gameplay.md#rivals)).
4. **Move.** Each live roamer integrates thrust, drag and the gravity of every other live hole in **4 substeps**, so close passes stay accurate. Shadow crossings and reach captures are checked inside each substep and start a `fall()`.
5. **Sink.** Falling holes ride along with their eater, spiral in, and are `swallow()`ed at 0.6 of its shadow.
6. **Rotate fields.** Each galaxy's angle advances by its spin rate.
7. **Capture.** Builds the list of *warpers*: live roamers, at most `MAX_WARPS`. For each one, it queries every nearby field's grid and moves stars within reach into the disk.
8. **Disk update.** Advances every disk particle and absorbs those inside their hole's shadow. It returns the absorbed mass and count per hole index. Rivals' gains are multiplied by `RIVAL_APPETITE`, and the smoothed feed rate drives `appetite` and the jets. Then the player loses `HAWKING` of its mass per second, plus `BOOST_COST` if `steer()` flagged it as boosting.
9. **Rings, notices, win check, hints.** Updates danger rings and the vignette, posts toasts when weight relations flip, and checks for victory.
10. **Camera.** Follows the player, or whatever swallowed it, and smoothly scales the orbit offset as you grow. This keeps the user's chosen orbit angle and zoom. `minDistance` and `maxDistance` are set each frame to 2.5×–40× your reach. The backdrop starfield is moved to the camera so it reads as infinitely far away.
11. **Uniforms.** Writes the warpers into `uWarps` and the on-screen black holes into the lens pass's `uLenses`.
12. **HUD.** Updates the stats, labels and vignette.

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
- **Captured stars** are hidden by a per-particle `aAlive` float. The shader moves dead points outside the clip volume. Only the changed index range (`dirtyMin…dirtyMax`) is uploaded each frame, through `BufferAttribute.addUpdateRange()`. A field with nothing left is hidden.
- **Gravity warp.** Within 2.2× reach of up to 8 roaming holes, stars are drawn pulled in, twisted and flattened. `warpToward()` in `holes.js` is the **exact CPU mirror** of this shader code, so a captured star starts its orbit precisely where it was drawn. If you change the warp in one place, change it in the other.
- Points below one pixel are drawn one pixel wide and dimmed instead, which stops them flickering.

### Accretion disks (`diskVertexShader`)

- Positions are world-space and come from the CPU. `aHole` carries each particle's black hole center and shadow radius, so a single draw call can shade every disk.
- **Heat:** the particle's own color shifts through orange and white to blue-white as it nears the shadow.
- **Beaming:** the side orbiting toward the camera is brighter.

### Lensing (`lensFragmentShader`)

- Up to 24 black holes (`MAX_LENSES`) per frame. Each is projected to screen space on the CPU. It's skipped if its shadow is under 0.4 px, or if it's off screen by more than its deflection reach.
- For each lens, the shader:
  - applies the **point-lens equation**, so light at distance *d* comes from *d − E²/d*, with *E* = 1.3 × shadow. This wraps the background into an Einstein ring.
  - fades the deflection out between 6× and 14× *E*
  - blacks out the shadow
  - adds a photon ring whose brightness follows `appetite`.
- UVs that bend off screen are mirrored back rather than clamped, which avoids smeared edges.

## Data structures

### Spatial grid (`grid.js`)

- Each field gets a square grid over its **local** x/z, built once with a counting sort. Cell *c* holds `items[start[c]] … items[start[c+1] − 1]`. There are about four particles per cell, and grids range from 8×8 to 128×128.
- Rotating galaxies don't need a rebuilt grid. The query transforms the black hole's position *into* the field's local frame instead.
- `queryGrid` walks **square rings of cells outward** from the hole, so the nearest stars are captured first. It stops as soon as the visitor returns `false`, which is how the per-frame capture budget is enforced. Rings that miss the grid entirely are skipped.

### Disk pool (`disk.js`)

- One pool of `DISK_CAPACITY` (32,768) particles is shared by every black hole. The arrays are stored per attribute, and each particle carries an `owners[i]` hole index.
- Live particles are **kept packed** at the front. Absorbing one swaps the last particle into its slot. Only `[0, count)` is drawn (`setDrawRange`) and uploaded (`addUpdateRange`).
- Orbits are applied as an **exact rotation** of `ORBIT_SPEED · (S/r)^1.5 · Δt` plus inflow, so tight orbits don't drift outward the way Euler steps would. A newly captured star keeps the difference between its own velocity and the flow as a drift, which decays at `SETTLE`. That way it eases into orbit instead of snapping.
- When a hole is swallowed, `transfer(from, to)` reassigns its particles to the eater.
- `owners` is a `Uint8Array`, so there can be at most 256 black holes.

### Jet pool (`jets.js`)

- A ring buffer of `JET_CAPACITY` (4,096) particles. New particles overwrite the oldest.
- Each roaming hole emits up to 600 particles per second, scaled by `appetite` and split between both poles. Each particle lives `JET_LIFE` (0.8 s).

## Performance budget

| Thing | Count |
|-------|------:|
| Capturable stars (galaxies + nebulae + loose) | 360,879 |
| Disk particles (max) | 32,768 |
| Jet particles (max) | 4,096 |
| Backdrop stars | 3,000 |
| Draw calls for the scene | 21 (18 fields, disk, jets, backdrop) + 1 per visible danger ring |
| Full-screen passes | lens, bloom (several mip levels), output |

- **CPU cost** is dominated by `disk.update()`, which is O(live disk particles), and by capture queries, which only touch cells near each roamer. Gravity is O(roamers × holes), which is 6 × 18.
- **GPU cost** is dominated by fill rate: additive points, plus bloom and lensing at full resolution. The renderer caps the pixel ratio at 2. On weak GPUs, lowering it to 1 in `main.js` is the biggest win.

## HUD (`hud.js`)

- Plain DOM layered over the canvas, at z-index 5. The intro panel sits at 10 and the end-of-game card at 11.
- Labels move with `transform` only. A label is measured (`offsetWidth`) only when its text changes, so there's no layout thrashing per frame.
- Only the end card accepts pointer events, so you can orbit the camera behind it.
- Toasts remove themselves on `animationend`, and at most three are shown at once.

## Pointer input (`pointer.js`)

- `createPointer({ camera, controls, element })` listens for pointer events on the canvas and keeps its own input state, the same way the HUD keeps its DOM.
- **Mouse.** Thrust grows from 0 at `POINTER.dead` to full at `POINTER.full`. Both are measured as on-screen distance from the black hole, as shares of the screen height, so the feel doesn't change with zoom or tilt. A cursor above the horizon falls back to the ray's flattened direction.
  - While the left button is down, OrbitControls is orbiting the camera, so the last push is held rather than following a cursor that moves with the camera.
  - The right button boosts. Pan is disabled, so OrbitControls doesn't use that button.
  - Holding a movement key calls `yieldToKeys()`, which ignores the mouse until it moves again.
- **Touch.**
  - `controls.touches` is set to `{ ONE: null, TWO: DOLLY_ROTATE }`, so one finger belongs to the game and two fingers move the camera.
  - A lone finger becomes a joystick (`STICK`). A second finger cancels it, and no new joystick starts until every finger has lifted.
  - The `.bh-stick` element is moved only on pointer events, not every frame.
- `pointer.input` says whether `'mouse'` or `'touch'` steered last. The hunt toast uses it to name the right boost control.

## Lifecycle

`dispose()` removes the window listeners (keyboard, blur, resize), the pointer listeners, and the HUD and joystick elements. It also disposes the post-processing passes, the composer, and every geometry, material and texture in the scene. It leaves the renderer, camera and controls alone, because the host owns them.
