import * as THREE from 'three';
import { NEBULA_COLORS, arrivalMass, radiusOf, tierOf } from './config.js';
import { buildGrid } from './grid.js';
import { TAU, mulberry32 } from './utils.js';

const { lerp } = THREE.MathUtils;

// Turns the universe plan into star fields: one per galaxy, one per nebula, and the loose stars between.
// `material()` makes each one's material. They all share one shader, but each fades out on its own as you
// outgrow it.
export function buildFields(plan, random, material) {
  const fields = [];

  for (const galaxy of plan.galaxies) {
    const stars = spiralParticles(galaxy, random);
    // Bigger galaxies are seen from further away, so their stars are drawn bigger to match.
    for (let i = 0; i < stars.scales.length; i++) stars.scales[i] *= galaxy.radius / 4;
    const masses = new Float32Array(galaxy.count).fill(galaxy.starsMass / galaxy.count);
    fields.push(createField(stars, masses, material(), { ...galaxy, tier: tierOf(galaxy.radius) }));
  }

  for (const nebula of plan.nebulae) {
    const masses = new Float32Array(nebula.count).fill(nebula.mass / nebula.count);
    fields.push(createField(nebulaParticles(nebula, random), masses, material(), nebula));
  }

  // The loose stars between them fade with the biggest galaxy.
  const loose = looseStars(plan.galaxies, random);
  const tier = Math.max(...plan.galaxies.map((galaxy) => tierOf(galaxy.radius)));
  fields.push(createField(loose.particles, loose.masses, material(), { tier }));

  return fields;
}

// The structure in one cell of the endless universe (see cosmos.js), with the gas cloud beside it if it has one
// and the loose stars around it, all made from the cell's own seed, as plain arrays: [{ particles, masses, grid,
// x, z, spinRate, tier }], the structure first. It takes a frame or so, so it's done off the main thread (in
// builder.js), and fieldsOf() turns the result into fields.
export function buildCellParts(cell) {
  const random = mulberry32(cell.seed);
  const parts = [];
  const part = (particles, masses, place) => {
    parts.push({ particles, masses, grid: buildGrid(particles.positions, masses.length), tier: cell.tier, ...place });
  };

  const stars = cellParticles(cell, random);
  // Seen from further away, so drawn bigger, like the opening's galaxies, and bigger again because each has
  // fewer particles than the opening's giants (60,000).
  const scaleUp = (cell.radius / 4) * Math.sqrt(60000 / cell.count);
  for (let i = 0; i < stars.scales.length; i++) stars.scales[i] *= scaleUp;
  part(stars, new Float32Array(cell.count).fill(cell.starsMass / cell.count), { x: cell.x, z: cell.z, spinRate: cell.spinRate });

  const { nebula } = cell;
  if (nebula) {
    const colors = NEBULA_COLORS[Math.floor(nebula.palette * NEBULA_COLORS.length)];
    const cloud = nebulaParticles({ radius: nebula.radius, count: 2400, colors }, random);
    part(cloud, new Float32Array(2400).fill(nebula.mass / 2400), { x: nebula.x, z: nebula.z });
  }

  const loose = cellLooseStars(cell, random);
  part(loose.particles, loose.masses, { x: cell.x, z: cell.z });
  return parts;
}

// Every array in the parts of a cell, so they can be handed between threads rather than copied.
export function buffersOf(parts) {
  return parts.flatMap(({ particles, masses, grid }) => [
    ...Object.values(particles).map((array) => array.buffer),
    masses.buffer,
    grid.start.buffer,
    grid.items.buffer,
  ]);
}

// Fields from a cell's parts (see buildCellParts), each with a material from `material()`.
export function fieldsOf(parts, material) {
  return parts.map(({ particles, masses, grid, ...place }) => createField(particles, masses, material(), place, grid));
}

// A field is one Points object whose particles can be captured: a galaxy, a nebula or the loose stars between.
// `tier` is how big it is, for fading it out once you've outgrown it.
function createField(particles, masses, material, { x = 0, z = 0, spinRate = 0, tier = 0 } = {}, grid = null) {
  const { positions, colors, scales, phases } = particles;
  const count = masses.length;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const alive = new Float32Array(count).fill(1);
  const aliveAttribute = new THREE.BufferAttribute(alive, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAlive', aliveAttribute);

  const points = new THREE.Points(geometry, material);
  points.position.set(x, 0, z);

  return {
    points,
    count,
    positions,
    colors,
    scales,
    masses,
    alive,
    aliveAttribute,
    remaining: count,
    x,
    z,
    spinRate,
    angle: 0,
    tier,
    fade: 1,
    grid: grid ?? buildGrid(positions, count),
    dirtyMin: Infinity,
    dirtyMax: -1,
  };
}

// A spiral galaxy: stars scattered along `branches` arms that wind tighter toward the center,
// colored from insideColor at the core to outsideColor at the rim.
function spiralParticles(params, random) {
  const { count, radius, branches, spin, randomness, randomnessPower } = params;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);

  const inside = new THREE.Color(params.insideColor);
  const outside = new THREE.Color(params.outsideColor);
  const color = new THREE.Color();

  // Random offset biased toward 0, so most stars hug their spiral arm.
  const scatter = (r) => Math.pow(random(), randomnessPower) * (random() < 0.5 ? 1 : -1) * randomness * r;

  for (let i = 0; i < count; i++) {
    const r = random() * radius;
    const angle = ((i % branches) / branches) * TAU + r * spin;

    positions[i * 3] = Math.cos(angle) * r + scatter(r);
    positions[i * 3 + 1] = scatter(r) * 0.5;
    positions[i * 3 + 2] = Math.sin(angle) * r + scatter(r);

    color.copy(inside).lerp(outside, r / radius).toArray(colors, i * 3);
    scales[i] = 0.3 + random() * 1.2;
    phases[i] = random() * TAU;
  }

  return particles(positions, colors, scales, phases);
}

const gaussian = (random) => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());

function cellParticles(cell, random) {
  if (cell.shape === 'spiral') return spiralParticles(cell, random);
  if (cell.shape === 'elliptical') return ellipticalParticles(cell, random);
  return clumpParticles(cell.count, LAYOUTS[cell.shape](cell.radius, cell, random), random);
}

const WARM = new THREE.Color('#ffc890');

// A giant elliptical: a smooth, thick swarm of old stars, densest in the middle. `flatten` squashes it along z.
function ellipticalParticles({ count, radius, insideColor, outsideColor, flatten }, random) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const inside = new THREE.Color(insideColor).lerp(WARM, 0.5);
  const outside = new THREE.Color(outsideColor).lerp(WARM, 0.7);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = radius * Math.pow(random(), 1.8);
    const angle = random() * TAU;
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = gaussian(random) * r * 0.25;
    positions[i * 3 + 2] = Math.sin(angle) * r * flatten;
    color.copy(inside).lerp(outside, r / radius).toArray(colors, i * 3);
    scales[i] = 0.3 + random() * 1.2;
    phases[i] = random() * TAU;
  }

  return particles(positions, colors, scales, phases);
}

// Colors for the parts of the biggest structures, inner to outer: old red galaxies, young blue ones, the faint
// threads between and hot gas (drawn the purple of X-ray images).
const OLD = ['#ffe2b0', '#ff9a5a'];
const YOUNG = ['#e8eeff', '#7aa2ff'];
const THREAD = ['#d8dcff', '#8fa8ff'];
const GAS = ['#b48cff', '#4fd2ff'];

// Many small swarms (at these scales, each one a galaxy or a cluster of them), the threads between them and a
// faint haze, as one field of `count` particles. Each part takes a share of them by its `weight`:
//   { kind: 'puff', x, z, radius, colors }      a round swarm
//   { kind: 'spiral', x, z, radius, turn, colors } a small two-armed spiral
//   { kind: 'thread', from, to, width, colors } strung along the line between two [x, z] points
//   { kind: 'haze', x, z, radius, colors }      big, dim particles
function clumpParticles(count, parts, random) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const color = new THREE.Color();
  const total = parts.reduce((sum, part) => sum + part.weight, 0);

  // The first part takes whatever rounding leaves over.
  const shares = parts.map((part) => Math.floor((count * part.weight) / total));
  shares[0] += count - shares.reduce((sum, n) => sum + n, 0);

  let i = 0;
  parts.forEach((part, p) => {
    const inner = new THREE.Color(part.colors[0]);
    const outer = new THREE.Color(part.colors[1]);
    for (let n = 0; n < shares[p]; n++, i++) {
      let x;
      let y;
      let z;
      let mix;
      let scale = 0.3 + random() * 1.2;
      let dim = 1;
      if (part.kind === 'puff') {
        x = part.x + gaussian(random) * part.radius * 0.45;
        z = part.z + gaussian(random) * part.radius * 0.45;
        y = gaussian(random) * part.radius * 0.15;
        mix = Math.min(Math.hypot(x - part.x, z - part.z) / part.radius, 1);
      } else if (part.kind === 'spiral') {
        const r = random() * part.radius;
        const angle = (n % 2) * Math.PI + (r / part.radius) * 5 + part.turn;
        const scatter = () => Math.pow(random(), 2.8) * (random() < 0.5 ? 1 : -1) * 0.4 * r;
        x = part.x + Math.cos(angle) * r + scatter();
        z = part.z + Math.sin(angle) * r + scatter();
        y = scatter() * 0.3;
        mix = r / part.radius;
      } else if (part.kind === 'thread') {
        const t = random();
        const [ax, az] = part.from;
        const [bx, bz] = part.to;
        const length = Math.hypot(bx - ax, bz - az) || 1;
        const off = gaussian(random) * part.width;
        x = ax + (bx - ax) * t - ((bz - az) / length) * off;
        z = az + (bz - az) * t + ((bx - ax) / length) * off;
        y = gaussian(random) * part.width * 0.3;
        mix = random();
        dim = 0.6;
      } else {
        x = part.x + gaussian(random) * part.radius * 0.4;
        z = part.z + gaussian(random) * part.radius * 0.4;
        y = gaussian(random) * part.radius * 0.08;
        mix = random();
        dim = 0.22;
        scale *= 2.5;
      }
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      color.copy(inner).lerp(outer, mix).multiplyScalar(dim).toArray(colors, i * 3);
      scales[i] = scale;
      phases[i] = random() * TAU;
    }
  });

  return particles(positions, colors, scales, phases);
}

// `count` swarms, each `size()` across, at spots from `place()` (an [x, z]), kept clear of each other where they can be.
function scatterParts(count, place, size, random) {
  const parts = [];
  for (let k = 0; k < count; k++) {
    let x = 0;
    let z = 0;
    const radius = size();
    for (let attempt = 0; attempt < 20; attempt++) {
      [x, z] = place();
      if (parts.every((part) => Math.hypot(part.x - x, part.z - z) > (part.radius + radius) * 0.9)) break;
    }
    parts.push({ x, z, radius, turn: random() * TAU });
  }
  return parts;
}

// A random spot within `radius` of (x, z), crowding toward the middle more the higher `bias` is (1 is even).
function spotWithin(x, z, radius, bias, random) {
  const r = radius * Math.pow(random(), bias / 2);
  const angle = random() * TAU;
  return [x + Math.cos(angle) * r, z + Math.sin(angle) * r];
}

// A swarm's share of the particles: by its area, so a big one is as dense as a small one.
const areaWeight = (part) => Math.PI * part.radius ** 2;

// A knot of galaxies around a big central one, `radius` across, in a little hot gas.
function knot(x, z, radius, members, random) {
  const parts = [{ kind: 'puff', x, z, radius: radius * 0.35, colors: OLD }];
  const around = scatterParts(
    members,
    () => spotWithin(x, z, radius, 2.6, random),
    () => radius * (0.08 + random() * 0.1),
    random,
  );
  for (const part of around) parts.push({ kind: 'puff', ...part, colors: random() < 0.7 ? OLD : YOUNG });
  parts.push({ kind: 'haze', x, z, radius: radius * 1.2, colors: GAS });
  return parts.map((part) => ({ ...part, weight: areaWeight(part) * (part.kind === 'haze' ? 0.05 : 1) }));
}

function thread(a, b, width) {
  const weight = Math.hypot(b.x - a.x, b.z - a.z) * width * 1.5;
  return { kind: 'thread', from: [a.x, a.z], to: [b.x, b.z], width, colors: THREAD, weight };
}

// How each band's structures are laid out within `radius` of their centre, as parts for clumpParticles().
const LAYOUTS = {
  // A handful of galaxies, mostly spirals in the cell's own colors, with a little gas between them.
  group(radius, cell, random) {
    const members = scatterParts(
      3 + Math.floor(random() * 5),
      () => spotWithin(0, 0, radius * 0.62, 1, random),
      () => radius * (0.14 + random() * 0.16),
      random,
    );
    const parts = members.map((part) => {
      const spiral = random() < 0.6;
      const colors = spiral ? [cell.insideColor, cell.outsideColor] : OLD;
      return { ...part, kind: spiral ? 'spiral' : 'puff', colors, weight: areaWeight(part) };
    });
    parts.push({ kind: 'haze', x: 0, z: 0, radius: radius * 0.8, colors: GAS, weight: areaWeight({ radius }) * 0.02 });
    return parts;
  },

  // Dozens of galaxies crowding toward a giant at the centre, in a haze of hot gas.
  cluster(radius, cell, random) {
    const parts = [{ kind: 'puff', x: 0, z: 0, radius: radius * 0.1, colors: OLD, weight: areaWeight({ radius: radius * 0.1 }) }];
    const members = scatterParts(
      45 + Math.floor(random() * 30),
      () => spotWithin(0, 0, radius * 0.85, 3, random),
      () => radius * (0.02 + random() * 0.035),
      random,
    );
    for (const part of members) {
      const spiral = random() < 0.25;
      parts.push({ ...part, kind: spiral ? 'spiral' : 'puff', colors: spiral ? YOUNG : OLD, weight: areaWeight(part) });
    }
    parts.push({ kind: 'haze', x: 0, z: 0, radius: radius * 0.9, colors: GAS, weight: areaWeight({ radius }) * 0.03 });
    return parts;
  },

  // Knots of galaxies strung together by threads into a web.
  supercluster(radius, cell, random) {
    const nodes = scatterParts(
      4 + Math.floor(random() * 4),
      () => spotWithin(0, 0, radius * 0.78, 1, random),
      () => radius * (0.12 + random() * 0.08),
      random,
    );
    // Each node joins the nearest one before it, plus one more link across.
    const threads = nodes.slice(1).map((node, k) => {
      const before = nodes.slice(0, k + 1);
      const nearest = before.reduce((a, b) => (Math.hypot(b.x - node.x, b.z - node.z) < Math.hypot(a.x - node.x, a.z - node.z) ? b : a));
      return thread(nearest, node, radius * 0.02);
    });
    const a = nodes[Math.floor(random() * nodes.length)];
    const b = nodes[Math.floor(random() * nodes.length)];
    if (a !== b) threads.push(thread(a, b, radius * 0.02));
    const knots = nodes.flatMap((node) => knot(node.x, node.z, node.radius, 8 + Math.floor(random() * 7), random));
    return [...knots, ...threads];
  },

  // A long, wavering wall of knots and the threads between them, with a few spurs off to the sides.
  wall(radius, cell, random) {
    const turn = random() * TAU;
    const phase = random() * TAU;
    const waves = 1 + random() * 1.5;
    const count = 7 + Math.floor(random() * 3);
    const nodes = Array.from({ length: count }, (_, k) => {
      const along = (k / (count - 1) - 0.5) * 1.8 * radius;
      const across = Math.sin((along / radius) * Math.PI * waves + phase) * 0.2 * radius + gaussian(random) * 0.04 * radius;
      return {
        x: Math.cos(turn) * along - Math.sin(turn) * across,
        z: Math.sin(turn) * along + Math.cos(turn) * across,
        radius: radius * (0.06 + random() * 0.05),
      };
    });
    const threads = nodes.slice(1).map((node, k) => thread(nodes[k], node, radius * 0.025));
    for (let k = 0; k < 3; k++) {
      const from = nodes[Math.floor(random() * count)];
      const angle = random() * TAU;
      const length = radius * (0.2 + random() * 0.15);
      threads.push(thread(from, { x: from.x + Math.cos(angle) * length, z: from.z + Math.sin(angle) * length }, radius * 0.02));
    }
    const knots = nodes.flatMap((node) => knot(node.x, node.z, node.radius, 5 + Math.floor(random() * 5), random));
    return [...knots, ...threads];
  },
};

// Faint stars (or, at bigger scales, faint galaxies) scattered through a cell around its structure: as many for
// the size of the cell as the opening has beside its biggest galaxies, and weighted the same way.
function cellLooseStars(cell, random) {
  const { inner, outer, start, end, radius, nebula } = cell;
  const unit = radiusOf(cell.ring);
  const area = ((outer ** 2 - inner ** 2) * (end - start)) / 2;
  const count = Math.round((area / unit ** 2) * LOOSE_DENSITY * LOOSE_CROWD ** 2);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const masses = new Float32Array(count);
  const warm = new THREE.Color('#ffe9d0');
  const cool = new THREE.Color('#bcd0ff');
  const color = new THREE.Color();
  const scaleUp = radius / 4;
  const mass = 0.0008 * arrivalMass(radius);

  let n = 0;
  for (let attempt = 0; attempt < count; attempt++) {
    const r = Math.sqrt(lerp(inner ** 2, outer ** 2, random()));
    const angle = lerp(start, end, random());
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (Math.hypot(x - cell.x, z - cell.z) < radius * 1.15) continue;
    if (nebula && Math.hypot(x - nebula.x, z - nebula.z) < nebula.radius * 1.1) continue;

    // Stored around the structure's centre, so the numbers stay small however far out the cell is.
    positions[n * 3] = x - cell.x;
    positions[n * 3 + 1] = (random() - 0.5) * 0.4 * scaleUp;
    positions[n * 3 + 2] = z - cell.z;
    color.copy(warm).lerp(cool, random()).multiplyScalar(0.4 + random() * 0.5).toArray(colors, n * 3);
    scales[n] = (0.3 + random() * 0.9) * scaleUp * 0.8;
    phases[n] = random() * TAU;
    masses[n] = mass;
    n++;
  }

  return {
    particles: particles(positions.slice(0, n * 3), colors.slice(0, n * 3), scales.slice(0, n), phases.slice(0, n)),
    masses: masses.slice(0, n),
  };
}

// Puffs of colored gas, made of big dim particles. Same attributes as a galaxy, so the same shader draws it.
function nebulaParticles({ radius, count, colors }, random) {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
  const puffs = Array.from({ length: 3 + Math.floor(random() * 3) }, () => ({
    x: gauss() * radius * 0.3,
    z: gauss() * radius * 0.3,
    size: radius * (0.25 + random() * 0.25),
  }));

  const positions = new Float32Array(count * 3);
  const colorArray = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const a = new THREE.Color(colors[0]);
  const b = new THREE.Color(colors[1]);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const puff = puffs[i % puffs.length];
    positions[i * 3] = puff.x + gauss() * puff.size * 0.5;
    positions[i * 3 + 1] = gauss() * radius * 0.04;
    positions[i * 3 + 2] = puff.z + gauss() * puff.size * 0.5;
    color.copy(a).lerp(b, random()).multiplyScalar(0.2 + random() * 0.25).toArray(colorArray, i * 3);
    scales[i] = (1 + random() * 2) * (radius / 1.6);
    phases[i] = random() * TAU;
  }

  return particles(positions, colorArray, scales, phases);
}

// Faint stars scattered between the galaxies, sized and weighted like the nearest one: `density` of them per
// square unit, thinned out beside galaxies wider than `crowd`. You see those from further away, so a view there
// holds no more loose stars than one beside a galaxy `crowd` wide (about Andromeda's size).
const LOOSE_DENSITY = 0.2;
const LOOSE_CROWD = 42;

function looseStars(galaxies, random, density = LOOSE_DENSITY, crowd = LOOSE_CROWD) {
  const margin = 20;
  const minX = Math.min(...galaxies.map((g) => g.x - g.radius)) - margin;
  const maxX = Math.max(...galaxies.map((g) => g.x + g.radius)) + margin;
  const minZ = Math.min(...galaxies.map((g) => g.z - g.radius)) - margin;
  const maxZ = Math.max(...galaxies.map((g) => g.z + g.radius)) + margin;
  const count = Math.round((maxX - minX) * (maxZ - minZ) * density); // tries; most land clear of the galaxies

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const masses = new Float32Array(count);
  const warm = new THREE.Color('#ffe9d0');
  const cool = new THREE.Color('#bcd0ff');
  const color = new THREE.Color();

  let n = 0;
  for (let attempt = 0; attempt < count; attempt++) {
    const x = lerp(minX, maxX, random());
    const z = lerp(minZ, maxZ, random());

    let nearest = galaxies[0];
    let closeness = Infinity; // distance in units of that galaxy's radius
    for (const galaxy of galaxies) {
      const d = Math.hypot(galaxy.x - x, galaxy.z - z) / galaxy.radius;
      if (d < closeness) {
        closeness = d;
        nearest = galaxy;
      }
    }
    if (closeness < 1.15 || random() >= (crowd / nearest.radius) ** 2) continue;

    const scaleUp = nearest.radius / 4;
    positions[n * 3] = x;
    positions[n * 3 + 1] = (random() - 0.5) * 0.4 * scaleUp;
    positions[n * 3 + 2] = z;
    color.copy(warm).lerp(cool, random()).multiplyScalar(0.4 + random() * 0.5).toArray(colors, n * 3);
    scales[n] = (0.3 + random() * 0.9) * scaleUp * 0.8;
    phases[n] = random() * TAU;
    masses[n] = 0.0008 * arrivalMass(nearest.radius);
    n++;
  }

  return {
    particles: particles(positions.slice(0, n * 3), colors.slice(0, n * 3), scales.slice(0, n), phases.slice(0, n)),
    masses: masses.slice(0, n),
  };
}

// The arrays every kind of field is drawn from. createField() turns them into geometry.
const particles = (positions, colors, scales, phases) => ({ positions, colors, scales, phases });
