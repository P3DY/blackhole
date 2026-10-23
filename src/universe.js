import {
  CORE_MASS,
  MAIN_PATH,
  NEBULA_COLORS,
  PALETTES,
  RIVALS,
  SIDE_TRIPS,
  STARS_MASS,
  TIER_GROWTH,
  arrivalMass,
} from './config.js';
import { TAU } from './utils.js';

// The giant galaxies past Andromeda would otherwise each hold 65,000–100,000 stars. Their stars are drawn bigger
// to match, so they look about as full with this many, and the GPU has less to do.
const MAX_GALAXY_STARS = 60000;

// Lays out the universe as plain data: where every galaxy, nebula and rival is, and where you start.
// Deterministic for a given `random`, so a seeded generator gives the same universe every time.
export function planUniverse(random) {
  const galaxies = [];
  const isClear = (x, z, radius, spacing) =>
    galaxies.every((g) => Math.hypot(g.x - x, g.z - z) > (g.radius + radius) * spacing);

  // The main path spirals outward, turning the same way at every step.
  let heading = random() * TAU;
  MAIN_PATH.forEach((name, tier) => {
    const radius = 4 * TIER_GROWTH ** tier;
    let spot = { x: 0, z: 0 };
    if (tier > 0) {
      const previous = galaxies[tier - 1];
      spot = findSpot(
        random,
        previous,
        (previous.radius + radius) * 1.3,
        () => heading + 0.7 + random() * 0.6,
        (x, z) => isClear(x, z, radius, 1.15),
      );
      heading = spot.angle;
    }
    galaxies.push(planGalaxy(name, spot.x, spot.z, radius, random));
  });

  for (const [name, tier, near] of SIDE_TRIPS) {
    const radius = 4 * TIER_GROWTH ** tier;
    const anchor = galaxies[near];
    const spot = findSpot(
      random,
      anchor,
      (anchor.radius + radius) * (1.4 + random() * 0.5),
      () => random() * TAU,
      (x, z) => isClear(x, z, radius, 1.2),
    );
    galaxies.push(planGalaxy(name, spot.x, spot.z, radius, random));
  }

  // A gas cloud beside each leg of the main path, to feed on along the way.
  const nebulae = [];
  for (let tier = 1; tier < MAIN_PATH.length; tier++) {
    const from = galaxies[tier - 1];
    const to = galaxies[tier];
    const radius = to.radius * 0.35;
    const midpoint = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    const spot = findSpot(
      random,
      midpoint,
      (from.radius + to.radius) * 0.5,
      () => random() * TAU,
      (x, z) => isClear(x, z, radius, 1.1),
    );
    nebulae.push({
      ...spot,
      tier, // it fades with the galaxy it leads to
      radius,
      count: 2400,
      mass: 0.3 * arrivalMass(to.radius),
      colors: NEBULA_COLORS[tier % NEBULA_COLORS.length],
    });
  }

  // Start out in the smallest galaxy, about halfway out from its core.
  const home = galaxies[0];
  const angle = random() * TAU;
  const start = { x: home.x + Math.cos(angle) * home.radius * 0.55, z: home.z + Math.sin(angle) * home.radius * 0.55 };

  // Rivals start out feeding in their home galaxies; one that shares yours starts on the far side.
  const rivals = RIVALS.map(([name, homeName, share]) => {
    const galaxy = galaxies.find((g) => g.name === homeName);
    const at = galaxy === home ? angle + Math.PI : random() * TAU;
    return {
      name,
      home: galaxies.indexOf(galaxy),
      mass: share * arrivalMass(galaxy.radius),
      x: galaxy.x + Math.cos(at) * galaxy.radius * 0.65,
      z: galaxy.z + Math.sin(at) * galaxy.radius * 0.65,
    };
  });

  return { galaxies, nebulae, start, rivals };
}

// Tries headings from `nextAngle()` until a spot `distance` from `from` is clear, edging further out each try.
function findSpot(random, from, distance, nextAngle, isClear) {
  for (let attempt = 0; ; attempt++) {
    const angle = nextAngle();
    const reach = distance * (1 + attempt * 0.03);
    const x = from.x + Math.cos(angle) * reach;
    const z = from.z + Math.sin(angle) * reach;
    if (isClear(x, z)) return { x, z, angle };
  }
}

// Parameters for spiralParticles() in fields.js, plus where the galaxy is and what it's worth.
function planGalaxy(name, x, z, radius, random) {
  const [insideColor, outsideColor] = PALETTES[Math.floor(random() * PALETTES.length)];
  const arrival = arrivalMass(radius);
  return {
    name,
    x,
    z,
    radius,
    count: Math.min(Math.round(12000 * (radius / 4) ** 0.65), MAX_GALAXY_STARS),
    branches: 2 + Math.floor(random() * 4),
    spin: (4.5 + random() * 2) / radius, // the same amount of winding whatever the size
    randomness: 0.3 + random() * 0.2,
    randomnessPower: 2.6 + random() * 0.8,
    insideColor,
    outsideColor,
    spinRate: 0.06 * (4 / radius) ** 0.3, // small galaxies turn a little faster
    coreMass: CORE_MASS * arrival,
    starsMass: STARS_MASS * arrival,
  };
}
