// Real names for the endless universe past the opening (cosmos.js), one list per scale, plus catalogue-style
// designations for when a list runs out.
//
// An entry's `core` is the proper name of the black hole at its heart, where it has one (M87*, the Great Attractor);
// otherwise its core is "the <name> core". `article` says the core's name reads "the …" in a sentence. A galaxy's
// `shape` is 'spiral' or 'elliptical'.

import { BANDS, COSMOS, UNIVERSE_SEED } from './config.js';
import { TAU, mulberry32, seedOf } from './utils.js';

// Galaxies not already in the opening, and not the brightest galaxy of a cluster below (those are cluster cores).
const GALAXIES = [
  { name: 'NGC 1600', shape: 'elliptical' },
  { name: 'Cygnus A', shape: 'elliptical' },
  { name: 'Hercules A', shape: 'elliptical' },
  { name: "Rubin's Galaxy", shape: 'spiral' },
  { name: 'Fornax A', shape: 'elliptical' },
  { name: 'M49', shape: 'elliptical' },
  { name: 'M60', shape: 'elliptical' },
  { name: 'M84', shape: 'elliptical' },
  { name: 'M86', shape: 'elliptical' },
  { name: 'M89', shape: 'elliptical' },
  { name: 'Arp 220', shape: 'spiral' },
  { name: 'NGC 262', shape: 'spiral' },
  { name: 'NGC 4874', shape: 'elliptical' },
  { name: 'NGC 1132', shape: 'elliptical' },
  { name: 'ESO 383-76', shape: 'elliptical' },
  { name: 'Malin 2', shape: 'spiral' },
  { name: 'NGC 4261', shape: 'elliptical' },
  { name: 'M106', shape: 'spiral' },
  { name: 'NGC 1365', shape: 'spiral' },
  { name: 'NGC 7331', shape: 'spiral' },
  { name: "Hoag's Object", shape: 'spiral' },
  { name: 'NGC 1300', shape: 'spiral' },
  { name: 'Needle Galaxy', shape: 'spiral' },
  { name: 'NGC 2841', shape: 'spiral' },
  { name: '3C 75', shape: 'elliptical' },
  { name: 'UGC 12591', shape: 'spiral' },
  { name: 'Cetus A', shape: 'spiral' },
  { name: 'Southern Pinwheel', shape: 'spiral' },
  { name: 'NGC 1097', shape: 'spiral' },
  { name: 'NGC 6744', shape: 'spiral' },
  { name: "Bode's Galaxy", shape: 'spiral' },
  { name: 'Cigar Galaxy', shape: 'spiral' },
  { name: 'Sculptor Galaxy', shape: 'spiral' },
  { name: 'M59', shape: 'elliptical' },
  { name: 'NGC 4697', shape: 'elliptical' },
];

const GROUPS = [
  { name: 'M81 Group' },
  { name: 'Sculptor Group' },
  { name: 'Leo Triplet' },
  { name: "Stephan's Quintet" },
  { name: "Seyfert's Sextet" },
  { name: "Robert's Quartet" },
  { name: "Wild's Triplet" },
  { name: 'Copeland Septet' },
  { name: 'Canes Venatici I Group' },
  { name: 'M101 Group' },
  { name: 'Maffei Group' },
  { name: 'NGC 5866 Group' },
  { name: 'Centaurus A/M83 Group' },
  { name: "Zwicky's Triplet" },
  { name: 'Leo I Group' },
];

// Each cluster's core is the black hole of its brightest galaxy, where that has a name.
const CLUSTERS = [
  { name: 'Virgo Cluster', core: 'M87*' },
  { name: 'Coma Cluster', core: 'NGC 4889*' },
  { name: 'Perseus Cluster', core: 'NGC 1275*' },
  { name: 'Phoenix Cluster', core: 'Phoenix A*' },
  { name: 'Abell 85', core: 'Holm 15A*' },
  { name: 'Fornax Cluster', core: 'NGC 1399*' },
  { name: 'Centaurus Cluster', core: 'NGC 4696*' },
  { name: 'Hydra Cluster', core: 'NGC 3311*' },
  { name: 'Leo Cluster', core: 'NGC 3842*' },
  { name: 'Abell 2199', core: 'NGC 6166*' },
  { name: 'Norma Cluster' },
  { name: 'Hercules Cluster' },
  { name: 'Ophiuchus Cluster' },
  { name: 'Bullet Cluster' },
  { name: 'El Gordo' },
  { name: "Pandora's Cluster" },
  { name: 'Abell 1689' },
  { name: 'Abell 2218' },
  { name: 'Abell 370' },
  { name: 'Train Wreck Cluster' },
  { name: 'Musket Ball Cluster' },
  { name: 'Antlia Cluster' },
  { name: 'MS 0735.6+7421' },
];

const SUPERCLUSTERS = [
  { name: 'Laniakea Supercluster', core: 'Great Attractor', article: true },
  { name: 'Shapley Supercluster' },
  { name: 'Perseus–Pisces Supercluster' },
  { name: 'Hercules Supercluster' },
  { name: 'Coma Supercluster' },
  { name: 'Leo Supercluster' },
  { name: 'Hydra–Centaurus Supercluster' },
  { name: 'Pavo–Indus Supercluster' },
  { name: 'Horologium–Reticulum Supercluster' },
  { name: 'Pisces–Cetus Supercluster' },
  { name: 'Saraswati Supercluster' },
  { name: 'Corona Borealis Supercluster' },
  { name: 'Boötes Supercluster' },
  { name: 'Sculptor Supercluster' },
  { name: 'Ursa Major Supercluster' },
  { name: 'Microscopium Supercluster' },
  { name: 'Caelum Supercluster' },
  { name: 'Aquarius Supercluster' },
  { name: 'Virgo Supercluster' },
  { name: 'Lynx Supercluster' },
  { name: 'Hyperion Proto-supercluster' },
];

const WALLS = [
  { name: 'Sloan Great Wall' },
  { name: 'CfA2 Great Wall' },
  { name: 'BOSS Great Wall' },
  { name: 'South Pole Wall' },
  { name: 'Hercules–Corona Borealis Great Wall' },
  { name: 'Giant Arc' },
  { name: 'Big Ring' },
  { name: 'Huge-LQG' },
  { name: 'Clowes–Campusano LQG' },
  { name: 'U1.11 LQG' },
  { name: 'Pisces–Cetus Supercluster Complex' },
  { name: 'Quipu' },
  { name: 'Sculptor Wall' },
];

// Rivals past the opening are named for real quasars: black holes feeding hard enough to outshine their galaxies.
const QUASARS = [
  'TON 618',
  '3C 273',
  '3C 48',
  'OJ 287',
  'S5 0014+81',
  'APM 08279+5255',
  'Markarian 231',
  'H1821+643',
  'SDSS J0100+2802',
  'ULAS J1342+0928',
  'J0529−4351',
  'PKS 2000−330',
  '3C 279',
  '3C 454.3',
  'BL Lacertae',
  'Twin Quasar',
  'Cloverleaf Quasar',
  'Einstein Cross',
  'PDS 456',
  'PKS 1127−145',
  'RX J1131−1231',
];

// Each band's list and the catalogue its designations borrow the style of, by band kind.
const POOLS = {
  galaxy: { entries: GALAXIES, catalogue: (ra, dec) => `SDSS J${hms(ra, 2)}${dms(dec, 1)}` },
  group: { entries: GROUPS, catalogue: (ra, dec) => `MCXC J${hm(ra)}${dm(dec)}` },
  cluster: { entries: CLUSTERS, catalogue: (ra, dec) => `MCXC J${hm(ra)}${dm(dec)}` },
  supercluster: { entries: SUPERCLUSTERS, catalogue: (ra, dec) => `SCl J${hm(ra, 0)}${d(dec)}` },
  wall: { entries: WALLS, catalogue: (ra, dec) => `LSS J${hm(ra, 0)}${d(dec)}` },
};

// The name of the structure in a cell, and of its core: { name, coreName, article, shape }. Within a band, cells
// take the list's names in a seeded shuffle, so real names turn up all through it; the rest get designations.
// The last band ("beyond the observable universe") only ever has designations.
export function nameCell(bandIndex, ring, sector, x, z) {
  const band = BANDS[bandIndex];
  const next = BANDS[bandIndex + 1];
  const pool = POOLS[band.kind];
  const slot = next ? shuffled(bandIndex, (next.from - band.from) * COSMOS.sectors)[(ring - band.from) * COSMOS.sectors + sector] : Infinity;
  const entry = pool.entries[slot] ?? { name: pool.catalogue(...skyOf(ring, sector, x, z)) };
  return {
    name: entry.name,
    coreName: entry.core ?? `${entry.name} core`,
    article: entry.core ? Boolean(entry.article) : true,
    shape: entry.shape,
  };
}

// The `index`th rival past the opening, counting cells in ring order.
export function nameRival(index, ring, sector, x, z) {
  if (index < QUASARS.length) return QUASARS[index];
  const [ra, dec] = skyOf(ring, sector, x, z);
  return `QSO J${hm(ra, 0)}${dm(dec)}`;
}

const orders = new Map();

// A seeded shuffle of 0 … count − 1, the same every time for a band.
function shuffled(bandIndex, count) {
  let order = orders.get(bandIndex);
  if (order) return order;
  const random = mulberry32(seedOf(UNIVERSE_SEED, bandIndex, 7));
  order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  orders.set(bandIndex, order);
  return order;
}

// Where a cell would sit on the sky, as [right ascension in hours, declination in degrees]: right ascension from its
// direction around the centre, declination from its own seed (spread evenly over the sphere).
function skyOf(ring, sector, x, z) {
  const ra = (((Math.atan2(z, x) % TAU) + TAU) % TAU) * (24 / TAU);
  const u = mulberry32(seedOf(UNIVERSE_SEED, ring, sector, 3))();
  const dec = (Math.asin(2 * u - 1) * 180) / Math.PI;
  return [ra, dec];
}

const pad = (value, width) => String(value).padStart(width, '0');

// A number to `decimals` places, rounded down so 59.996 doesn't become "60.00".
const floorTo = (value, decimals) => (Math.floor(value * 10 ** decimals) / 10 ** decimals).toFixed(decimals);

// Splits a value into whole units, minutes and seconds (and the minutes with their fraction).
function sexagesimal(value, decimals) {
  const unit = Math.floor(value);
  const minutes = (value - unit) * 60;
  const minute = Math.floor(minutes);
  const seconds = floorTo((minutes - minute) * 60, decimals);
  return [unit, minute, seconds, minutes];
}

// 12h 34m 56.78s → "123456.78"
function hms(ra, decimals) {
  const [h, m, s] = sexagesimal(ra, decimals);
  return `${pad(h, 2)}${pad(m, 2)}${pad(s, 3 + decimals)}`;
}

// 12h 34.5m → "1234.5" (or "1234" with no decimals)
function hm(ra, decimals = 1) {
  const [h, , , minutes] = sexagesimal(ra, 0);
  return `${pad(h, 2)}${pad(floorTo(minutes, decimals), decimals ? 3 + decimals : 2)}`;
}

const sign = (dec) => (dec < 0 ? '−' : '+');

// −12° 34′ 56.7″ → "−123456.7"
function dms(dec, decimals) {
  const [deg, m, s] = sexagesimal(Math.abs(dec), decimals);
  return `${sign(dec)}${pad(deg, 2)}${pad(m, 2)}${pad(s, 3 + decimals)}`;
}

// −12° 34′ → "−1234"
function dm(dec) {
  const [deg, m] = sexagesimal(Math.abs(dec), 0);
  return `${sign(dec)}${pad(deg, 2)}${pad(m, 2)}`;
}

// −12° → "−12"
const d = (dec) => `${sign(dec)}${pad(Math.floor(Math.abs(dec)), 2)}`;
