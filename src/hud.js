import * as THREE from 'three';
import './hud.css';

const { smoothstep } = THREE.MathUtils;

const SCALES = [
  [1e21, 'sextillion'],
  [1e18, 'quintillion'],
  [1e15, 'quadrillion'],
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
];
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

// One unit of mass is a million suns. Past sextillions it's written as a power of ten.
export function formatMass(mass) {
  const solar = mass * 1e6;
  if (solar >= 1e24) {
    const power = Math.floor(Math.log10(solar));
    const digits = [...String(power)].map((digit) => SUPERSCRIPT[digit]).join('');
    return `${(solar / 10 ** power).toFixed(2)} × 10${digits} M☉`;
  }
  const [unit, word] = SCALES.find(([unit]) => solar >= unit) ?? SCALES[SCALES.length - 1];
  const value = solar / unit;
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${word} M☉`;
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A black hole's name in a sentence: "the Triangulum core", but "Sagittarius A*" or "Sköll". Works on a
// checkpoint too, which keeps the name and article of what you swallowed.
const called = ({ name, article }) => (article ? `the ${name}` : name);

// The DOM layer over the canvas, kept quiet during play: your mass and feeding rate, a danger vignette, arrows
// at the screen edge toward nearby black holes that are off screen, a brief note when a checkpoint is saved, and
// the name of where you are when you first get there. Everything else waits for the end-of-game card.
//
// It also adds the Game tab to `settings` (the menu): retry from the last checkpoint, or start over.
// `onRetry` and `onStartOver` do those, from the menu or the end card.
export function createHud({ settings, onRetry, onStartOver }) {
  const root = document.createElement('div');
  root.className = 'bh';
  root.innerHTML = `
    <div class="bh-vignette"></div>
    <div class="bh-markers"></div>
    <div class="bh-place"></div>
    <div class="bh-readout">
      <div class="bh-mass"></div>
      <div class="bh-meter"><span></span></div>
      <div class="bh-saved"></div>
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
  const saved = $('.bh-saved');
  saved.addEventListener('animationend', () => saved.classList.remove('show'));

  // Place names wait their turn, so a new scale and the structure you're entering don't talk over each other.
  const place = $('.bh-place');
  const places = [];
  function nextPlace() {
    place.classList.remove('show', 'scale');
    const next = places.shift();
    if (!next) return;
    place.textContent = next.text;
    place.classList.toggle('scale', next.scale);
    void place.offsetWidth; // restart the animation
    place.classList.add('show');
  }
  place.addEventListener('animationend', nextPlace);

  // --- The Game tab -----------------------------------------------------------------
  //
  // Starting over throws your checkpoint away, so it takes a second press within a few seconds to be sure.

  const page = settings.addTab('Game');
  const retry = settings.addButton(page, 'Retry', 'R', () => {
    settings.close();
    onRetry();
  });
  let sure = 0; // the timeout that stops waiting for the second press
  const startOver = settings.addButton(page, 'Start over', '', () => {
    if (!sure) {
      confirmStartOver(true);
      return;
    }
    confirmStartOver(false);
    settings.close();
    onStartOver();
  });

  function confirmStartOver(value) {
    clearTimeout(sure);
    sure = value ? setTimeout(() => confirmStartOver(false), 4000) : 0;
    startOver.button.classList.toggle('confirm', value);
    startOver.label.textContent = value ? 'Press again to start over' : 'Start over';
  }
  settings.onClose(() => confirmStartOver(false));

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
    ['Cores swallowed', stats.cores.toLocaleString()],
    ['Rivals swallowed', stats.rivals.toLocaleString()],
    ['Largest structures', stats.reached],
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

    // `checkpoint` is the last one saved, if any: { name, kind, stats } (see setCheckpoint).
    showGameOver(eater, stats, checkpoint) {
      let body =
        eater.kind === 'core'
          ? `You crossed the event horizon of ${called(eater)}. It now weighs ${formatMass(eater.mass)}.`
          : `${eater.name} swallowed you. It now weighs ${formatMass(eater.mass)}.`;
      if (checkpoint) body += ` Retry from just after you swallowed ${called(checkpoint)}.`;
      const actions = checkpoint
        ? [
            ['Retry (R)', onRetry],
            ['Start over', onStartOver],
          ]
        : [['Try again (R)', onRetry]];
      showOverlay('Swallowed', body, summary(stats), actions);
    },

    showVictory(stats) {
      const body = 'You outweigh every star, galaxy, cluster and wall in the observable universe.';
      showOverlay('The universe is yours', body, summary(stats), [
        ['Keep drifting', () => hud.hideOverlay()],
        ['Play again', onStartOver],
      ]);
    },

    // Shows what Retry goes back to: `checkpoint` ({ name, kind, stats } of the black hole you swallowed, and
    // the stats then), or null for the start.
    setCheckpoint(checkpoint) {
      retry.note.textContent = checkpoint
        ? `To just after you swallowed ${called(checkpoint)}, at ${formatTime(checkpoint.stats.time)}.`
        : 'From the start. Swallow a core or a rival to save a checkpoint.';
      startOver.note.textContent = checkpoint ? 'Back to the beginning. Your checkpoint is lost.' : 'Back to the beginning.';
    },

    // A checkpoint has just been saved: say so, briefly.
    noteCheckpoint(checkpoint) {
      hud.setCheckpoint(checkpoint);
      saved.textContent = `Checkpoint · ${checkpoint.name}`;
      saved.classList.remove('show');
      void saved.offsetWidth; // restart the animation if the last note is still showing
      saved.classList.add('show');
    },

    // You've reached somewhere new: a galaxy or structure by name, or (`scale`) a new scale of things.
    notePlace(text, scale = false) {
      places.push({ text, scale });
      if (!place.classList.contains('show')) nextPlace();
    },

    // Starting again: forget any names still waiting.
    clearPlaces() {
      places.length = 0;
      nextPlace();
    },

    hideOverlay() {
      overlay.hidden = true;
    },

    dispose() {
      clearTimeout(sure);
      root.remove();
      overlay.remove();
    },
  };

  hud.setCheckpoint(null);
  return hud;
}
