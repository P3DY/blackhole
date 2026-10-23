import * as THREE from 'three';
import { POINTER, STICK } from './config.js';

const { clamp } = THREE.MathUtils;

// Mouse and touch steering.
//
// Mouse: the black hole heads for the point on the galactic plane under the cursor, pushing harder the further
// the cursor is from it. Left-drag still orbits the camera (the black hole holds its course meanwhile), and
// holding the right button boosts. Keys take over whenever they're held, until the mouse moves again.
//
// Touch: one finger is a joystick centred where it landed; drag past its ring to boost. Two fingers orbit and
// zoom the camera.
export function createPointer({ camera, controls, element }) {
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
  let finger = null; // { id, x0, y0, x, y } while one finger steers
  let input = null; // 'mouse' or 'touch', whichever steered last

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const screen = new THREE.Vector3();
  const course = new THREE.Vector3(); // the mouse's last push, held while the camera orbits

  const fingerReach = () => Math.hypot(finger.x - finger.x0, finger.y - finger.y0);

  function drawStick() {
    stick.hidden = !finger;
    if (!finger) return;
    const { x0, y0, x, y } = finger;
    const reach = fingerReach();
    const scale = Math.min(1, STICK.radius / Math.max(reach, 1e-6)); // the knob stops at the ring
    stick.style.transform = `translate(${x0}px, ${y0}px) translate(-50%, -50%)`;
    knob.style.transform = `translate(-50%, -50%) translate(${(x - x0) * scale}px, ${(y - y0) * scale}px)`;
    stick.classList.toggle('boost', reach > STICK.radius * STICK.boost);
  }

  function onPointerDown(event) {
    if (event.pointerType !== 'touch') {
      mouse.buttons = event.buttons;
      return;
    }
    if (event.isPrimary) touches.clear(); // the first finger down, so drop any we never saw lift
    touches.add(event.pointerId);
    input = 'touch';
    stopMouse();
    // Only a lone finger steers; a second one hands the gesture to the camera.
    finger = touches.size === 1 ? { id: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY } : null;
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
    if (!mouse.active && Math.hypot(mouse.x - mouse.fromX, mouse.y - mouse.fromY) > 4) {
      mouse.active = true;
      input = 'mouse';
    }
  }

  function onPointerUp(event) {
    if (event.pointerType !== 'touch') {
      mouse.buttons = event.buttons;
      return;
    }
    touches.delete(event.pointerId);
    if (finger?.id === event.pointerId) finger = null;
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
    drawStick();
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('blur', onBlur);

  // Toward the point under the cursor, from 0 near the black hole to 1 at POINTER.full of the screen height.
  function steerMouse(origin, out) {
    if (mouse.buttons & 1) return out.copy(course); // orbiting the camera

    const width = window.innerWidth;
    const height = window.innerHeight;
    ndc.set((mouse.x / width) * 2 - 1, 1 - (mouse.y / height) * 2);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) out.subVectors(hit, origin);
    else out.copy(raycaster.ray.direction); // above the horizon: head that way
    out.y = 0;

    screen.copy(origin).project(camera);
    const distance = Math.hypot(((ndc.x - screen.x) * width) / 2, ((ndc.y - screen.y) * height) / 2) / height;
    out.setLength(clamp((distance - POINTER.dead) / (POINTER.full - POINTER.dead), 0, 1));
    return course.copy(out);
  }

  // Joystick up is camera forward, the same as W.
  function steerFinger(forward, right, out) {
    const strength = clamp((fingerReach() - STICK.dead) / (STICK.radius - STICK.dead), 0, 1);
    return out
      .set(0, 0, 0)
      .addScaledVector(right, finger.x - finger.x0)
      .addScaledVector(forward, finger.y0 - finger.y)
      .setLength(strength);
  }

  return {
    // 'mouse' or 'touch', whichever steered last (null before either has).
    get input() {
      return input;
    },

    get boost() {
      return Boolean(mouse.buttons & 2) || (finger !== null && fingerReach() > STICK.radius * STICK.boost);
    },

    // Writes the push the pointer asks for into `out`: along the galactic plane, length 0–1. `forward` and
    // `right` are the camera's flattened axes, the ones the keys steer by.
    steer(origin, forward, right, out) {
      if (finger) return steerFinger(forward, right, out);
      if (mouse.active) return steerMouse(origin, out);
      return out.set(0, 0, 0);
    },

    // The keys are steering: ignore the mouse until it moves again.
    yieldToKeys: stopMouse,

    dispose() {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onBlur);
      stick.remove();
    },
  };
}
