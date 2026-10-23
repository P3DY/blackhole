import * as THREE from 'three';
import './hud.css';

const { smoothstep } = THREE.MathUtils;

// One unit of mass is a million suns.
export function formatMass(mass) {
  const solar = mass * 1e6;
  if (solar >= 1e9) return `${(solar / 1e9).toFixed(solar >= 1e10 ? 1 : 2)} billion M☉`;
  return `${(solar / 1e6).toFixed(solar >= 1e7 ? 1 : 2)} million M☉`;
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The DOM layer over the canvas, kept quiet during play: your mass and feeding rate, a danger vignette, and
// arrows at the screen edge toward nearby black holes that are off screen. Everything else waits for the
// end-of-game card. `totals` is { cores, rivals } for its "x / y" counters.
export function createHud(totals, onRestart) {
  const root = document.createElement('div');
  root.className = 'bh';
  root.innerHTML = `
    <div class="bh-vignette"></div>
    <div class="bh-markers"></div>
    <div class="bh-readout">
      <div class="bh-mass"></div>
      <div class="bh-meter"><span></span></div>
    </div>`;

  // Its own element, so it can sit above the hints.
  const overlay = document.createElement('div');
  overlay.className = 'bh-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="bh-card">
      <h2></h2>
      <p></p>
      <dl></dl>
      <div class="bh-actions"></div>
    </div>`;
  document.body.append(root, overlay);

  const $ = (selector) => root.querySelector(selector);
  const vignette = $('.bh-vignette');
  const mass = $('.bh-mass');
  const meter = $('.bh-meter span');

  // Arrows for the nearest few black holes, shown only while they're off screen: blue if you outweigh it, red if not.
  const markers = Array.from({ length: 5 }, () => {
    const element = document.createElement('i');
    element.className = 'bh-marker';
    $('.bh-markers').append(element);
    return element;
  });

  const view = new THREE.Vector3();
  const ndc = new THREE.Vector3();

  // Pins the arrow to the screen edge, pointing toward `hole`, or hides it when the hole is on screen.
  function placeMarker(marker, hole, camera) {
    view.copy(hole.position).applyMatrix4(camera.matrixWorldInverse);
    ndc.copy(view).applyMatrix4(camera.projectionMatrix);
    marker.hidden = view.z < 0 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
    if (marker.hidden) return;

    // Camera-space x/y points the same way on screen, and still makes sense for things behind you.
    const width = window.innerWidth;
    const height = window.innerHeight;
    const margin = 18;
    const dx = view.x || 1e-6;
    const dy = view.y || 1e-6;
    const t = Math.min((width / 2 - margin) / Math.abs(dx), (height / 2 - margin) / Math.abs(dy));
    const x = width / 2 + dx * t;
    const y = height / 2 - dy * t;
    const angle = Math.atan2(-dy, dx);
    marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) rotate(${angle.toFixed(3)}rad)`;
    marker.classList.toggle('prey', hole.edible);
  }

  function showOverlay(title, body, stats, actions) {
    overlay.querySelector('h2').textContent = title;
    overlay.querySelector('p').textContent = body;
    overlay.querySelector('dl').innerHTML = stats.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join('');
    const buttons = overlay.querySelector('.bh-actions');
    buttons.replaceChildren(
      ...actions.map(([label, onClick]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => {
          button.blur(); // a focused button would be re-clicked by Space/Enter
          onClick();
        });
        return button;
      }),
    );
    overlay.hidden = false;
  }

  const summary = (stats) => [
    ['Peak mass', formatMass(stats.peakMass)],
    ['Stars absorbed', stats.stars.toLocaleString()],
    ['Cores swallowed', `${stats.cores} / ${totals.cores}`],
    ['Rivals swallowed', `${stats.rivals} / ${totals.rivals}`],
    ['Time', formatTime(stats.time)],
  ];

  const hud = {
    update({ camera, player, holes, danger }) {
      mass.textContent = formatMass(player.mass);
      meter.style.width = `${(player.appetite * 100).toFixed(1)}%`;
      vignette.style.opacity = smoothstep(danger, 0.2, 1).toFixed(3);

      const nearest = holes
        .filter((hole) => hole !== player && hole.state === 'alive')
        .sort((a, b) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position));
      markers.forEach((marker, i) => {
        const hole = player.state === 'alive' ? nearest[i] : undefined;
        if (hole) placeMarker(marker, hole, camera);
        else marker.hidden = true;
      });
    },

    showGameOver(eater, stats) {
      const body =
        eater.kind === 'core'
          ? `You crossed the event horizon of the ${eater.name} core. It now weighs ${formatMass(eater.mass)}.`
          : `${eater.name} swallowed you. It now weighs ${formatMass(eater.mass)}.`;
      showOverlay('Swallowed', body, summary(stats), [['Try again (R)', onRestart]]);
    },

    showVictory(stats) {
      showOverlay('The universe is yours', 'Every core and every rival is gone. You are the last black hole.', summary(stats), [
        ['Keep drifting', () => hud.hideOverlay()],
        ['Play again (R)', onRestart],
      ]);
    },

    hideOverlay() {
      overlay.hidden = true;
    },

    dispose() {
      root.remove();
      overlay.remove();
    },
  };

  return hud;
}
