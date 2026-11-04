import { describe, expect, it, vi } from 'vitest';
import { COSMOS } from '../src/config.js';

const RINGS = 12; // rings checked past the first

describe('cosmos', () => {
  it('lays out the same cells every time', async () => {
    const first = await import('../src/cosmos.js');
    const a = first.cellAt(COSMOS.firstRing + 3, 2);
    vi.resetModules(); // a fresh memo
    const second = await import('../src/cosmos.js');
    const b = second.cellAt(COSMOS.firstRing + 3, 2);
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });

  it('never lets cells overlap, in a ring or between neighbouring rings', async () => {
    const { cellAt } = await import('../src/cosmos.js');
    const cells = [];
    for (let ring = COSMOS.firstRing; ring < COSMOS.firstRing + RINGS; ring++) {
      for (let sector = 0; sector < COSMOS.sectors; sector++) cells.push(cellAt(ring, sector));
    }
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i];
        const b = cells[j];
        const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius;
        expect(gap, `${a.key} and ${b.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('builds a cell’s particles the same way every time', async () => {
    const { cellAt } = await import('../src/cosmos.js');
    const { buildCellParts } = await import('../src/fields.js');
    const cell = cellAt(COSMOS.firstRing, 4);
    const a = buildCellParts(cell);
    const b = buildCellParts(cell);
    expect(a.length).toBe(b.length);
    a.forEach((part, i) => {
      expect(part.particles.positions).toEqual(b[i].particles.positions);
      expect(part.masses).toEqual(b[i].masses);
    });
  });
});
