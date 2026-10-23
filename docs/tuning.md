# Tuning

All gameplay and rendering constants are in [`src/config.js`](../src/config.js), and each one has a short comment there. This page covers how the constants **depend on each other**: which ones you can change alone, and which need a matching change elsewhere to keep the game balanced.

S stands for a black hole's shadow radius throughout.

## Movement and gravity

| Constant | Default | Effect |
|----------|--------:|--------|
| `THRUST` | 30 | Acceleration in S/s². |
| `DRAG` | 2 | Linear drag in 1/s. **Top speed = `THRUST / DRAG`** = 15 S/s. |
| `BOOST` | 1.8 | Thrust multiplier while boosting (Shift, the right mouse button, or dragging past the joystick ring), for a boosted top speed of 27 S/s. |
| `HAWKING` | 0.003 | Hawking radiation: the share of your mass you lose every second, boosting or not (0.3%/s, so idling halves you in about 4 minutes). |
| `BOOST_COST` | 0.015 | Extra mass lost per second while boosting and pushing, as a share of your mass (1.8%/s in total). |
| `PULL` | 187 | Gravity strength, applied as `PULL · S³ / d²`. |

The **point of no return** against a black hole your own size is `√(PULL / THRUST)` ≈ 2.5 S. Red rings use the general form, `√(PULL · S_hole³ / (THRUST · S_you))`.

- Scale `PULL` and `THRUST` together to change how fast things feel while keeping the same escape distances.
- Raise `PULL` alone and the rings get bigger, so getting close to heavier holes becomes riskier.
- Change `DRAG` to make movement floatier (lower) or snappier (higher) without changing gravity.

## Size and scale

| Constant | Default | Effect |
|----------|--------:|--------|
| `SHADOW_SIZE` | 0.08 | Shadow radius of a mass-1 black hole, in world units. |
| `REACH` | 5 | Capture radius, in S. It also sets the warp radius, rival ranges and the camera distance. |
| `START_MASS` | 1 | Your starting mass. |
| `TIER_GROWTH` | 1.6 | How much wider each galaxy tier is than the one before. |
| `CORE_MASS` | 1.4 | A core's mass, as a multiple of its galaxy's arrival mass. |
| `STARS_MASS` | 1.4 | The combined mass of a galaxy's stars, as a multiple of its arrival mass. |

These constants keep progression balanced across tiers:

- At arrival mass, **your reach is `SHADOW_SIZE · REACH / 4` of a galaxy's radius**, which is 10%. `arrivalMass()` uses `(G / 4)³` because galaxy radii start at 4. If you change `SHADOW_SIZE` or `REACH`, you change how big you are relative to each galaxy.
- **How many stars you must eat before you can take the core:** `(CORE_MASS − 1) / STARS_MASS` ≈ 29%.
- **What one full galaxy is worth:** `1 + STARS_MASS + CORE_MASS` ≈ 3.8× arrival. That should be close to **`TIER_GROWTH³`** ≈ 4.1×, the next tier's arrival mass. If you change `TIER_GROWTH`, rebalance `STARS_MASS` and `CORE_MASS` so the two stay close. Otherwise you'll arrive at the next galaxy too small (a grind) or too big (it's trivial).

## Rivals

| Constant | Default | Effect |
|----------|--------:|--------|
| `RIVALS` | 5 entries | `[name, home galaxy name, mass as a share of that galaxy's arrival mass]`. The home name must match a galaxy in `MAIN_PATH` or `SIDE_TRIPS`. |
| `RIVAL_APPETITE` | 0.3 | The share of absorbed mass a rival keeps. Raise it and rivals keep up with you; lower it and you outgrow them sooner. |
| `RIVAL_PACE` | feed 0.6 · travel 0.85 · hunt 1 · flee 1 | Thrust per mode, as a share of your unboosted thrust. |
| `FEED_TIME` | 40 s | How long a rival feeds on one galaxy before moving on. |
| `HUNT_PREY` | 0.25 | The smallest prey a rival will hunt, as a share of its own mass. |
| `HUNT_RANGE` / `HUNT_GIVE_UP` | 9 / 16 | Distances at which a rival starts and abandons a hunt, in its reach radii. |
| `HUNT_TIME` / `HUNT_REST` | 12 s / 10 s | The longest a hunt lasts, and the cooldown after it. |
| `FLEE_RANGE` | 8 | Rivals flee a heavier you within this many of your reach radii. |

**Keep hunts escapable.** A hunter is at most `∛(1 / HUNT_PREY)` times your size, and speed scales with size. So you can always outrun a hunter when this holds:

```
∛(1 / HUNT_PREY) · RIVAL_PACE.hunt < BOOST        defaults: 1.59 · 1 < 1.8 ✓
```

Boosting costs mass, and a smaller you is slower, so the margin shrinks the longer you boost. Over a whole hunt (`HUNT_TIME`) of boosting you keep `e^−(HAWKING + BOOST_COST) · HUNT_TIME` of your mass, and the stricter form is:

```
∛(1 / HUNT_PREY) · e^((HAWKING + BOOST_COST) · HUNT_TIME / 3) · RIVAL_PACE.hunt < BOOST
                                                  defaults: 1.59 · 1.075 · 1 = 1.71 < 1.8 ✓
```

If you raise `RIVAL_PACE.hunt`, `HUNT_TIME`, `HAWKING` or `BOOST_COST`, or lower `HUNT_PREY`, check this inequality or some hunts become unwinnable.

## Accretion and effects

| Constant | Default | Effect |
|----------|--------:|--------|
| `ORBIT_SPEED` | 4 | Angular speed (rad/s) at the shadow's edge. It falls off as r^−1.5. |
| `INFLOW`, `INFLOW_MIN` | 0.35, 0.4 | Inward drift per unit of radius, plus a minimum in S/s. Higher values feed you faster. Lower values give longer-lived, prettier disks with more delay before the mass lands. |
| `SETTLE` | 4 | How quickly a captured star's own velocity blends into the orbit. |
| `FULL_FEED` | 0.04 | The growth rate (mass per second, as a share of your mass) that counts as feeding flat out. It sets the meter, the photon ring glow and the jets. |
| `JET_SPEED`, `JET_LIFE` | 12 S/s, 0.8 s | Jet length is about speed × life. |
| `WARP` | outer 2.2 · shrink 0.25 · twist 0.5 · flatten 0.5 | How stars near a roaming hole are drawn. The shader and `warpToward()` both read these, so they stay in sync. |
| `STAR_SIZE` | 14 | Base point size, multiplied by the pixel ratio. |
| `EINSTEIN` | 1.3 | Einstein-ring radius in S. Higher values give stronger lensing. |

Bloom is set where `UnrealBloomPass` is created in `game.js`: strength 0.75, radius 0.4, threshold 0.55.

## Sound

| Constant | Default | Effect |
|----------|--------:|--------|
| `AUDIO` | master 0.8 · music 0.5 · ambience 0.6 · effects 0.8 · feeding `'tuned'` | Gains for each bus (see [architecture.md](architecture.md#audio-audiojs)). Music and ambience both pass through the horizon filter. Effects include the feeding sounds and star chimes. `feeding` is the feeding sound you hear until you pick another in the settings menu: `'crackle'`, `'tuned'`, `'drone'`, `'rain'`, `'whoosh'` or `'gulps'`. |

- The music is normalised to a 0.9 peak before `AUDIO.music` is applied, so changing the score doesn't change its loudness.
- A limiter sits after the master gain, so pushing levels up squashes the loudest moments (being swallowed, a big meal) rather than clipping them.
- The score itself (chords, loop length, melody density), the feeding sounds' levels and how each layer follows the game are set in `audio.js`, next to the code that uses them.

## Capacity limits

Check these before adding content:

| Limit | Default | What happens when exceeded |
|-------|--------:|----------------------------|
| `MAX_WARPS` | 8 | The number of roaming holes that warp **and capture** stars. Only the first 8 live roamers (you plus 7 rivals) do either. **If you add more than 7 rivals, raise this.** It's a shader loop bound, so the cost is small. |
| `MAX_LENSES` | 24 | The number of black holes the lens pass can draw at once. There are currently 18 (you, 5 rivals, 12 cores). **If you add galaxies or rivals beyond 24 total holes, raise this.** |
| `DISK_CAPACITY` | 32,768 | Captured stars in flight across all disks. When the pool is full, capture pauses until particles are absorbed. |
| `CAPTURES_PER_FRAME` | 1,500 | Spreads big captures over several frames. Raising it gives faster feeding on fast machines, but frame spikes on slow ones. |
| `JET_CAPACITY` | 4,096 | Jet particles. When full, the oldest are overwritten. |
| Hole count | 256 | Hard limit. `disk.js` stores owners in a `Uint8Array` and sizes the absorbed arrays to 256. |

## Content

- **Universe layout:** change `UNIVERSE_SEED` for a different arrangement. Any change to the planning code or the content lists also reshuffles everything generated after it, because the layout and the geometry share one random stream.
- **Galaxies:** add a name to `MAIN_PATH` to get the next whole tier, or add `[name, tier, nearIndex]` to `SIDE_TRIPS`. Here `nearIndex` is the main-path galaxy to place it beside. Colors are picked from `PALETTES`.
- **Star counts** are set in `universe.js` and `fields.js`:
  - galaxies: `12000 · (radius / 4)^0.65`
  - nebulae: 2,400 each
  - loose stars: 9,000.
  These counts drive both GPU load and how many captures there are to make.
- **Controls:** `KEYS` maps actions to `KeyboardEvent.code` values. Every listed code has its default browser action suppressed.
  - `POINTER` sets the mouse dead zone and the distance for full thrust, as shares of the screen height (defaults 0.03 and 0.2).
  - `STICK` sizes the touch joystick in CSS pixels: full thrust at `radius` (56), a dead zone of `dead` (6), and boost beyond `boost` × the radius (1.6).
