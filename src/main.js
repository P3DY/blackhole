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

// The intro gets out of the way once you start playing: at the first click, touch, key or scroll, or after 20 s
// for a player who only steers with the mouse.
const intro = document.querySelector('#intro');
const introEvents = ['pointerdown', 'keydown', 'wheel'];
function dismissIntro() {
  intro.classList.add('dismissed');
  clearTimeout(introTimer);
  for (const type of introEvents) window.removeEventListener(type, dismissIntro);
}
const introTimer = setTimeout(dismissIntro, 20000);
for (const type of introEvents) window.addEventListener(type, dismissIntro);

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
