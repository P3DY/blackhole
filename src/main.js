import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGame } from './game.js';
import { loadOpening } from './opening.js';
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
  document.querySelector('.loading')?.remove();
  document.querySelector('#app').append(message);
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.querySelector('#app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// The loading screen is in index.html, so it shows while this script loads too. It stays until the first frame
// has been drawn, since uploading the opening's stars to the GPU takes a moment of its own.
const loading = document.querySelector('.loading');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// The opening's stars are built in a worker first (see opening.js), so the page doesn't freeze while it loads.
loadOpening().then((opening) => {
  const game = createGame({ renderer, camera, controls, opening });

  // For poking at from the console while developing (renderer.info, the scene's fields, the camera), and for the
  // smoke test (`debug`, see game.js).
  if (import.meta.env.DEV) window.blackHole = { renderer, camera, scene: game.scene, debug: game.debug };

  let elapsed = 0;
  let lastTime = performance.now();
  let drawn = false;

  renderer.setAnimationLoop((now) => {
    // Clamp delta so switching tabs doesn't make everything jump forward. The first frame's timestamp can come
    // before `lastTime`, so it's never allowed below zero either.
    const delta = clamp((now - lastTime) / 1000, 0, 0.1);
    lastTime = now;
    elapsed += delta;

    controls.update();
    game.update(elapsed, delta);
    game.render(delta);

    if (!drawn) {
      drawn = true;
      loading?.classList.add('done');
      setTimeout(() => loading?.remove(), 1000);
    }
  });
});
