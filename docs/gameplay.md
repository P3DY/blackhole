# Gameplay

This document covers the rules of the game, how it scales as you grow, and how the rival black holes behave. The constants named here live in [`src/config.js`](../src/config.js). [tuning.md](tuning.md) explains how to change them.

## The goal

Outgrow the universe. You start in the **opening**, a hand-made stretch of 16 real galaxies, each with a supermassive core, and 7 rival black holes. Past it the universe goes on without end, built around you as you go (see [Past the opening](#past-the-opening-the-endless-universe)). It holds giant galaxies, then galaxy groups, clusters, superclusters and great walls, each scale bigger than the last.

You win when you outweigh all the matter in the observable universe: `UNIVERSE_MASS`, 10²³ M☉, about tier 27.8. After the victory card you can keep drifting, out beyond the observable universe.

You lose when something heavier swallows you. The game-over card shows your run's stats, and the camera follows whatever ate you. From there you can retry from your last [checkpoint](#checkpoints) or start over.

## Checkpoints

Every core or rival you swallow saves a checkpoint, as soon as it's safe: nothing heavier within 8 of its danger radii (`CHECKPOINT.safe`), and no rival hunting you. That way a retry never puts you somewhere you can't escape. A line under your mass says "Checkpoint ·" and what you swallowed, then fades.

- **Retry** goes back to the last checkpoint: every star, black hole, accretion disk and stat as it was then. **R** does the same, as does Retry on the game-over card or in the Game tab of the settings menu. With no checkpoint yet, it starts from the beginning.
- **Start over** goes back to the beginning and throws the checkpoint away. In the settings menu it asks for a second press.
- Only the last checkpoint is kept, and only until you reload the page.
- What you changed in the endless universe is kept too, even in places you've left far behind: a retry finds the stars you'd eaten there still gone, and the cores you'd swallowed still missing.

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

## Who outweighs whom: tints, rings and the vignette

Every black hole shows which side of you it's on, in the world rather than the HUD (constants in `TINTS`, `RINGS` and `SIDE_CHANGE`):

- **Photon ring tint.** A heavier black hole's photon ring glows red, a lighter one's glows pale blue, and yours stays warm white. This works at any zoom, even where the hole is only a few pixels wide. A core sitting on a bright galactic bulge mostly shows the bulge it lenses, so its ring (below) says more.
- **Red ring** around anything heavier. Its radius is the larger of two distances:
  - the **point of no return**, where its pull beats your full thrust: `√(PULL · S_hole³ / (THRUST · S_you))`
  - for a rival, its **reach**, inside which it captures you outright.
- **Dashed blue ring** around anything lighter, at 2.5 of its shadow radii (`RINGS.prey`).

A red ring is at its brightest from 3 of its radii in, and fades to a floor (`RINGS.floor`, 0.3) by 12. Prey rings stay at that floor. Both fade out between 16 and 32 of your reach radii from you (`RINGS.range`), and arrows at the screen edge take over for black holes off screen. However far you zoom out, a ring is drawn at least 12 px in radius (`RINGS.minPixels`) and 1.5 px thick (`RINGS.width`). The screen edges glow red as you get close to something heavier.

**Changing sides.** You lose mass all the time and gain it in bursts, and so do rivals, so the balance can tip either way. When a black hole within ring range changes sides, its ring flares and swells for 1.2 s (`SIDE_CHANGE.flash`), its tint crossfades, and two hummed notes play: up a fourth when it becomes prey, down a tritone when it becomes a threat. The same black hole stays quiet for 4 s of game time after that (`SIDE_CHANGE.cooldown`), so two holes trading places at a near tie don't keep chiming.

The first time you near a heavier black hole, time slows almost to a stop while its ring pulses and a label explains it. The first time you near a lighter one, the same happens with its blue ring and a ring showing your reach (see [Hints](#hints)).

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
| 5.5 | Centaurus A | 53.1 | 60,000 | 3,267 | 2,333 |
| 6 | Condor | 67.1 | 60,000 | 6,611 | 4,722 |
| 6.4 | Malin 1 | 81.0 | 60,000 | 11,621 | 8,300 |
| 7 | IC 1101 | 107.4 | 60,000 | 27,080 | 19,343 |

The whole-number tiers form the **main path**, which spirals outward from where you start. The fractional tiers are **side trips** placed near a main-path galaxy. The four giants past Andromeda would hold 64,000 to 102,000 stars by the usual formula, but they're capped at 60,000. Their stars are worth as much in total, so each one is worth more. Seven **nebulae** sit beside the legs of the main path. Each is a gas cloud worth 0.3× the next galaxy's arrival mass. Faint **loose stars** fill the space between galaxies, each sized and weighted to match the nearest one.

For a galaxy of radius *G*:

- It expects you to **arrive weighing** `(G / 4)³`. At that mass your reach is a tenth of the galaxy's radius.
- Its **core** weighs `CORE_MASS` (1.4×) the arrival mass. You have to eat roughly 30% of its stars before you can take the core.
- Its **stars** are worth `STARS_MASS` (1.4×) the arrival mass in total. Eating the stars and the core leaves you at about 3.8× arrival, close to the next tier's 1.6³ ≈ 4.1×.

The universe comes from a fixed seed (`UNIVERSE_SEED`), so every visit has the same layout.

The core of the Milky Way is **Sagittarius A\***, and Andromeda's is **M31\***, the names of the real black holes there (`CORE_NAMES`). Every other core is "the *galaxy* core".

## Past the opening: the endless universe

Past IC 1101 the universe keeps going, in rings around the opening. Ring *n* holds seven structures of about tier *n*, so whichever way you head outward you find things your size. Each ring is 1.6× wider than the last. The structures are built as you come near and let go once you're far away or have long outgrown them, but whatever you ate stays eaten. The details are in [architecture.md](architecture.md#the-endless-universe).

The rules don't change. Each structure is worth what a galaxy of its size is (its core `CORE_MASS`, its stars `STARS_MASS` times the arrival mass). It sometimes has a gas cloud beside it, and it's surrounded by loose stars. What changes is what you're eating. From tier 8 up, the mass that each scale expects of you lines up with the real thing:

| Rings | Scale | Looks like | Expected arrival mass | For comparison |
|------:|-------|------------|----------------------:|----------------|
| 7–11 | Giant galaxies | Spirals and ellipticals | 1.9×10¹⁰ M☉ at tier 7 | Tier 10 (1.3×10¹² M☉) is about the Milky Way with its dark matter |
| 12–13 | Galaxy groups | A handful of galaxies, a little gas | 2.2×10¹³ M☉ | Groups weigh 10¹³–10¹⁴ M☉ |
| 14–16 | Galaxy clusters | Dozens of galaxies crowding a giant, in hot gas | 3.7×10¹⁴ M☉ | Tier 15 (1.5×10¹⁵ M☉) is about the Virgo or Coma cluster |
| 17–19 | Superclusters | Knots of galaxies strung on threads | 2.6×10¹⁶ M☉ | Tier 18 (10¹⁷ M☉) is about Laniakea, our own supercluster |
| 20+ | Great walls | Long walls of knots and threads | 1.8×10¹⁸ M☉ | Tier 27.8 (10²³ M☉) is all the matter in the observable universe |

**Real names.** Each scale draws on real objects of its kind: giant galaxies (NGC 1600, Cygnus A, Rubin's Galaxy…), Stephan's Quintet and the Leo Triplet, the Virgo, Coma and Bullet clusters, Laniakea and the Shapley Supercluster, the Sloan Great Wall and the Big Ring. Cores have their real black hole's name where it has one: the Virgo Cluster's core is **M87\***, the Coma Cluster's **NGC 4889\***, the Phoenix Cluster's **Phoenix A\***, and Laniakea's is **the Great Attractor**. When a scale runs out of real names, the rest get catalogue designations from their place in the sky, like `SDSS J123456.78+123456.7`, and so does everything beyond the observable universe.

**Fading.** Things you've long outgrown fade away: anything 2.5 tiers below you starts to dim, and at 3.5 tiers it's gone and can't be eaten. The opening fades the same way once you've left it far behind.

## Rivals

| Name | Home galaxy | Starting mass |
|------|-------------|--------------:|
| Sköll | Sextans Dwarf | 0.55 |
| Hati | Small Magellanic Cloud | 2.66 |
| Apep | Triangulum | 11.7 |
| Charybdis | Whirlpool | 48.1 |
| Fenrir | Andromeda | 576 |
| Rahu | Condor | 2,833 |
| Bakunawa | IC 1101 | 9,671 |

A rival's starting mass is a share of its home galaxy's arrival mass. Sköll shares your starting galaxy, begins on the far side of it, and starts out lighter than you.

**Past the opening**, about three structures in ten come with a rival of their own, 0.5–0.7 of their arrival mass. It appears the first time the structure is built, if fewer than 7 rivals are about. These rivals are named for real quasars, black holes feeding hard enough to outshine their galaxies: TON 618, 3C 273, 3C 48, OJ 287, S5 0014+81 and more, then `QSO J…` designations. A rival that isn't hunting you is let go once you've long outgrown it and it's out of sight, or once it's far behind. That makes room for new ones, and it's how the opening's rivals go once you leave it.

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

## Hints

There's no introduction: the game starts straight away and teaches itself as you play.

- **Controls** are shown one at a time as looping gestures that fade in and out until you've done them: drift (the mouse, W A S D, or the touch mode's gesture), then boost (Shift, the right mouse button, or the touch mode's boost), then look around (left-drag, or two fingers). On a touch screen the drift and boost gestures follow the touch mode picked in the settings. Each waits 1.5 s after the last one is done. Anything you've already done counts, so you only see what you haven't found yet.
- **Weight** is explained the first time it matters. Nearing a black hole that outweighs you, or one you outweigh, slows time to 4% for about 4.5 s while a label over it says what it means: don't cross a heavier one's red ring, and bring a lighter one inside your reach to swallow it.
- What you've learned stays learned when you retry or start over. A reload starts over.

The thresholds are in `LESSONS` and `SLOW_MOTION` (see [tuning.md](tuning.md#hints)).

## HUD

The HUD is deliberately sparse. Apart from the hints, nothing pops up during play. Weight relations show in the world itself: red photon rings and solid red rings mean heavier than you, blue photon rings and dashed blue rings mean prey (see [Who outweighs whom](#who-outweighs-whom-tints-rings-and-the-vignette)).

- **Top right:** your mass and, under it, the feeding meter.
- **Edge arrows:** for each of the five nearest live black holes that is off screen, an arrow pinned to the screen edge points toward it. Blue means you outweigh it, red means it outweighs you.
- **Hints:** control gestures low in the middle of the screen, and labels over a black hole while time is slowed (see [Hints](#hints)).
- **Checkpoint note:** a line under your mass for a few seconds when a checkpoint is saved.
- **Place names:** at the top of the screen, the name of a galaxy or structure the first time you're inside it this run, and the name of a new scale ("Galaxy clusters") the first time your mass reaches it.
- **End card:** peak mass, stars, cores swallowed, rivals swallowed, the largest structures you reached, and time.
- **Settings:** a faint gear in the top-left corner opens a menu with tabs:
  - **Game:** Retry (**R**), with what it goes back to, and Start over.
  - **Sound:** switches for Sound, Music and Effects, and a choice of feeding sound. **M** toggles Sound.
  - **Touch** (touch screens only): how you steer (see [Touch controls](#touch-controls)).

## Touch controls

Two fingers always orbit and zoom the camera. What one finger does is a choice in the Touch tab of the settings menu, which is remembered:

| Mode | Steer | Boost |
|------|-------|-------|
| **Joystick** (default) | Drag from where your finger lands. Further means more thrust, up to the ring | Drag past the ring |
| **Follow finger** | Touch where you want to go, as with the mouse. Further from you means more thrust | Double-tap and hold |
| **Tilt** | Tilt the phone the way you want to roll. Tipping the top away goes forward | Hold a finger down anywhere |

- The joystick's **Visible** switch hides the ring and knob. It still works the same, from wherever your finger lands.
- Tilt is measured from how you held the phone when you picked it. Retrying, starting over, or picking Tilt again takes that again (re-centres it). On iOS the browser asks for permission to use the motion sensors the first time. Tilt needs a motion sensor and a page served over https; without them it's greyed out and the joystick is used.

## Sound

Sound also carries information, so the screen can stay quiet:

- **Wind** gets brighter the faster you drift, and a low **rumble** gets heavier as you grow.
- **Feeding** sounds like a swirl over a sound you pick in the settings: tuned breath (the default), a drone, rain, a circling whoosh, gulps, or the original crackle. Each star crossing your shadow also plays a soft low hum.
- **Danger:** as you near something heavier, a low growl rises and throbs faster, and the music backs off. It tracks the same `danger` value as the red vignette.
- **Changing sides:** when a black hole near you becomes prey, two hummed notes rise a fourth. When it comes to outweigh you, they fall a tritone.
- **Swallowing** a core or rival: a rush as it starts to fall in, then a deep thud and a rising chord.
- **Being swallowed:** a falling, wavering tone. Then the world goes muffled and the music slows to a crawl until you retry or start over.
- **Somewhere else,** when two other black holes merge, you hear a muffled thud, panned toward it and quieter the further away it is.
