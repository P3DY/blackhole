import * as THREE from 'three';
import { arrivalMass } from './config.js';
import { buildGrid } from './grid.js';
import { TAU } from './utils.js';

const { lerp } = THREE.MathUtils;

// Turns the universe plan into star fields: one per galaxy, one per nebula, and the loose stars between.
// They all share `material`, so one shader draws every star.
export function buildFields(plan, random, material) {
  const fields = [];

  for (const galaxy of plan.galaxies) {
    const geometry = createGalaxyGeometry(galaxy, random);
    // Bigger galaxies are seen from further away, so their stars are drawn bigger to match.
    const scales = geometry.attributes.aScale.array;
    for (let i = 0; i < scales.length; i++) scales[i] *= galaxy.radius / 4;
    const masses = new Float32Array(galaxy.count).fill(galaxy.starsMass / galaxy.count);
    fields.push(createField(geometry, masses, material, galaxy));
  }

  for (const nebula of plan.nebulae) {
    const geometry = createNebulaGeometry(nebula, random);
    const masses = new Float32Array(nebula.count).fill(nebula.mass / nebula.count);
    fields.push(createField(geometry, masses, material, { x: nebula.x, z: nebula.z }));
  }

  const loose = createLooseStars(plan.galaxies, random);
  fields.push(createField(loose.geometry, loose.masses, material));

  return fields;
}

// A field is one Points object whose particles can be captured: a galaxy, a nebula or the loose stars between.
function createField(geometry, masses, material, { x = 0, z = 0, spinRate = 0 } = {}) {
  const count = geometry.attributes.position.count;
  const positions = geometry.attributes.position.array;

  const alive = new Float32Array(count).fill(1);
  const aliveAttribute = new THREE.BufferAttribute(alive, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAlive', aliveAttribute);

  const points = new THREE.Points(geometry, material);
  points.position.set(x, 0, z);

  return {
    points,
    count,
    positions,
    colors: geometry.attributes.aColor.array,
    scales: geometry.attributes.aScale.array,
    masses,
    alive,
    aliveAttribute,
    remaining: count,
    x,
    z,
    spinRate,
    angle: 0,
    grid: buildGrid(positions, count),
    dirtyMin: Infinity,
    dirtyMax: -1,
  };
}

// A spiral galaxy: stars scattered along `branches` arms that wind tighter toward the center,
// colored from insideColor at the core to outsideColor at the rim.
function createGalaxyGeometry(params, random) {
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

  return particleGeometry(positions, colors, scales, phases);
}

// Puffs of colored gas, made of big dim particles. Same attributes as a galaxy, so the same shader draws it.
function createNebulaGeometry({ radius, count, colors }, random) {
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

  return particleGeometry(positions, colorArray, scales, phases);
}

// Faint stars scattered between the galaxies, sized and weighted like the nearest one.
function createLooseStars(galaxies, random, count = 9000) {
  const margin = 20;
  const minX = Math.min(...galaxies.map((g) => g.x - g.radius)) - margin;
  const maxX = Math.max(...galaxies.map((g) => g.x + g.radius)) + margin;
  const minZ = Math.min(...galaxies.map((g) => g.z - g.radius)) - margin;
  const maxZ = Math.max(...galaxies.map((g) => g.z + g.radius)) + margin;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const masses = new Float32Array(count);
  const warm = new THREE.Color('#ffe9d0');
  const cool = new THREE.Color('#bcd0ff');
  const color = new THREE.Color();

  let n = 0;
  for (let attempt = 0; n < count && attempt < count * 6; attempt++) {
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
    if (closeness < 1.15) continue;

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
    geometry: particleGeometry(positions.slice(0, n * 3), colors.slice(0, n * 3), scales.slice(0, n), phases.slice(0, n)),
    masses: masses.slice(0, n),
  };
}

function particleGeometry(positions, colors, scales, phases) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  return geometry;
}
