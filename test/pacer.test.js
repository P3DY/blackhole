import { describe, expect, it } from 'vitest';
import { PACE, createPacer } from '../src/pacer.js';

// Runs `pacer` for `seconds` of frames, each `delta(pacer)` long, from `clock.now`, and returns every scale it
// changed to.
function run(pacer, clock, seconds, delta) {
  const changes = [];
  for (const end = clock.now + seconds; clock.now < end; ) {
    const frame = typeof delta === 'function' ? delta(pacer) : delta;
    clock.now += frame;
    const scale = pacer.sample(clock.now);
    if (scale !== null) changes.push(scale);
  }
  return changes;
}

// Frames that take `full` at full scale and get faster with fewer pixels (time ∝ pixels, so ∝ scale²).
const fillBound = (full) => (pacer) => full * pacer.scale ** 2;

describe('createPacer', () => {
  it('leaves a game at full speed alone', () => {
    const pacer = createPacer();
    expect(run(pacer, { now: 0 }, 60, 1 / 60)).toEqual([]);
    expect(pacer.scale).toBe(1);
  });

  it('waits for the game to settle before judging', () => {
    const pacer = createPacer();
    expect(run(pacer, { now: 0 }, PACE.start, 1 / 20)).toEqual([]);
  });

  it('steps down while slow and it helps, but no further than the least, however slow', () => {
    const pacer = createPacer();
    run(pacer, { now: 0 }, 120, fillBound(1 / 4));
    expect(pacer.scale).toBe(PACE.least);
  });

  it('settles where frames are fast enough', () => {
    const pacer = createPacer();
    const clock = { now: 0 };
    run(pacer, clock, 30, fillBound(1 / 40));
    const settled = pacer.scale;
    expect(settled).toBeLessThan(1);
    expect((1 / 40) * settled ** 2).toBeLessThan(PACE.slow);
    // It may try a step up now and then, but comes back down, and less and less often.
    const changes = run(pacer, clock, 600, fillBound(1 / 40));
    expect(changes.length).toBeLessThan(20);
  });

  it("undoes a step that didn't help, and doesn't try again for a while", () => {
    const pacer = createPacer();
    const clock = { now: 0 };
    expect(run(pacer, clock, PACE.start + 8, 1 / 30)).toEqual([PACE.step, 1]);
    expect(run(pacer, clock, PACE.holdOff - 10, 1 / 30)).toEqual([]);
    expect(run(pacer, clock, 20, 1 / 30)[0]).toBe(PACE.step);
  });

  it('ignores a hidden tab', () => {
    const pacer = createPacer();
    const clock = { now: 0 };
    run(pacer, clock, PACE.start, 1 / 60);
    expect(run(pacer, clock, 60, PACE.gap)).toEqual([]);
  });

  it('starts afresh at full scale on reset', () => {
    const pacer = createPacer();
    const clock = { now: 0 };
    run(pacer, clock, 30, fillBound(1 / 20));
    expect(pacer.scale).toBeLessThan(1);
    pacer.reset(clock.now);
    expect(pacer.scale).toBe(1);
  });
});
