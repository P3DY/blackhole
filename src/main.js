import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGame } from './game.js';
import './style.css';

const { clamp } = THREE.MathUtils;

const renderer = new THREE.WebGLRenderer({ antialias: true });
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
