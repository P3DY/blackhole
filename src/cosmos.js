import { BANDS, CORE_MASS, COSMOS, PALETTES, STARS_MASS, TIER_GROWTH, UNIVERSE_SEED, arrivalMass, radiusOf } from './config.js';
import { nameCell, nameRival } from './names.js';
import { TAU, mulberry32, seedOf } from './utils.js';

// The endless universe past the opening, as plain data. The plane is tiled by rings of cells: ring n starts
// COSMOS.span × radiusOf(n) from the centre and ends TIER_GROWTH times further out, so each ring is TIER_GROWTH
// times bigger than the last and holds the same COSMOS.sectors cells. Each cell holds one structure of about
// tier n, kept clear of the cell's edges, so nothing overlaps. What's in a cell depends only on its ring and
// sector (each has its own seeded random stream), so cells can be built, thrown away and built again in any order.

const { firstRing, span, sectors, shrink, rivalChance } = COSMOS;

// How far from the centre ring `ring` starts.
export const ringStart = (ring) => span * radiusOf(ring);

// The ring that `distance` from the centre falls in (firstRing − 1 inside the opening).
export function ringAt(distance) {
  if (distance < ringStart(firstRing)) return firstRing - 1;
  return firstRing + Math.floor(Math.log(distance / ringStart(firstRing)) / Math.log(TIER_GROWTH));
}

// Which of BANDS a tier (or ring) falls in, or -1 inside the opening.
export function bandOf(tier) {
  let band = -1;
  BANDS.forEach((entry, i) => {
    if (tier >= entry.from) band = i;
  });
  return band;
}

// Each ring is turned by its own amount, so the cells of neighbouring rings don't line up.
const twistOf = (ring) => mulberry32(seedOf(UNIVERSE_SEED, ring, -1))() * TAU;

// Whether a cell starts with a rival is decided on its own stream, so rivals can be counted without planning cells.
const hasRival = (ring, sector) => mulberry32(seedOf(UNIVERSE_SEED, ring, sector, 1))() < rivalChance;

// How many cells before ring `ring` start with a rival, so each rival can take the next name.
const rivalsBefore = [0];
function rivalIndex(ring, sector) {
  for (let r = rivalsBefore.length; r <= ring - firstRing; r++) {
    let count = rivalsBefore[r - 1];
    for (let s = 0; s < sectors; s++) if (hasRival(firstRing + r - 1, s)) count++;
    rivalsBefore.push(count);
  }
  let index = rivalsBefore[ring - firstRing];
  for (let s = 0; s < sector; s++) if (hasRival(ring, s)) index++;
  return index;
}

const cells = new Map();

// Everything about one cell: where its structure is, how big, what shape and colors, what it's called and worth,
// and whether it has a rival or a nebula. Memoised, since it never changes.
export function cellAt(ring, sector) {
  const key = `cell:${ring}:${sector}`;
  let cell = cells.get(key);
  if (cell) return cell;

  const random = mulberry32(seedOf(UNIVERSE_SEED, ring, sector));
  const inner = ringStart(ring);
  const outer = inner * TIER_GROWTH;
  const margin = 0.08 * radiusOf(ring); // clearance from the cell's edges
  const sectorAngle = TAU / sectors;
  const start = twistOf(ring) + sector * sectorAngle; // where the sector begins, going around

  // Somewhere between the ring's edges, and anywhere around within the sector that it still fits.
  const tier = ring - random() * shrink;
  const radius = radiusOf(tier);
  const distance = inner + radius + margin + random() * (outer - inner - 2 * (radius + margin));
  const half = Math.asin(Math.min(1, (radius + margin) / distance)); // the angle it takes up either side of its centre
  const angle = start + half + random() * (sectorAngle - 2 * half);
  const x = Math.cos(angle) * distance;
  const z = Math.sin(angle) * distance;

  const bandIndex = bandOf(ring);
  const band = BANDS[bandIndex];
  const named = nameCell(bandIndex, ring, sector, x, z);
  const [insideColor, outsideColor] = PALETTES[Math.floor(random() * PALETTES.length)];
  const arrival = arrivalMass(radius);
  const galactic = band.kind === 'galaxy';
  const shape = galactic ? (named.shape ?? (random() < 0.5 ? 'spiral' : 'elliptical')) : band.kind;

  cell = {
    key,
    ring,
    sector,
    tier,
    x,
    z,
    radius,
    // The cell itself, for scattering loose stars in it.
    inner,
    outer,
    start,
    end: start + sectorAngle,
    band: bandIndex,
    shape,
    name: named.name,
    coreName: named.coreName,
    article: named.article,
    insideColor,
    outsideColor,
    branches: 2 + Math.floor(random() * 4),
    spin: (4.5 + random() * 2) / radius,
    randomness: 0.3 + random() * 0.2,
    randomnessPower: 2.6 + random() * 0.8,
    flatten: 0.55 + random() * 0.4, // ellipticals: how round they look from above
    spinRate: galactic ? 0.06 * (4 / radius) ** 0.3 : 0, // groups and bigger don't turn as one
    count: COSMOS.stars,
    coreMass: CORE_MASS * arrival,
    starsMass: STARS_MASS * arrival,
    rival: null,
    nebula: null,
    seed: seedOf(UNIVERSE_SEED, ring, sector, 2), // for building its geometry, apart from the layout
  };

  if (hasRival(ring, sector)) {
    cell.rival = { name: nameRival(rivalIndex(ring, sector), ring, sector, x, z), share: 0.5 + random() * 0.2 };
  }

  // A gas cloud beside a galaxy, where the sector has room for one.
  if (galactic && random() < 0.6) {
    const size = radius * 0.35;
    const reach = Math.asin(Math.min(1, (size + margin) / distance)); // the angle it takes up either side
    const side = angle - start > sectorAngle / 2 ? -1 : 1; // toward the roomier side
    const at = angle + side * (half + reach) * (1.15 + random() * 0.3);
    if (at - reach > start && at + reach < start + sectorAngle) {
      cell.nebula = { x: Math.cos(at) * distance, z: Math.sin(at) * distance, radius: size, mass: 0.3 * arrival, palette: random() };
    }
  }

  cells.set(key, cell);
  return cell;
}

// Every cell whose structure comes within `reach` of (x, z), skipping rings below `minTier`.
export function cellsNear(x, z, reach, minTier = -Infinity) {
  const distance = Math.hypot(x, z);
  const last = ringAt(distance + reach);
  const found = [];
  for (let ring = Math.max(firstRing, Math.floor(minTier)); ring <= last; ring++) {
    for (let sector = 0; sector < sectors; sector++) {
      const cell = cellAt(ring, sector);
      if (cell.tier >= minTier && Math.hypot(cell.x - x, cell.z - z) - cell.radius < reach) found.push(cell);
    }
  }
  return found;
}
