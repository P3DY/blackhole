import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGame } from './game.js';
import './style.css';

const { clamp } = THREE.MathUtils;

// No antialiasing: the game draws everything into the post-processing chain's own buffers, which don't use it,
// so it would only cost memory and bandwidth for the final full-screen copy. three.js needs WebGL 2, and without
// it the page would otherwise stay blank. The Video tab sets the pixel ratio from here on.
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false });
} catch (error) {
  const message = document.createElement('div');
  message.className = 'no-webgl';
  message.innerHTML =
    '<h1>Black Hole</h1><p>This game needs WebGL 2, which this browser can’t give it. It may be turned off, or the graphics driver may be blocked. An up-to-date Chrome, Firefox, Edge or Safari should run it.</p>';
  document.querySelector('#app').append(message);
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.querySelector('#app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const game = createGame({ renderer, camera, controls });

// For poking at from the console while developing (renderer.info, the scene's fields, the camera).
if (import.meta.env.DEV) window.blackHole = { renderer, camera, scene: game.scene };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let elapsed = 0;
let lastTime = performance.now();

renderer.setAnimationLoop((now) => {
  // Clamp delta so switching tabs doesn't make everything jump forward. The first frame's timestamp can come
  // before `lastTime`, so it's never allowed below zero either.
  const delta = clamp((now - lastTime) / 1000, 0, 0.1);
  lastTime = now;
  elapsed += delta;

  controls.update();
  game.update(elapsed, delta);
  game.render(delta);
});
