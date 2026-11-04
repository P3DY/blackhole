import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, fits } from '../src/save.js';

const counts = [10, 17];
const checkpoint = () => ({
  fields: counts.map((count) => ({ eaten: new Uint8Array(Math.ceil(count / 8)), remaining: count, angle: 0 })),
  cosmos: new Map(),
  holes: [{ key: 'player' }],
  disk: { count: 0, positions: new Float32Array(0) },
  stats: { time: 0 },
  view: { x: 0, y: 1, z: 2 },
});
const stored = (changes = {}) => ({ version: SAVE_VERSION, seed: 7, checkpoint: checkpoint(), ...changes });
const shape = { seed: 7, counts };

describe('fits', () => {
  it('takes a checkpoint made by this version of the game', () => {
    expect(fits(stored(), shape)).toBe(true);
    // As IndexedDB gives it back.
    expect(fits(structuredClone(stored()), shape)).toBe(true);
  });

  it('turns away nothing, another version or another universe', () => {
    expect(fits(null, shape)).toBe(false);
    expect(fits(stored({ version: SAVE_VERSION - 1 }), shape)).toBe(false);
    expect(fits(stored({ seed: 8 }), shape)).toBe(false);
  });

  it('turns away fields that are not the opening\'s', () => {
    expect(fits(stored(), { seed: 7, counts: [10] })).toBe(false);
    expect(fits(stored(), { seed: 7, counts: [10, 30] })).toBe(false);
    const saved = stored();
    saved.checkpoint.fields[0].remaining = 11;
    expect(fits(saved, shape)).toBe(false);
  });

  it('turns away a checkpoint with parts missing', () => {
    for (const part of ['cosmos', 'holes', 'disk', 'stats', 'view']) {
      const saved = stored();
      delete saved.checkpoint[part];
      expect(fits(saved, shape)).toBe(false);
    }
    const saved = stored();
    saved.checkpoint.holes = [{ key: 'rival:x' }];
    expect(fits(saved, shape)).toBe(false);
  });
});
