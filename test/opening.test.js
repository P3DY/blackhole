import { describe, expect, it } from 'vitest';
import { UNIVERSE_SEED } from '../src/config.js';
import { buildOpening } from '../src/fields.js';
import { planUniverse } from '../src/universe.js';
import { mulberry32 } from '../src/utils.js';

// The opening's fields are built in a worker, and its plan again on the main thread (opening.js). The two have to
// agree, and the fields have to come out the same every time, since checkpoints refer to their stars one by one.
describe('buildOpening', () => {
  const { plan, parts } = buildOpening();

  it('makes the same plan as planUniverse() alone', () => {
    expect(plan).toEqual(planUniverse(mulberry32(UNIVERSE_SEED)));
  });

  it('makes a field per galaxy and nebula, and one of loose stars', () => {
    expect(parts.length).toBe(plan.galaxies.length + plan.nebulae.length + 1);
    plan.galaxies.forEach((galaxy, i) => {
      expect(parts[i].masses.length).toBe(galaxy.count);
      expect(parts[i]).toMatchObject({ x: galaxy.x, z: galaxy.z, spinRate: galaxy.spinRate });
    });
  });

  it('is the same every time', () => {
    const again = buildOpening().parts;
    parts.forEach((part, i) => {
      expect(again[i].particles.positions).toEqual(part.particles.positions);
      expect(again[i].masses).toEqual(part.masses);
    });
  });
});
