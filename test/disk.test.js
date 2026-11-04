import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDisk } from '../src/disk.js';
import { MAX_HOLES } from '../src/config.js';

const hole = (index, x) => ({ index, position: new THREE.Vector3(x, 0, 0), velocity: new THREE.Vector3(), size: 0.1 });

describe('disk', () => {
  it('moves particles to their black holes’ new slots on load, and drops those whose holes are gone', () => {
    const disk = createDisk(new THREE.PointsMaterial());
    const a = hole(0, 0);
    const b = hole(1, 100);
    const c = hole(2, -100);
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const spot = new THREE.Vector3();
    for (let i = 0; i < 3; i++) disk.add(spot.set(1, 0, 0), 0, 0, a, colors, 0, 1, 1);
    for (let i = 0; i < 2; i++) disk.add(spot.set(101, 0, 0), 0, 0, b, colors, 3, 1, 2);
    for (let i = 0; i < 4; i++) disk.add(spot.set(-99, 0, 0), 0, 0, c, colors, 6, 1, 4);
    const saved = disk.save();
    expect(saved.count).toBe(9);

    // a comes back in slot 5, b is gone, c comes back in slot 0.
    const remap = new Int16Array(MAX_HOLES).fill(-1);
    remap[0] = 5;
    remap[2] = 0;
    disk.clear();
    disk.load(saved, remap);
    expect(disk.count).toBe(7);

    // Absorb everything (shadows bigger than every orbit) and count what each new slot got.
    const slots = [];
    slots[5] = { ...a, size: 1000 };
    slots[0] = { ...c, size: 1000 };
    const absorbed = disk.update(0.016, slots);
    expect(absorbed.count[5]).toBe(3);
    expect(absorbed.count[0]).toBe(4);
    expect(absorbed.mass[5]).toBeCloseTo(3);
    expect(absorbed.mass[0]).toBeCloseTo(16);
    expect(disk.count).toBe(0);
  });

  it('releases one black hole’s particles and keeps the rest packed', () => {
    const disk = createDisk(new THREE.PointsMaterial());
    const a = hole(3, 0);
    const b = hole(4, 50);
    const colors = new Float32Array(3);
    const spot = new THREE.Vector3();
    for (let i = 0; i < 10; i++) disk.add(spot.set(i % 2 ? 51 : 1, 0, 0), 0, 0, i % 2 ? b : a, colors, 0, 1, 1);
    disk.release(3);
    expect(disk.count).toBe(5);
    const slots = [];
    slots[4] = { ...b, size: 1000 };
    expect(disk.update(0.016, slots).count[4]).toBe(5);
  });
});
