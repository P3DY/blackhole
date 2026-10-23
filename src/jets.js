import * as THREE from 'three';
import { JET_CAPACITY, JET_LIFE, JET_SPEED, SHADOW_SIZE } from './config.js';

// Relativistic jets: streams of particles shot out of both poles of each black hole, as strong as it's feeding.
export function createJets(material) {
  const capacity = JET_CAPACITY;
  const positions = new Float32Array(capacity * 3);
  const velocities = new Float32Array(capacity * 3);
  const scales = new Float32Array(capacity);
  const lives = new Float32Array(capacity);

  const geometry = new THREE.BufferGeometry();
  const attributes = [
    new THREE.BufferAttribute(positions, 3),
    new THREE.BufferAttribute(scales, 1),
    new THREE.BufferAttribute(lives, 1),
  ];
  geometry.setAttribute('position', attributes[0].setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aScale', attributes[1].setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aLife', attributes[2].setUsage(THREE.DynamicDrawUsage));

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  let next = 0; // ring buffer: new particles overwrite the oldest

  return {
    points,

    // Fires this frame's share of `hole`'s jets: up to 600 particles a second when feeding flat out.
    emit(hole, delta) {
      hole.jetsDue = Math.min(hole.jetsDue + hole.appetite * 600 * delta, 8);
      const shadow = hole.size;
      const origin = hole.position;
      for (; hole.jetsDue >= 1; hole.jetsDue--) {
        const i = next;
        next = (next + 1) % capacity;
        const side = i % 2 === 0 ? 1 : -1;
        const spread = 0.6 * shadow;
        positions[i * 3] = origin.x + (Math.random() - 0.5) * spread;
        positions[i * 3 + 1] = origin.y;
        positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * spread;
        velocities[i * 3] = (Math.random() - 0.5) * shadow;
        velocities[i * 3 + 1] = side * JET_SPEED * shadow * (0.7 + Math.random() * 0.6);
        velocities[i * 3 + 2] = (Math.random() - 0.5) * shadow;
        scales[i] = (shadow / SHADOW_SIZE) * (0.5 + Math.random() * 0.7);
        lives[i] = 1;
      }
    },

    update(delta) {
      let live = 0;
      for (let i = 0; i < capacity; i++) {
        if (lives[i] <= 0) continue;
        lives[i] = Math.max(0, lives[i] - delta / JET_LIFE);
        positions[i * 3] += velocities[i * 3] * delta;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;
        live++;
      }
      points.visible = live > 0;
      if (live > 0) for (const attribute of attributes) attribute.needsUpdate = true;
    },

    clear() {
      lives.fill(0);
      attributes[2].needsUpdate = true;
      points.visible = false;
    },
  };
}
