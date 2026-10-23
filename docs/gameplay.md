# Gameplay

This document covers the rules of the game, how it scales as you grow, and how the rival black holes behave. The constants named here live in [`src/config.js`](../src/config.js). [tuning.md](tuning.md) explains how to change them.

## The goal

Be the last black hole. The universe holds **12 galaxies**, each with a supermassive core, and **5 rival** black holes. You win when every core and every rival is gone. Rivals can fall into cores too, so not everything has to go into you. After the victory card you can keep drifting.

You lose when something heavier swallows you. The game-over card shows your run's stats, and the camera follows whatever ate you.

## Mass, shadow and reach

Each black hole has a **mass** *M*. The HUD shows it in units of a million suns, so 1 unit is "1.00 million M☉".

- **Shadow radius** `S = SHADOW_SIZE · ∛M`. Matter that crosses it disappears. On screen it's the black disk the lensing pass cuts out, with a photon ring around it.
- **Reach** `= REACH · S` (5 shadow radii). A roaming black hole captures any star within its reach, and any lighter black hole too, with one exception covered below.

Speed, gravity, the camera distance and the accretion disk are all measured in shadow radii. Growing doesn't change how the game feels. Only the universe around you changes scale, and the camera zooms out to match.

## Rules for black holes

You, the rivals and the cores all follow the same rules every frame:

1. **Everything pulls on whatever roams.** Every live black hole pulls on every moving one with `PULL · S³ / (d² + 0.25 S²)`, which is proportional to its mass. Cores never move.
2. **Crossing a heavier hole's shadow is fatal.** A black hole that comes within the shadow of a heavier one starts falling in.
3. **Reach captures lighter holes.** A roaming black hole captures any lighter or equal-mass black hole within its reach. **Only you can take a core.** Rivals can't, but they can still fall into one by crossing its shadow.

A captured black hole spirals into its eater and shrinks as it goes. At 0.6 of the eater's shadow radius it's gone and its whole mass goes to the eater. Anything still falling into it, plus its accretion disk, passes to the eater as well.

## Feeding

Stars within reach are pulled out of their galaxy into your **accretion disk**. Each one keeps the color and position it was drawn with, then settles into a Kepler-like orbit and spirals inward. Mass is added only when a particle crosses your shadow, so growth lags a little behind capture.

- **You keep 100%** of what you absorb. **Rivals keep 30%** (`RIVAL_APPETITE`), which is why you can outgrow them.
- The **feeding meter** under your mass shows your current growth rate. Full means growing 4% per second (`FULL_FEED`). The rate also drives how bright your photon ring is and how strongly you fire **relativistic jets** from both poles.
- **You're always shrinking.** Hawking radiation costs you 0.3% of your mass per second (`HAWKING`), and boosting burns another 1.5% per second (`BOOST_COST`) while you push. Both scale with your mass, so stop eating for long and lighter rivals and cores start to outweigh you. Rivals and cores don't radiate.
- If more than 1,500 stars are within reach in one frame, the rest are captured over the next few frames, nearest first.

## Danger rings and the vignette

Every live black hole heavier than you gets a **red ring**. Its radius is the larger of two distances:

- the **point of no return**, where its pull beats your full thrust: `√(PULL · S_hole³ / (THRUST · S_you))`
- for a rival, its **reach**, inside which it captures you outright.

Rings fade out with distance. The screen edges glow red as you get close to one.

## Galaxy tiers: why the game scales

Galaxies come in **tiers**. Each tier is `TIER_GROWTH` (1.6×) wider than the one before:

| Tier | Galaxy | Radius | Stars | Core mass | Expected arrival mass |
|-----:|--------|-------:|------:|----------:|----------------------:|
| 0 | Sextans Dwarf | 4.0 | 12,000 | 1.40 | 1.00 |
| 0.6 | Pinwheel | 5.3 | 14,414 | 3.26 | 2.33 |
| 1 | Small Magellanic Cloud | 6.4 | 16,288 | 5.73 | 4.10 |
| 1.5 | Sunflower | 8.1 | 18,976 | 11.6 | 8.29 |
| 2 | Triangulum | 10.2 | 22,107 | 23.5 | 16.8 |
| 2.4 | Tadpole | 12.4 | 24,981 | 41.3 | 29.5 |
| 2.6 | Cartwheel | 13.6 | 26,555 | 54.7 | 39.1 |
| 3 | Whirlpool | 16.4 | 30,006 | 96.2 | 68.7 |
| 3.4 | Milky Way | 19.8 | 33,907 | 169 | 121 |
| 4 | Sombrero | 26.2 | 40,728 | 394 | 281 |
| 4.3 | Black Eye | 30.2 | 44,637 | 602 | 430 |
| 5 | Andromeda | 41.9 | 55,280 | 1,614 | 1,153 |

The whole-number tiers form the **main path**, which spirals outward from where you start. The fractional tiers are **side trips** placed near a main-path galaxy. Five **nebulae** sit beside the legs of the main path. Each is a gas cloud worth 0.3× the next galaxy's arrival mass. Faint **loose stars** fill the space between galaxies, each sized and weighted to match the nearest one.

For a galaxy of radius *G*:

- It expects you to **arrive weighing** `(G / 4)³`. At that mass your reach is a tenth of the galaxy's radius.
- Its **core** weighs `CORE_MASS` (1.4×) the arrival mass. You have to eat roughly 30% of its stars before you can take the core.
- Its **stars** are worth `STARS_MASS` (1.4×) the arrival mass in total. Eating the stars and the core leaves you at about 3.8× arrival, close to the next tier's 1.6³ ≈ 4.1×.

The universe comes from a fixed seed (`UNIVERSE_SEED`), so every visit has the same layout.

## Rivals

| Name | Home galaxy | Starting mass |
|------|-------------|--------------:|
| Sköll | Sextans Dwarf | 0.55 |
| Hati | Small Magellanic Cloud | 2.66 |
| Apep | Triangulum | 11.7 |
| Charybdis | Whirlpool | 48.1 |
| Fenrir | Andromeda | 576 |

A rival's starting mass is a share of its home galaxy's arrival mass. Sköll shares your starting galaxy, begins on the far side of it, and starts out lighter than you.

### Behaviour

Each rival is always in one of four modes. Each mode moves at its own share of your unboosted thrust (`RIVAL_PACE`).

| Mode | Pace | What it does | Leaves when |
|------|-----:|--------------|-------------|
| **feed** | 0.6 | Circles its chosen galaxy in a tightening orbit, starting at 0.75 of the radius and closing in by 1.5% of the radius per second. It never gets closer than 3× the danger radius of a heavier core. | It has fed for 40 s (`FEED_TIME`), or fewer than 20% of the stars are left. It then switches to **travel**. |
| **travel** | 0.85 | Flies to the center of a newly chosen galaxy. | It is within 0.8 of that galaxy's radius, then switches to **feed**. |
| **hunt** | 1.0 | Chases you, aiming 0.4 s ahead of where you're going. | You get beyond 16 of its reach radii, 12 s pass, you reach 95% of its mass, or you die. It then rests for 10 s and switches to **travel**. |
| **flee** | 1.0 | Runs straight away from you, weaving so it's harder to run down. | You're no longer within range. It then switches to **travel**. |

Fleeing takes priority. A rival flees when you outweigh it and you're within 8 of *your* reach radii (`FLEE_RANGE`).

A rival **starts hunting** when all of these hold:

- you're alive and it isn't resting
- you weigh between 25% (`HUNT_PREY`) and 90% of its mass
- you're within 9 of *its* reach radii (`HUNT_RANGE`).

Because it only hunts prey of at least a quarter of its mass, a hunter is never more than ∛4 ≈ 1.59× your size. Speed scales with size, and your boost is 1.8×, so **boosting always outruns a hunter**. That holds even though boosting costs mass: a full 12-second hunt of boosting leaves you 81% of your mass, which still keeps the hunter under 1.71× your speed (see [tuning.md](tuning.md#rivals)).

**Choosing a galaxy.** It skips galaxies with less than 25% of their stars left. It also skips galaxies whose arrival mass is more than 4× off its own mass in either direction. Each remaining galaxy gets a score:

```
score = left · radius / (distance + radius) · (0.3 if it's the current galaxy) · random(0.7–1.3)
```

Here `left` is the share of stars remaining. The highest score wins.

**Avoidance.** In every mode, a rival is pushed away from any heavier black hole within 4× that hole's danger radius, and the push grows as it gets closer. The danger radius is measured at the rival's current pace.

Rivals start with staggered feed timers, so they don't all leave their home galaxies at once.

## HUD

The HUD is deliberately sparse, and nothing pops up during play. Weight relations show in the world itself: a red ring means heavier than you, and no ring means prey.

- **Top right:** your mass and, under it, the feeding meter.
- **Edge arrows:** for each of the five nearest live black holes that is off screen, an arrow pinned to the screen edge points toward it. Blue means you outweigh it, red means it outweighs you.
- **Intro panel:** the pitch, what the rings and arrows mean, and the controls. It fades at the first click, touch, key press or scroll, or after 20 s.
- **End card:** peak mass, stars, cores swallowed out of 12, rivals and time.
