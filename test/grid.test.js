import { describe, expect, it } from 'vitest';
import { buildGrid, queryGrid } from '../src/grid.js';
import { mulberry32 } from '../src/utils.js';

function makeField(count, seed) {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 10 * Math.sqrt(random());
    const a = random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = random() - 0.5;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const alive = new Uint8Array(count).fill(1);
  for (let i = 0; i < count; i += 7) alive[i] = 0; // some already eaten
  return { positions, alive, grid: buildGrid(positions, count) };
}

function bruteForce(field, hx, hz, radius) {
  const found = [];
  for (let i = 0; i < field.alive.length; i++) {
    if (field.alive[i] === 0) continue;
    const dx = field.positions[i * 3] - hx;
    const dz = field.positions[i * 3 + 2] - hz;
    if (dx * dx + dz * dz < radius * radius) found.push(i);
  }
  return found.sort((a, b) => a - b);
}

function query(field, hx, hz, radius) {
  const found = [];
  queryGrid(field, hx, hz, radius, (i) => {
    found.push(i);
  });
  return found.sort((a, b) => a - b);
}

describe('queryGrid', () => {
  const field = makeField(5000, 42);

  it.each([
    [0, 0, 1],
    [3, -2, 2.5],
    [9, 9, 4],
    [0, 0, 30], // the whole field
    [25, 0, 16], // far off one side, reaching in
    [-40, 30, 45],
    [0, -14, 5],
    [100, 100, 3], // nowhere near
  ])('finds the same stars as a brute-force search around (%f, %f) within %f', (hx, hz, radius) => {
    expect(query(field, hx, hz, radius)).toEqual(bruteForce(field, hx, hz, radius));
  });

  it('works outward and stops when asked', () => {
    const found = [];
    queryGrid(field, 0, 0, 30, (i) => {
      found.push(i);
      return found.length < 10;
    });
    expect(found).toHaveLength(10);
    // Working outward from the centre cell, the first few are all close by, though not in order of distance.
    const { cellSize } = field.grid;
    for (const i of found) expect(Math.hypot(field.positions[i * 3], field.positions[i * 3 + 2])).toBeLessThan(3 * cellSize);
  });
});
