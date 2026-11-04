// Decides how much to scale the resolution down by, from how long frames take. Fill rate is what limits the
// game on a phone, so drawing fewer pixels is what helps most when it can't keep up.
//
// Frame times are averaged over a second at a time. Two slow seconds in a row (under about 50 fps) take the scale
// down a step. A step that didn't make frames faster (the CPU, not the graphics chip, was what held them back) is
// undone, and no step down is tried again for a minute. A stretch at full speed (about 57 fps or more) takes it
// back up a step, and if that soon proves too much, the stretch it takes to try again doubles, so it doesn't
// keep flickering between two sizes.
export const PACE = {
  window: 1, // seconds averaged at a time
  slow: 1 / 50, // an average frame slower than this is slow
  fast: 1 / 57, // one faster than this has room to spare
  slowRun: 2, // slow seconds in a row that take the scale down
  step: 0.85, // each step down multiplies the scale by this (0.72 as many pixels)
  least: 0.5,
  start: 3, // seconds to wait before judging at all, while the game loads and settles
  settle: 1, // seconds to ignore after a change, while the buffers are remade
  noHelp: 0.95, // a step down that leaves frames slower than this share of before is undone…
  holdOff: 60, // …and no step down is tried for this many seconds
  upAfter: 5, // fast seconds in a row before a step up
  upMost: 120, // the longest that wait can grow to
  regret: 10, // a step down this soon after a step up doubles the wait
  gap: 1, // a gap between frames this long or longer is the tab hidden, not a slow frame
};

export function createPacer() {
  let scale = 1;
  let first = null; // when the first frame came, in seconds
  let last = null; // when the last one did
  let quietUntil = 0;
  let sum = 0;
  let frames = 0;
  let windowStart = null;
  let slowRun = 0;
  let fastRun = 0;
  let upAfter = PACE.upAfter;
  let lastUp = -Infinity;
  let blockedUntil = -Infinity; // no steps down before this
  let before = null; // the average frame time before the last step down, until it's been checked

  function change(next, now) {
    scale = next;
    quietUntil = now + PACE.settle;
    sum = 0;
    frames = 0;
    windowStart = null;
    slowRun = 0;
    fastRun = 0;
    return scale;
  }

  function judge(average, now) {
    if (before !== null) {
      const helped = average < before * PACE.noHelp;
      before = null;
      if (!helped) {
        blockedUntil = now + PACE.holdOff;
        return change(Math.min(1, scale / PACE.step), now);
      }
    }
    if (average > PACE.slow) {
      fastRun = 0;
      if (++slowRun < PACE.slowRun || scale <= PACE.least || now < blockedUntil) return null;
      if (now - lastUp < PACE.regret) upAfter = Math.min(2 * upAfter, PACE.upMost);
      before = average;
      return change(Math.max(PACE.least, scale * PACE.step), now);
    }
    slowRun = 0;
    if (average < PACE.fast && scale < 1) {
      fastRun += PACE.window;
      if (fastRun < upAfter) return null;
      lastUp = now;
      return change(Math.min(1, scale / PACE.step), now);
    }
    fastRun = 0;
    return null;
  }

  return {
    get scale() {
      return scale;
    },

    // A frame was drawn at `now` (in seconds, from any steady clock). Returns the new scale if it changes, else
    // null. Frames are timed from one call to the next, rather than taking the host's delta, which it clamps at
    // 0.1 s: a game drawing 5 frames a second needs help most. A gap of `gap` or more (a hidden tab) isn't a frame.
    sample(now) {
      const delta = last === null ? 0 : now - last;
      last = now;
      first ??= now;
      if (now - first < PACE.start || now < quietUntil || !(delta > 0 && delta < PACE.gap)) return null;
      windowStart ??= now;
      sum += delta;
      frames++;
      if (now - windowStart < PACE.window) return null;
      const average = sum / frames;
      sum = 0;
      frames = 0;
      windowStart = now;
      return judge(average, now);
    },

    // Back to full scale, starting afresh (when the setting changes).
    reset(now) {
      upAfter = PACE.upAfter;
      lastUp = -Infinity;
      blockedUntil = -Infinity;
      before = null;
      change(1, now);
    },
  };
}
