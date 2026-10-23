import * as THREE from 'three';

export const TAU = Math.PI * 2;

// Free GPU memory held by everything under `root` (geometries, materials, textures).
export function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose();

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}

// Seeded random number generator: returns a function giving the same sequence in [0, 1) for a given seed.
export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mixes integers into one 32-bit seed, so every part of the universe can have a random stream of its own.
export function seedOf(...parts) {
  let h = 0x9e3779b9;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

// A sphere of distant white points to use as a backdrop.
export function createStarfield(count = 2500, radius = 200) {
  const positions = new Float32Array(count * 3);
  const point = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    point.randomDirection().multiplyScalar(radius * (0.5 + Math.random() * 0.5));
    point.toArray(positions, i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true }),
  );
}
