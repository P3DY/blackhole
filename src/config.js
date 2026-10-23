// Every gameplay and rendering constant in one place. docs/tuning.md explains how they relate.

// --- Scale ------------------------------------------------------------------------
//
// A black hole of mass M has a shadow of radius SHADOW_SIZE · ∛M, where matter disappears, and captures
// anything within REACH shadow radii of it. Speed, camera distance and the accretion disk are all measured
// in shadow radii, so the game plays the same at every size; only the universe around you changes scale.
//
// Galaxies come in tiers, each TIER_GROWTH times wider than the last. A galaxy of radius G expects you to
// arrive weighing (G / 4)³, which reaches a tenth of the way across it. Its core weighs a bit more than that,
// so you have to eat about a third of the stars before you can take the core, and eating everything leaves
// you about the right size for the next tier.

export const SHADOW_SIZE = 0.08;
export const REACH = 5;
export const START_MASS = 1;
export const TIER_GROWTH = 1.6;
export const CORE_MASS = 1.4; // × arrival mass
export const STARS_MASS = 1.4; // × arrival mass, shared between all of a galaxy's stars

export const shadowOf = (mass) => SHADOW_SIZE * Math.cbrt(mass);
export const arrivalMass = (galaxyRadius) => (galaxyRadius / 4) ** 3;

// --- Movement and gravity (in shadow radii, so they scale with the black hole) ----

export const THRUST = 30; // acceleration, shadow radii / s²
export const DRAG = 2; // 1/s, so top speed is THRUST / DRAG = 15 shadow radii per second
export const BOOST = 1.8;
// You lose mass all the time: Hawking radiation costs HAWKING of your mass per second, and boosting burns
// BOOST_COST more. Both are shares of your mass, so they feel the same at every size.
export const HAWKING = 0.003;
export const BOOST_COST = 0.015;
// Every black hole pulls with PULL · S³ / d², where S is its shadow radius (so the pull is proportional to
// its mass). Against a black hole your own size, that beats your thrust inside 2.5 S: the point of no return.
export const PULL = 187;
export const CAMERA_DISTANCE = 8; // in reach radii
export const CAMERA_ELEVATION = 0.9; // radians above the galactic plane

// --- Rivals -----------------------------------------------------------------------

// Other roaming black holes, named for mythical devourers of suns:
// [name, home galaxy, mass as a share of what that galaxy expects you to arrive with].
export const RIVALS = [
  ['Sköll', 'Sextans Dwarf', 0.55],
  ['Hati', 'Small Magellanic Cloud', 0.65],
  ['Apep', 'Triangulum', 0.7],
  ['Charybdis', 'Whirlpool', 0.7],
  ['Fenrir', 'Andromeda', 0.5],
];
export const RIVAL_APPETITE = 0.3; // rivals keep this share of the stars they swallow; you keep all of it
export const RIVAL_PACE = { feed: 0.6, travel: 0.85, hunt: 1, flee: 1 }; // thrust, as a share of yours unboosted
export const FEED_TIME = 40; // seconds a rival feeds on one galaxy before moving on
// A rival hunts you when you weigh between HUNT_PREY of its mass and 90% of it: anything smaller isn't worth
// the chase, and it means a hunter is never more than ∛4 ≈ 1.6× your size, so boosting can always outrun it.
export const HUNT_PREY = 0.25;
export const HUNT_RANGE = 9; // it notices you within this many of its reach radii…
export const HUNT_GIVE_UP = 16; // …gives up beyond this many…
export const HUNT_TIME = 12; // …or after this many seconds, then rests before hunting again
export const HUNT_REST = 10;
export const FLEE_RANGE = 8; // rivals run from a heavier you within this many of your reach radii

// --- Accretion --------------------------------------------------------------------

export const DISK_CAPACITY = 32768;
export const CAPTURES_PER_FRAME = 1500;
export const ORBIT_SPEED = 4; // angular speed at the shadow's edge (rad/s), falling off as r^-1.5 like a Kepler orbit
export const INFLOW = 0.35; // inward speed per unit of radius (1/s)…
export const INFLOW_MIN = 0.4; // …plus this many shadow radii per second, so matter doesn't hover outside the shadow
export const SETTLE = 4; // how quickly captured matter settles into the flow (1/s)

export const JET_CAPACITY = 4096;
export const JET_SPEED = 12; // shadow radii per second
export const JET_LIFE = 0.8; // seconds
export const FULL_FEED = 0.04; // growing 4% per second counts as feeding flat out: brightest ring, strongest jets

// Stars near a roaming black hole are drawn pulled in and swirled around it. The vertex shader does it, and
// warpToward() repeats it on the CPU so a captured star starts out exactly where it was drawn.
export const WARP = { outer: 2.2, shrink: 0.25, twist: 0.5, flatten: 0.5 };
export const MAX_WARPS = 8;

export const STAR_SIZE = 14; // point size scale, multiplied by the device pixel ratio
export const MAX_LENSES = 24;
export const EINSTEIN = 1.3; // Einstein-ring radius, in shadow radii

// --- Who outweighs whom -----------------------------------------------------------
//
// Every black hole shows whether it outweighs you, in the world rather than the HUD. Its photon ring takes a
// tint: `heavier` or `lighter`, while yours stays `you`. Near you it also gets a ring: solid red at its danger
// radius if it's heavier, dashed blue at `RINGS.prey` shadow radii if it's lighter.
export const TINTS = { you: '#ffddad', heavier: '#ff6a50', lighter: '#9ad8ff' };
export const RINGS = {
  heavier: '#ff4040',
  lighter: '#5ee7ff',
  prey: 2.5, // shadow radii from a lighter black hole's centre
  dashes: 24,
  floor: 0.3, // a prey ring's opacity, and the least a danger ring fades to…
  range: [16, 32], // …until it's this far from you, in your reach radii, where rings fade out
  minPixels: 12, // a ring is never drawn smaller than this radius on screen…
  width: 1.5, // …or thinner than this many pixels
};
// When a black hole near you changes sides (you outgrow it, or it outgrows you), its ring flares for `flash`
// seconds and a tone rises or falls. The same black hole won't do it again for `cooldown` seconds of game time,
// so two holes trading places at a tie don't keep chiming.
export const SIDE_CHANGE = { flash: 1.2, cooldown: 4 };

// --- Universe ---------------------------------------------------------------------

export const PALETTES = [
  ['#ff7a3d', '#2a4bd4'],
  ['#ffcf70', '#7a3dd4'],
  ['#ff6fa8', '#2ab0d4'],
  ['#ffe3a3', '#3d6dff'],
  ['#ff9a5a', '#c42a8a'],
  ['#fff0c0', '#2a8fd4'],
  ['#ffb347', '#5b2ad4'],
];
export const NEBULA_COLORS = [
  ['#ff5fa2', '#7a5cff'],
  ['#3de0c8', '#2a6bff'],
  ['#9dff6a', '#2ad4a0'],
  ['#ff8a5c', '#ff3d7a'],
  ['#c08cff', '#4fd2ff'],
];

// The main path: each galaxy one tier bigger than the last, spiralling outward.
export const MAIN_PATH = ['Sextans Dwarf', 'Small Magellanic Cloud', 'Triangulum', 'Whirlpool', 'Sombrero', 'Andromeda'];
// Side trips: [name, tier, index of the main-path galaxy they sit near].
export const SIDE_TRIPS = [
  ['Pinwheel', 0.6, 1],
  ['Sunflower', 1.5, 2],
  ['Tadpole', 2.4, 2],
  ['Cartwheel', 2.6, 3],
  ['Milky Way', 3.4, 4],
  ['Black Eye', 4.3, 5],
];

export const UNIVERSE_SEED = 1987; // the same universe on every visit

// --- Sound ------------------------------------------------------------------------
//
// Everything you hear is synthesised by audio.js; there are no sound files. The levels are gains, 0–1.
// `feeding` is the feeding sound you hear until you pick another in the settings menu: 'crackle', 'tuned',
// 'drone', 'rain', 'whoosh' or 'gulps' (see FEEDS in audio.js).
export const AUDIO = { master: 0.8, music: 0.5, ambience: 0.6, effects: 0.8, feeding: 'tuned' };

// --- Hints ------------------------------------------------------------------------
//
// There's no intro: hints.js teaches the game as you play. The controls come one at a time as looping
// gestures (drift, then boost, then look around), each `wait` seconds after the one before it is done, until
// you've drifted for `drift` seconds at full thrust, boosted for `boost` seconds and turned the camera through
// `look` radians. Whatever you've already done counts, so a lesson you don't need never shows.
export const LESSONS = { wait: 1.5, drift: 1.2, boost: 0.8, look: 0.8 };
// The first time you near a black hole heavier than you (within `heavier` of its danger radii while closing
// in, or half that regardless) and the first time you near a lighter one (within `lighter` of your reach
// radii, on screen), time slows to `scale` while a label explains it. In real seconds: `ease` to slow down,
// `hold`, then `recover` back to full speed.
export const SLOW_MOTION = { scale: 0.04, ease: 0.3, hold: 3.5, recover: 0.8, heavier: 6, lighter: 6 };

// Mouse: steers toward the point under the cursor, with no push within `dead` of the black hole and full
// thrust from `full`, both as shares of the screen height. The touch mode 'follow' steers the same way.
export const POINTER = { dead: 0.03, full: 0.2 };
// Touch steers one of three ways, picked in the settings menu: 'joystick', 'follow' (head for the finger) or
// 'tilt'. This is the one you get until you pick another.
export const TOUCH_MODE = 'joystick';
// Joystick: centred where the finger lands, in CSS pixels. Full thrust at `radius`, boost past `boost` × radius.
export const STICK = { radius: 56, dead: 6, boost: 1.6 };
// Follow: boost by double-tapping and holding, the second touch landing within `gap` seconds of a first one
// that lasted under `tap` seconds.
export const DOUBLE_TAP = { tap: 0.3, gap: 0.3 };
// Tilt: in degrees from how you held the phone when you picked tilt or restarted. No push within `dead`, full
// thrust from `full`. Holding a finger down boosts.
export const TILT = { dead: 3, full: 18 };

export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  boost: ['ShiftLeft', 'ShiftRight'],
  restart: ['KeyR'],
  mute: ['KeyM'],
};
