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

  // A ring buffer: new particles overwrite the oldest. Every particle lives as long, so they die in the order they
  // were made, and the live ones are the `live` before `next` (wrapping around).
  let next = 0;
  let live = 0;

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
        live = Math.min(live + 1, capacity);
      }
    },

    // Moves the live particles, and uploads only their stretch of the buffers (two stretches if it wraps).
    update(delta) {
      const first = (next - live + capacity) % capacity;
      for (let n = 0; n < live; n++) {
        const i = (first + n) % capacity;
        lives[i] = Math.max(0, lives[i] - delta / JET_LIFE);
        positions[i * 3] += velocities[i * 3] * delta;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;
      }
      points.visible = live > 0;
      if (live === 0) return;
      // Uploaded with the ones that have just died, so the GPU sees them at zero life, which draws nothing.
      for (const attribute of attributes) {
        const size = attribute.itemSize;
        attribute.clearUpdateRanges();
        if (first + live <= capacity) attribute.addUpdateRange(first * size, live * size);
        else {
          attribute.addUpdateRange(first * size, (capacity - first) * size);
          attribute.addUpdateRange(0, (first + live - capacity) * size);
        }
        attribute.needsUpdate = true;
      }
      // Then the oldest that have died drop off the live stretch.
      while (live > 0 && lives[(next - live + capacity) % capacity] <= 0) live--;
    },

    clear() {
      live = 0;
      lives.fill(0);
      attributes[2].clearUpdateRanges();
      attributes[2].needsUpdate = true;
      points.visible = false;
    },
  };
}
