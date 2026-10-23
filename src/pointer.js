import * as THREE from 'three';
import { DOUBLE_TAP, POINTER, STICK, TILT, TOUCH_MODE } from './config.js';
import { readChoice, readFlag, writeChoice, writeFlag } from './settings.js';

const { clamp, degToRad, radToDeg } = THREE.MathUtils;

// The ways to steer by touch: [key, label, description]. The Touch tab of the settings menu picks one.
const MODES = [
  ['joystick', 'Joystick', 'Drag from where your finger lands; past the ring boosts'],
  ['follow', 'Follow finger', 'Head for your finger; double-tap and hold to boost'],
  ['tilt', 'Tilt', 'Tilt the phone; hold a finger down to boost. Pick it again to re-centre'],
];
const MODE_STORAGE = 'black-hole:touch';
const STICK_STORAGE = 'black-hole:stick-hidden';
const ASK_EVENTS = ['pointerup', 'touchend']; // iOS only asks for the motion sensors during one of these
const NO_SENSOR = 2000; // ms to wait for a first tilt reading before giving up on it

// Mouse and touch steering.
//
// Mouse: the black hole heads for the point on the galactic plane under the cursor, pushing harder the further
// the cursor is from it. Left-drag still orbits the camera (the black hole holds its course meanwhile), and
// holding the right button boosts. Keys take over whenever they're held, until the mouse moves again.
//
// Touch: two fingers orbit and zoom the camera. What one finger does depends on the mode, which the Touch
// tab of the settings menu picks (`settings` is the menu):
// - joystick: one finger is a joystick centred where it landed; drag past its ring to boost. The ring and knob
//   can be hidden.
// - follow: the black hole heads for the point under your finger, as it does for the cursor. Double-tap and
//   hold to boost.
// - tilt: tilt the phone and the black hole rolls that way, from however you held it when you picked tilt (or
//   restarted). Holding a finger down boosts.
export function createPointer({ camera, controls, element, settings }) {
  controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }; // one finger is ours

  const stick = document.createElement('div');
  stick.className = 'bh-stick';
  stick.hidden = true;
  stick.style.setProperty('--radius', `${STICK.radius}px`);
  stick.innerHTML = '<i></i>';
  document.body.append(stick);
  const knob = stick.querySelector('i');

  const mouse = { active: false, x: 0, y: 0, fromX: 0, fromY: 0, buttons: 0 };
  const touches = new Set();
  let finger = null; // { id, x0, y0, x, y, time, boost } while one finger is down on its own
  let tapped = -Infinity; // when the last tap (a short lone touch) lifted, in event time, for double-taps

  let mode = readChoice(MODE_STORAGE, MODES.map(([key]) => key), TOUCH_MODE);
  let stickHidden = readFlag(STICK_STORAGE);

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const screen = new THREE.Vector3();
  const course = new THREE.Vector3(); // the mouse's last push, held while the camera orbits

  // Tilt: `lean` is how far gravity has swung along the screen (x right, y up) since `level` was taken.
  const motion = typeof DeviceOrientationEvent === 'undefined' ? null : DeviceOrientationEvent;
  let tiltState = 'off'; // 'off', 'asking' (for the sensors), 'waiting' (for a reading), 'on', or 'missing'
  let levelled = false; // whether `level` has been taken since the last re-centre
  let turn = 0; // the screen's rotation when it was
  let noSensor = 0;
  const level = new THREE.Vector2();
  const lean = new THREE.Vector2();

  const fingerReach = () => Math.hypot(finger.x - finger.x0, finger.y - finger.y0);

  function drawStick() {
    const shown = finger !== null && mode === 'joystick' && !stickHidden;
    stick.hidden = !shown;
    if (!shown) return;
    const { x0, y0, x, y } = finger;
    const reach = fingerReach();
    const scale = Math.min(1, STICK.radius / Math.max(reach, 1e-6)); // the knob stops at the ring
    stick.style.transform = `translate(${x0}px, ${y0}px) translate(-50%, -50%)`;
    knob.style.transform = `translate(-50%, -50%) translate(${(x - x0) * scale}px, ${(y - y0) * scale}px)`;
    stick.classList.toggle('boost', reach > STICK.radius * STICK.boost);
  }

  // --- Settings ---------------------------------------------------------------------

  const group = settings.addGroup(settings.addTab('Touch', { touch: true }), 'Steer with');
  const choices = settings.addChoices(group, MODES, choose);
  const visible = settings.addSwitch(group, 'Visible', 'Show the joystick while you steer with it', (on) => {
    stickHidden = !on;
    writeFlag(STICK_STORAGE, stickHidden);
  });
  const visibleRow = visible.closest('label');
  visibleRow.classList.add('bh-sub');
  choices.joystick.closest('label').after(visibleRow); // it belongs to the joystick

  function drawMenu() {
    choices[mode].checked = true;
    choices.tilt.disabled = tiltState === 'missing';
    visible.checked = !stickHidden;
    visibleRow.classList.toggle('dim', mode !== 'joystick');
  }

  // Picking tilt again re-centres it.
  function choose(key) {
    mode = key;
    writeChoice(MODE_STORAGE, key);
    if (key === 'tilt') startTilt();
    else stopTilt();
    drawMenu();
  }

  // --- Tilt -------------------------------------------------------------------------

  function onOrientation(event) {
    if (event.beta === null || event.gamma === null) return;
    if (tiltState === 'waiting') {
      clearTimeout(noSensor);
      tiltState = 'on';
    }
    // Which way a marble on the screen would roll, in the phone's axes (x to its right edge, y to its top)…
    const beta = degToRad(event.beta);
    const gamma = degToRad(event.gamma);
    const dx = Math.sin(gamma) * Math.cos(beta);
    const dy = -Math.sin(beta);
    // …then in the screen's, which turn with the phone.
    const angle = (((window.screen.orientation?.angle ?? window.orientation ?? 0) % 360) + 360) % 360;
    const x = angle === 90 ? -dy : angle === 180 ? -dx : angle === 270 ? dy : dx;
    const y = angle === 90 ? dx : angle === 180 ? -dy : angle === 270 ? -dx : dy;
    if (!levelled || angle !== turn) {
      level.set(x, y);
      turn = angle;
      levelled = true;
    }
    lean.set(x - level.x, y - level.y);
  }

  // Starts tilt steering, or re-centres it if it's already going. iOS needs permission first, and only asks
  // during a tap.
  function startTilt() {
    levelled = false;
    lean.set(0, 0);
    if (tiltState === 'missing' || !motion) return missingTilt();
    if (tiltState !== 'off') return;
    if (typeof motion.requestPermission !== 'function') return listen();
    tiltState = 'asking';
    ask();
  }

  function ask() {
    motion.requestPermission().then(
      (answer) => tiltState === 'asking' && (answer === 'granted' ? listen() : missingTilt()),
      () => {
        // Not during a tap (say, the choice was remembered from last time): ask at the next one.
        for (const type of ASK_EVENTS) window.addEventListener(type, onAskTap, true);
      },
    );
  }

  function onAskTap() {
    for (const type of ASK_EVENTS) window.removeEventListener(type, onAskTap, true);
    if (tiltState === 'asking') ask();
  }

  function listen() {
    tiltState = 'waiting';
    window.addEventListener('deviceorientation', onOrientation);
    noSensor = setTimeout(missingTilt, NO_SENSOR); // no sensor, or the page isn't allowed it (it needs https)
  }

  function stopTilt() {
    if (tiltState === 'missing') return;
    tiltState = 'off';
    clearTimeout(noSensor);
    window.removeEventListener('deviceorientation', onOrientation);
    for (const type of ASK_EVENTS) window.removeEventListener(type, onAskTap, true);
    lean.set(0, 0);
  }

  // Tilt can't work here, so it's greyed out and you steer with the joystick. The choice stays remembered, in
  // case it works next time.
  function missingTilt() {
    stopTilt();
    tiltState = 'missing';
    if (mode === 'tilt') mode = 'joystick';
    drawMenu();
  }

  if (mode === 'tilt') startTilt();
  drawMenu();

  // --- Pointer events ---------------------------------------------------------------

  function onPointerDown(event) {
    if (event.pointerType !== 'touch') {
      mouse.buttons = event.buttons;
      return;
    }
    if (event.isPrimary) touches.clear(); // the first finger down, so drop any we never saw lift
    touches.add(event.pointerId);
    stopMouse();
    // Only a lone finger steers; a second one hands the gesture to the camera.
    const { pointerId: id, clientX: x, clientY: y, timeStamp: time } = event;
    const boost = time - tapped < DOUBLE_TAP.gap * 1000; // the second half of a double-tap
    finger = touches.size === 1 ? { id, x0: x, y0: y, x, y, time, boost } : null;
    drawStick();
  }

  function onPointerMove(event) {
    if (event.pointerType === 'touch') {
      if (finger?.id !== event.pointerId) return;
      finger.x = event.clientX;
      finger.y = event.clientY;
      drawStick();
      return;
    }
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.buttons = event.buttons;
    if (!mouse.active && Math.hypot(mouse.x - mouse.fromX, mouse.y - mouse.fromY) > 4) mouse.active = true;
  }

  function onPointerUp(event) {
    if (event.pointerType !== 'touch') {
      mouse.buttons = event.buttons;
      return;
    }
    touches.delete(event.pointerId);
    if (finger?.id === event.pointerId) {
      const tap = !finger.boost && event.timeStamp - finger.time < DOUBLE_TAP.tap * 1000;
      tapped = tap ? event.timeStamp : -Infinity;
      finger = null;
    }
    drawStick();
  }

  function onPointerLeave(event) {
    if (event.pointerType !== 'touch') stopMouse();
  }

  function stopMouse() {
    mouse.active = false;
    mouse.fromX = mouse.x;
    mouse.fromY = mouse.y;
    course.set(0, 0, 0);
  }

  function onBlur() {
    stopMouse();
    mouse.buttons = 0;
    touches.clear();
    finger = null;
    tapped = -Infinity;
    drawStick();
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('blur', onBlur);

  // --- Steering ---------------------------------------------------------------------

  // Toward the point on the galactic plane under (x, y) on screen, from 0 near the black hole to 1 at
  // POINTER.full of the screen height.
  function steerAt(x, y, origin, out) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    ndc.set((x / width) * 2 - 1, 1 - (y / height) * 2);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) out.subVectors(hit, origin);
    else out.copy(raycaster.ray.direction); // above the horizon: head that way
    out.y = 0;

    screen.copy(origin).project(camera);
    const distance = Math.hypot(((ndc.x - screen.x) * width) / 2, ((ndc.y - screen.y) * height) / 2) / height;
    return out.setLength(clamp((distance - POINTER.dead) / (POINTER.full - POINTER.dead), 0, 1));
  }

  function steerMouse(origin, out) {
    if (mouse.buttons & 1) return out.copy(course); // orbiting the camera
    return course.copy(steerAt(mouse.x, mouse.y, origin, out));
  }

  // Joystick up is camera forward, the same as W.
  function steerStick(forward, right, out) {
    const strength = clamp((fingerReach() - STICK.dead) / (STICK.radius - STICK.dead), 0, 1);
    return out
      .set(0, 0, 0)
      .addScaledVector(right, finger.x - finger.x0)
      .addScaledVector(forward, finger.y0 - finger.y)
      .setLength(strength);
  }

  // Tipping the top of the phone away is camera forward, like pushing the joystick up.
  function steerTilt(forward, right, out) {
    const degrees = radToDeg(Math.asin(Math.min(lean.length(), 1)));
    const strength = clamp((degrees - TILT.dead) / (TILT.full - TILT.dead), 0, 1);
    return out.set(0, 0, 0).addScaledVector(right, lean.x).addScaledVector(forward, lean.y).setLength(strength);
  }

  return {
    // The touch mode in use: 'joystick', 'follow' or 'tilt'.
    get mode() {
      return mode;
    },

    get boost() {
      if (mouse.buttons & 2) return true;
      if (!finger) return false;
      if (mode === 'joystick') return fingerReach() > STICK.radius * STICK.boost;
      if (mode === 'follow') return finger.boost;
      return true; // tilt: any lone finger held down
    },

    // Writes the push the pointer asks for into `out`: along the galactic plane, length 0–1. `forward` and
    // `right` are the camera's flattened axes, the ones the keys steer by.
    steer(origin, forward, right, out) {
      if (finger && mode === 'joystick') return steerStick(forward, right, out);
      if (finger && mode === 'follow') return steerAt(finger.x, finger.y, origin, out);
      if (mouse.active) return steerMouse(origin, out);
      if (mode === 'tilt' && tiltState === 'on') return steerTilt(forward, right, out);
      return out.set(0, 0, 0);
    },

    // The keys are steering: ignore the mouse until it moves again.
    yieldToKeys: stopMouse,

    // A restart re-levels tilt, from however you're holding the phone now.
    recentre() {
      levelled = false;
      lean.set(0, 0);
    },

    dispose() {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onBlur);
      stopTilt();
      stick.remove();
    },
  };
}
