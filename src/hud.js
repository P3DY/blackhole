import * as THREE from 'three';
import './hud.css';

const { clamp, smoothstep } = THREE.MathUtils;

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

// The DOM layer over the canvas: stats panel, danger vignette, labels for nearby black holes, toasts, and the
// end-of-game card. `totals` is { cores, rivals } for the "x / y" counters.
export function createHud(totals, onRestart) {
  const root = document.createElement('div');
  root.className = 'bh';
  root.innerHTML = `
    <div class="bh-vignette"></div>
    <div class="bh-markers"></div>
    <div class="bh-panel">
      <div class="bh-label">Mass</div>
      <div class="bh-mass"></div>
      <div class="bh-meter" title="Feeding rate"><span></span></div>
      <dl>
        <dt>Stars absorbed</dt><dd data-stars></dd>
        <dt>Cores swallowed</dt><dd data-cores></dd>
        <dt>Rivals left</dt><dd data-rivals></dd>
      </dl>
    </div>
    <div class="bh-toasts"></div>`;

  // Its own element, so it can sit above the intro panel.
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
  const stars = $('[data-stars]');
  const coresText = $('[data-cores]');
  const rivalsText = $('[data-rivals]');
  const toasts = $('.bh-toasts');

  // Labels for the nearest few black holes: on screen they sit underneath, off screen they point the way.
  const markers = Array.from({ length: 5 }, () => {
    const element = document.createElement('div');
    element.className = 'bh-marker';
    element.innerHTML = '<i></i><span></span>';
    $('.bh-markers').append(element);
    return { element, arrow: element.querySelector('i'), label: element.querySelector('span'), text: '', width: 0, height: 0 };
  });

  const view = new THREE.Vector3();
  const ndc = new THREE.Vector3();

  function placeMarker(marker, hole, camera, player) {
    const tag = hole.kind === 'rival' ? '<small>rival</small>' : '';
    const weight = hole.edible ? 'prey' : `×${(hole.mass / player.mass).toFixed(1)}`;
    const text = `${tag}${hole.name} · <b>${weight}</b>`;
    if (text !== marker.text) {
      marker.label.innerHTML = text;
      marker.text = text;
      // Measured only when the text changes.
      marker.width = marker.label.offsetWidth;
      marker.height = marker.label.offsetHeight;
    }
    marker.element.classList.toggle('prey', hole.edible);

    view.copy(hole.position).applyMatrix4(camera.matrixWorldInverse);
    ndc.copy(view).applyMatrix4(camera.projectionMatrix);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const onScreen = view.z < 0 && Math.abs(ndc.x) < 0.94 && Math.abs(ndc.y) < 0.9;
    marker.element.classList.toggle('offscreen', !onScreen);

    let x;
    let y;
    if (onScreen) {
      x = (ndc.x * 0.5 + 0.5) * width;
      y = (-ndc.y * 0.5 + 0.5) * height + 22;
    } else {
      // Camera-space x/y points the same way on screen, and still makes sense for things behind you.
      const margin = 48;
      const dx = view.x || 1e-6;
      const dy = view.y || 1e-6;
      const t = Math.min((width / 2 - margin) / Math.abs(dx), (height / 2 - margin) / Math.abs(dy));
      x = width / 2 + dx * t;
      y = height / 2 - dy * t;

      // The arrow sits on the side of the label it points to.
      const angle = Math.atan2(-dy, dx);
      const ax = Math.cos(angle) * (marker.width / 2 + 10);
      const ay = Math.sin(angle) * (marker.height / 2 + 10);
      marker.arrow.style.transform = `translate(-50%, -50%) translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px) rotate(${angle}rad)`;
    }

    // Keep the whole label on screen.
    const half = marker.width / 2 + 8;
    x = clamp(x, half, width - half);
    marker.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
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
    update({ camera, player, holes, stats, danger }) {
      mass.textContent = formatMass(player.mass);
      meter.style.width = `${(player.appetite * 100).toFixed(1)}%`;
      stars.textContent = stats.stars.toLocaleString();
      coresText.textContent = `${stats.cores} / ${totals.cores}`;
      rivalsText.textContent = holes.filter((hole) => hole.kind === 'rival' && hole.state === 'alive').length;
      vignette.style.opacity = smoothstep(danger, 0.2, 1).toFixed(3);

      const nearest = holes
        .filter((hole) => hole !== player && hole.state === 'alive')
        .sort((a, b) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position));
      markers.forEach((marker, i) => {
        const hole = player.state === 'alive' ? nearest[i] : undefined;
        marker.element.hidden = !hole;
        marker.element.classList.toggle('rival', hole?.kind === 'rival');
        if (hole) placeMarker(marker, hole, camera, player);
      });
    },

    // `html` is trusted markup built by the game (names in <b>), never user input.
    toast(html) {
      const toast = document.createElement('div');
      toast.className = 'bh-toast';
      toast.innerHTML = html;
      toast.addEventListener('animationend', () => toast.remove());
      toasts.append(toast);
      while (toasts.children.length > 3) toasts.firstChild.remove();
    },

    clearToasts() {
      toasts.replaceChildren();
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
