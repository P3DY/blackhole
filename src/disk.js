import * as THREE from 'three';
import { DISK_CAPACITY, INFLOW, INFLOW_MIN, ORBIT_SPEED, SETTLE } from './config.js';

// Captured matter around every black hole, simulated on the CPU in one pool. Each particle remembers the
// index of the black hole it orbits. Live particles are kept packed at the front of the buffers (an absorbed
// one is swapped with the last), so only that stretch is drawn and uploaded.
export function createDisk(material) {
  const capacity = DISK_CAPACITY;
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const scales = new Float32Array(capacity);
  const holeData = new Float32Array(capacity * 4); // for the shader: center and shadow radius of its black hole
  const velocities = new Float32Array(capacity * 3);
  const masses = new Float32Array(capacity);
  const owners = new Uint8Array(capacity); // so at most 256 black holes

  const geometry = new THREE.BufferGeometry();
  const attributes = [
    ['position', new THREE.BufferAttribute(positions, 3)],
    ['aColor', new THREE.BufferAttribute(colors, 3)],
    ['aScale', new THREE.BufferAttribute(scales, 1)],
    ['aHole', new THREE.BufferAttribute(holeData, 4)],
  ];
  for (const [name, attribute] of attributes) geometry.setAttribute(name, attribute.setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // the bounding sphere would go stale every frame

  const absorbed = { mass: new Float32Array(256), count: new Int32Array(256) };

  const disk = {
    points,
    count: 0,

    // (vx, vz) is the star's own velocity when captured. The difference between that and the flow is kept
    // as a drift that fades out, so captured matter eases into orbit instead of snapping.
    add(position, vx, vz, hole, sourceColors, colorOffset, scale, mass) {
      if (disk.count >= capacity) return;
      const i = disk.count++;
      const k = i * 3;
      position.toArray(positions, k);

      const center = hole.position;
      const shadow = Math.max(hole.size, 1e-4);
      const rx = position.x - center.x;
      const rz = position.z - center.z;
      const r = Math.hypot(rx, rz) || 1e-6;
      const orbit = ORBIT_SPEED * shadow * Math.sqrt(shadow / r); // ω·r
      const inflow = INFLOW * r + INFLOW_MIN * shadow;
      velocities[k] = vx - (hole.velocity.x + (rz / r) * orbit - (rx / r) * inflow);
      velocities[k + 1] = 0;
      velocities[k + 2] = vz - (hole.velocity.z - (rx / r) * orbit - (rz / r) * inflow);

      colors[k] = sourceColors[colorOffset];
      colors[k + 1] = sourceColors[colorOffset + 1];
      colors[k + 2] = sourceColors[colorOffset + 2];
      scales[i] = scale;
      masses[i] = mass;
      owners[i] = hole.index;
    },

    // Moves every particle along a spiral around its black hole (carried along as that moves) and absorbs
    // those that reach the shadow. Returns the mass and count absorbed this frame, per black hole index.
    update(delta, holes) {
      const fade = Math.exp(-SETTLE * delta);
      const flatten = Math.exp(-3 * delta);
      absorbed.mass.fill(0);
      absorbed.count.fill(0);
      let i = 0;

      while (i < disk.count) {
        const hole = holes[owners[i]];
        const center = hole.position;
        const shadow = Math.max(hole.size, 1e-4);
        const k = i * 3;

        // Relative to where the black hole was last frame.
        const rx = positions[k] - center.x + hole.velocity.x * delta;
        const rz = positions[k + 2] - center.z + hole.velocity.z * delta;
        const r = Math.hypot(rx, rz);

        if (r < shadow) {
          absorbed.mass[owners[i]] += masses[i];
          absorbed.count[owners[i]]++;
          remove(i);
          continue;
        }

        // Kepler-like orbit (faster further in) applied as an exact rotation, so tight orbits don't
        // drift outward the way stepping a velocity would, plus a steady inflow.
        const turn = ORBIT_SPEED * (shadow / r) ** 1.5 * delta;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const inward = Math.max(0, r - (INFLOW * r + INFLOW_MIN * shadow) * delta) / r;

        positions[k] = center.x + (rx * cos + rz * sin) * inward + velocities[k] * delta;
        positions[k + 1] = center.y + (positions[k + 1] - center.y) * flatten + velocities[k + 1] * delta;
        positions[k + 2] = center.z + (-rx * sin + rz * cos) * inward + velocities[k + 2] * delta;
        velocities[k] *= fade;
        velocities[k + 1] *= fade;
        velocities[k + 2] *= fade;

        holeData[i * 4] = center.x;
        holeData[i * 4 + 1] = center.y;
        holeData[i * 4 + 2] = center.z;
        holeData[i * 4 + 3] = shadow;
        i++;
      }

      geometry.setDrawRange(0, disk.count);
      if (disk.count > 0) {
        for (const [, attribute] of attributes) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, disk.count * attribute.itemSize);
          attribute.needsUpdate = true;
        }
      }
      return absorbed;
    },

    // Hands one black hole's disk to another, when the first is swallowed.
    transfer(from, to) {
      for (let i = 0; i < disk.count; i++) if (owners[i] === from) owners[i] = to;
    },

    clear() {
      disk.count = 0;
      geometry.setDrawRange(0, 0);
    },

    // A copy of every live particle, for a checkpoint. load() puts them back; the next update() uploads them.
    save() {
      const n = disk.count;
      return {
        count: n,
        positions: positions.slice(0, n * 3),
        velocities: velocities.slice(0, n * 3),
        colors: colors.slice(0, n * 3),
        scales: scales.slice(0, n),
        masses: masses.slice(0, n),
        owners: owners.slice(0, n),
      };
    },

    load(saved) {
      disk.count = saved.count;
      positions.set(saved.positions);
      velocities.set(saved.velocities);
      colors.set(saved.colors);
      scales.set(saved.scales);
      masses.set(saved.masses);
      owners.set(saved.owners);
      geometry.setDrawRange(0, 0); // until update() has placed them around their black holes
    },
  };

  function remove(i) {
    const last = --disk.count;
    if (i === last) return;
    positions.copyWithin(i * 3, last * 3, last * 3 + 3);
    velocities.copyWithin(i * 3, last * 3, last * 3 + 3);
    colors.copyWithin(i * 3, last * 3, last * 3 + 3);
    scales[i] = scales[last];
    masses[i] = masses[last];
    owners[i] = owners[last];
  }

  return disk;
}
