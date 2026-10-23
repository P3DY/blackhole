import * as THREE from 'three';
import { BOOST, LESSONS, REACH, RINGS, SLOW_MOTION, THRUST } from './config.js';
import { dangerRadius, planarDistance } from './holes.js';
import './hints.css';

const { clamp, smoothstep } = THREE.MathUtils;

// The control lessons, in the order they're taught.
const ORDER = ['drift', 'boost', 'look'];

// What time slows down for, the first time each happens: nearing a black hole heavier than you, or a lighter one.
const MOMENTS = {
  heavier: ['Heavier than you', 'Don’t cross its red ring'],
  lighter: ['Lighter than you', 'Bring it inside your reach to swallow it'],
};

const CURSOR = '<svg class="bh-cursor" viewBox="0 0 14 21" aria-hidden="true"><path d="M1 1v16l4-4 3 6.5 2.5-1-3-6.5H13z" /></svg>';
const SWING = '<svg class="bh-swing" viewBox="0 0 60 18" aria-hidden="true"><path d="M7 14Q30-2 53 14M3 8l4 6 6-2M57 8l-4 6-6-2" /></svg>';
const mouse = (button) =>
  `<svg class="bh-mouse ${button}" viewBox="0 0 24 36" aria-hidden="true"><path class="bh-button" d="${
    button === 'left' ? 'M12 1.5A10.5 10.5 0 0 0 1.5 12v2H12z' : 'M12 1.5A10.5 10.5 0 0 1 22.5 12v2H12z'
  }" /><rect x="1" y="1" width="22" height="34" rx="11" /><path d="M12 1v13M1 14h22" /></svg>`;
const dock = (glyphs, caption, note) =>
  `<div class="bh-dock">${glyphs ? `<div class="bh-glyphs">${glyphs}</div>` : ''}<div class="bh-caption">${caption}${
    note ? `<small>${note}</small>` : ''
  }</div></div>`;

// Each lesson has a mouse-and-keyboard version and a touch version; hints.css shows the one that fits. Drift and
// boost have a touch version for each touch mode (`data-mode`), and only the one for the mode in use shows.
const LESSON_HTML = {
  drift: `
    <div class="bh-desk">
      <div class="bh-aim"><i class="bh-trail"></i>${CURSOR}</div>
      ${dock('<div class="bh-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div>', 'drift')}
    </div>
    <div class="bh-touch" data-mode="joystick">
      <div class="bh-thumb"><i class="bh-ring"></i><i class="bh-finger"></i></div>
      ${dock('', 'drift')}
    </div>
    <div class="bh-touch" data-mode="follow">
      <div class="bh-aim"><i class="bh-trail"></i><i class="bh-finger"></i></div>
      ${dock('', 'drift', 'touch where to go')}
    </div>
    <div class="bh-touch" data-mode="tilt">
      <div class="bh-thumb"><div class="bh-phone"><i class="bh-marble"></i></div></div>
      ${dock('', 'drift', 'tilt your phone')}
    </div>`,
  boost: `
    <div class="bh-desk">${dock(`<kbd class="bh-shift">Shift</kbd><span class="bh-or">or</span>${mouse('right')}`, 'boost', 'burns mass')}</div>
    <div class="bh-touch" data-mode="joystick">
      <div class="bh-thumb"><i class="bh-ring"></i><i class="bh-finger"></i></div>
      ${dock('', 'boost', 'burns mass')}
    </div>
    <div class="bh-touch" data-mode="follow">
      <div class="bh-thumb"><i class="bh-finger"></i></div>
      ${dock('', 'boost', 'double-tap and hold · burns mass')}
    </div>
    <div class="bh-touch" data-mode="tilt">
      <div class="bh-thumb"><i class="bh-finger"></i></div>
      ${dock('', 'boost', 'hold a finger down · burns mass')}
    </div>`,
  look: `
    <div class="bh-desk">${dock(`<div class="bh-look">${SWING}<div class="bh-sway">${mouse('left')}</div></div>`, 'look around')}</div>
    <div class="bh-touch">
      <div class="bh-pair"><i class="bh-finger"></i><i class="bh-finger"></i></div>
      ${dock('', 'look around')}
    </div>`,
};

// Teaches the game as you play, with no intro. Each control is a looping gesture that fades in and out until
// you've used it, and the first time you near a heavier or a lighter black hole, time all but stops while a
// label explains it. It keeps its own DOM and progress, which survives a restart (but not a reload).
//
// update() returns the time scale for the next frame, and `focus` names the black hole being explained, so
// the game can light it up.
export function createHints({ controls }) {
  const root = document.createElement('div');
  root.className = 'bh-hints';
  root.innerHTML = `
    ${ORDER.map((key) => `<div class="bh-lesson" data-lesson="${key}">${LESSON_HTML[key]}</div>`).join('')}
    <div class="bh-callout"><b></b><span></span></div>
    <div class="bh-tag">your reach</div>`;
  // Under the HUD, so the bars don't hide your mass.
  const letterbox = document.createElement('div');
  letterbox.className = 'bh-letterbox';
  document.body.append(letterbox, root);

  const callout = root.querySelector('.bh-callout');
  const tag = root.querySelector('.bh-tag');

  // A finished lesson's flare has played out: drop the class, which stops its gestures looping unseen.
  root.addEventListener('animationend', (event) => {
    if (event.animationName === 'bh-done') event.target.classList.remove('done');
  });

  // How much of each control you've used, whether or not its lesson has come up yet.
  const used = { drift: 0, boost: 0, look: 0 };
  const lessons = ORDER.map((key) => ({ key, element: root.querySelector(`[data-lesson="${key}"]`) }));
  let current = 0; // the lesson being taught: the ones before it are done
  let waited = 0; // seconds since the one before it was done
  let azimuth = null; // the camera's angles last frame, to measure how far you've turned it
  let polar = 0;

  const seen = new Set(); // the moments already explained
  let moment = null; // { kind, hole, age } while time is slowed
  const focus = { kind: '', hole: null, radius: 0, glow: 0 };
  let clock = 0;

  const forward = new THREE.Vector3();
  const view = new THREE.Vector3();
  const point = new THREE.Vector3();

  // Radians the camera has turned since last frame. Only you turn it: the game moves it but keeps its angles.
  function turned() {
    const a = controls.getAzimuthalAngle();
    const p = controls.getPolarAngle();
    const last = azimuth;
    const turn = last === null ? 0 : Math.abs(Math.atan2(Math.sin(a - last), Math.cos(a - last))) + Math.abs(p - polar);
    azimuth = a;
    polar = p;
    return turn;
  }

  function practise(delta, player) {
    used.drift += (player.thrust.length() / (THRUST * player.shadow * (player.boosting ? BOOST : 1))) * delta;
    if (player.boosting) used.boost += delta;
  }

  // Shows the current lesson while `free`, and moves on once you've done enough of it.
  function teach(delta, free) {
    const lesson = lessons[current];
    if (!lesson) return;
    const { element } = lesson;

    if (used[lesson.key] >= LESSONS[lesson.key]) {
      // Done: if it was showing, it flares and fades from wherever its pulse was.
      if (element.classList.contains('active')) {
        element.style.setProperty('--from', getComputedStyle(element).opacity);
        element.classList.replace('active', 'done');
      }
      current++;
      waited = 0;
      return;
    }
    waited += delta;
    element.classList.toggle('active', free && waited >= LESSONS.wait);
  }

  function onScreen(position, camera) {
    if (view.copy(position).applyMatrix4(camera.matrixWorldInverse).z > 0) return false;
    point.copy(position).project(camera);
    return Math.abs(point.x) < 0.9 && Math.abs(point.y) < 0.9;
  }

  // Starts a moment for the first black hole that calls for one.
  function watch(player, holes, camera) {
    for (const hole of holes) {
      if (hole === player || hole.state !== 'alive') continue;
      const kind = hole.edible ? 'lighter' : 'heavier';
      if (seen.has(kind)) continue;

      const distance = planarDistance(hole.position, player.position);
      if (kind === 'heavier') {
        const radius = dangerRadius(hole, player);
        const dx = hole.position.x - player.position.x;
        const dz = hole.position.z - player.position.z;
        const closing = dx * (player.velocity.x - hole.velocity.x) + dz * (player.velocity.z - hole.velocity.z) > 0;
        const near = distance < radius * SLOW_MOTION.heavier * 0.5;
        if (!near && !(closing && distance < radius * SLOW_MOTION.heavier && onScreen(hole.position, camera))) continue;
      } else if (distance > REACH * player.size * SLOW_MOTION.lighter || !onScreen(hole.position, camera)) continue;

      seen.add(kind);
      moment = { kind, hole, age: 0 };
      const [title, line] = MOMENTS[kind];
      callout.querySelector('b').textContent = title;
      callout.querySelector('span').textContent = line;
      callout.classList.toggle('prey', kind === 'lighter');
      callout.classList.add('show');
      tag.classList.toggle('show', kind === 'lighter');
      letterbox.classList.add('on');
      return;
    }
  }

  function endMoment() {
    moment = null;
    callout.classList.remove('show');
    tag.classList.remove('show');
    letterbox.classList.remove('on');
  }

  // Pins `element` to the ground `radius` from `center`, away from the camera (`side` 1, up the screen) or
  // toward it (-1), and keeps it on screen.
  function pin(element, center, radius, side, camera) {
    point.copy(center).addScaledVector(forward, side * radius);
    const behind = view.copy(point).applyMatrix4(camera.matrixWorldInverse).z > 0;
    point.project(camera);
    if (behind) point.set(-point.x, -1, 0); // somewhere behind you: along the bottom edge, on its side
    const width = window.innerWidth;
    const height = window.innerHeight;
    const x = clamp(((point.x + 1) / 2) * width, 110, width - 110);
    const y = clamp(((1 - point.y) / 2) * height, 80, height - 30);
    element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // Advances the current moment and returns the time scale it calls for.
  function play(delta, player, camera) {
    const { ease, hold, recover, scale } = SLOW_MOTION;
    const { kind, hole } = moment;
    if (player.state !== 'alive') {
      endMoment();
      return 1;
    }
    if (hole.state === 'gone') moment.age = Math.max(moment.age, ease + hold); // nothing left to point at
    const age = (moment.age += delta);
    if (age >= ease + hold + recover) {
      endMoment();
      return 1;
    }
    if (age >= ease + hold) {
      callout.classList.remove('show');
      tag.classList.remove('show');
      letterbox.classList.remove('on');
    }

    // 0 at full speed, 1 at the slowest.
    const depth = age < ease ? smoothstep(age, 0, ease) : 1 - smoothstep(age, ease + hold, ease + hold + recover);
    focus.kind = kind;
    focus.hole = hole;
    focus.radius = kind === 'heavier' ? dangerRadius(hole, player) : RINGS.prey * hole.size;
    focus.glow = depth * (0.75 + 0.25 * Math.sin(clock * 6));

    camera.getWorldDirection(forward).setY(0).normalize();
    pin(callout, hole.position, focus.radius, 1, camera);
    if (kind === 'lighter') pin(tag, player.position, REACH * player.size, -1, camera);
    return scale ** depth;
  }

  return {
    // The black hole a moment is explaining, if any: { kind, hole, radius, glow }, `glow` 0–1 and pulsing.
    get focus() {
      return moment ? focus : null;
    },

    // Every frame, after the camera has moved, with the frame's real (unscaled) delta. `holes[i].edible` must be
    // up to date, and `touch` is the touch mode in use. Returns the time scale for the next frame.
    update(delta, { camera, player, holes, touch }) {
      if (root.dataset.touch !== touch) root.dataset.touch = touch;
      clock += delta;
      const alive = player.state === 'alive';
      used.look += turned();
      if (alive) practise(delta, player);
      if (alive && !moment) watch(player, holes, camera);
      teach(delta, alive && !moment);
      return moment ? play(delta, player, camera) : 1;
    },

    // A restart ends any moment, but what you've learned stays learned.
    reset() {
      endMoment();
      azimuth = null; // the camera jumps back to its starting angle
    },

    dispose() {
      root.remove();
      letterbox.remove();
    },
  };
}
