import { describe, expect, it } from 'vitest';
import {
  BOOST,
  BOOST_COST,
  CORE_MASS,
  HAWKING,
  HUNT_PREY,
  HUNT_TIME,
  MAX_HOLES,
  MAX_LENSES,
  MAX_WARPS,
  RIVAL_PACE,
  STARS_MASS,
  TIER_GROWTH,
} from '../src/config.js';

// The balance rules and capacity limits CLAUDE.md and docs/tuning.md state.
describe('config', () => {
  it('keeps a galaxy worth about one tier of growth', () => {
    expect((1 + STARS_MASS + CORE_MASS) / TIER_GROWTH ** 3).toBeCloseTo(1, 0);
  });

  it('lets you escape every hunt by boosting', () => {
    const slowest = Math.cbrt(1 / HUNT_PREY) * Math.exp(((HAWKING + BOOST_COST) * HUNT_TIME) / 3) * RIVAL_PACE.hunt;
    expect(slowest).toBeLessThan(BOOST);
  });

  it('fits slots in the disk pool and warps in the slots', () => {
    expect(MAX_HOLES).toBeLessThanOrEqual(256); // disk owners are a Uint8Array
    expect(MAX_WARPS).toBeLessThanOrEqual(MAX_HOLES);
    expect(MAX_LENSES).toBeLessThanOrEqual(MAX_HOLES);
  });
});
