import { describe, expect, it } from 'vitest';
import { pack, unpack } from '../src/stream.js';
import { mulberry32 } from '../src/utils.js';

describe('pack / unpack', () => {
  it.each([0, 1, 7, 8, 9, 1000, 4097])('round-trips %i flags', (count) => {
    const random = mulberry32(count + 1);
    const alive = new Uint8Array(count);
    for (let i = 0; i < count; i++) alive[i] = random() < 0.6 ? 1 : 0;
    const bits = pack(alive);
    expect(bits.length).toBe(Math.ceil(count / 8));
    const back = new Uint8Array(count).fill(7);
    unpack(bits, back);
    expect(back).toEqual(alive);
  });
});
