import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGame } from './game.js';
import './style.css';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.querySelector('#app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const game = createGame({ renderer, camera, controls });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let elapsed = 0;
let lastTime = performance.now();

renderer.setAnimationLoop((now) => {
  // Clamp delta so switching tabs doesn't make everything jump forward.
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  elapsed += delta;

  controls.update();
  game.update(elapsed, delta);
  game.render(delta);
});
