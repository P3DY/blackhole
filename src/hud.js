import * as THREE from 'three';
import { DRAG, LABELS, THRUST } from './config.js';
import './hud.css';

const { clamp, smoothstep } = THREE.MathUtils;

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

// How long a trip takes at your unboosted top speed, rounded so it changes rarely: whole seconds under a minute,
// whole minutes after that. In seconds.
function roundTrip(seconds) {
  return seconds < 60 ? Math.max(1, Math.round(seconds)) : 60 * Math.round(seconds / 60);
}
const formatTrip = (seconds) => (seconds < 60 ? `${seconds} s` : `${seconds / 60} min`);

// A black hole's name in a sentence: "the Triangulum core", but "Sagittarius A*" or "Sköll". Works on a
// checkpoint too, which keeps the name and article of what you swallowed.
const called = ({ name, article }) => (article ? `the ${name}` : name);

// The DOM layer over the canvas, kept quiet during play: your mass and feeding rate, a danger vignette, arrows
// at the screen edge toward nearby black holes that are off screen, a compass toward the next place to feed once
// you're starving, a brief note when a checkpoint is saved, and the name of where you are when you first get there.
// Names and distances wait for the look key. Everything else waits for the end-of-game card.
//
// It also adds the Game tab to `settings` (the menu): retry from the last checkpoint, or start over.
// `onRetry` and `onStartOver` do those, from the menu or the end card.
export function createHud({ settings, onRetry, onStartOver }) {
  const root = document.createElement('div');
  root.className = 'bh';
  root.innerHTML = `
    <div class="bh-vignette"></div>
    <div class="bh-markers"><i class="bh-compass bh-fade"></i></div>
    <div class="bh-labels"></div>
    <div class="bh-place"></div>
    <div class="bh-status" hidden><span></span><small></small><i></i></div>
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
  const status = $('.bh-status');
  const statusTitle = $('.bh-status span');
  const statusNote = $('.bh-status small');
  const statusBar = $('.bh-status i');
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
  // The compass: a chevron toward where to feed next (chosen in game.js), shown only while that's off screen, and
  // only once you're starving or holding the look key. It sits further in than the arrows, since a galaxy's core is
  // at its centre and its arrow would cover the chevron.
  const compassMarker = $('.bh-compass');
  const COMPASS_MARGIN = 40;

  // The compass and the labels fade in and out (.bh-fade in hud.css) rather than popping, by a class that's only
  // written when it changes. One fading out stays where it was last placed.
  const fade = (element, on) => {
    if (element.classList.contains('show') !== on) element.classList.toggle('show', on);
  };

  // Small dim labels beside the compass, the nearest heavier black hole's arrow and the nearest lighter one's: a
  // name, and how far in seconds at your top speed. They show while the look key is held, and on their own for
  // LABELS.flash seconds the first time each thing they name comes up (`met`), so a new rival or a new place to
  // head for is introduced once and then left to its arrow. Each keeps what it shows, so it's only written when it
  // changes.
  const labelLayer = $('.bh-labels');
  const makeLabel = (kind) => {
    const element = document.createElement('span');
    element.className = `bh-label bh-fade ${kind}`;
    element.innerHTML = '<b></b><small></small>';
    labelLayer.append(element);
    const label = { element, name: element.firstChild, trip: element.lastChild, of: null, seconds: 0 };
    return Object.assign(label, { met: new WeakSet(), introducing: null, until: 0 });
  };
  const labels = { compass: makeLabel('compass'), threat: makeLabel('threat'), prey: makeLabel('prey') };

  // Where labels may go: the screen less the safe areas and the corners' readouts (see .bh-labels in hud.css),
  // measured only when the window changes size.
  const bounds = { left: 0, top: 0, right: 0, bottom: 0 };
  function measure() {
    const { left, top, right, bottom } = labelLayer.getBoundingClientRect();
    Object.assign(bounds, { left, top, right, bottom });
  }
  measure();
  window.addEventListener('resize', measure);

  const view = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const spot = new THREE.Vector3(); // a galaxy's centre, for the compass
  const edge = { x: 0, y: 0, dx: 0, dy: 0 }; // where the marker last placed went, and which way it points
  // Where this frame's labels went, so the next doesn't land on one: about a line apart, and about as wide as one.
  const LINE = 15;
  const LABEL_WIDTH = 170;
  const placed = Object.values(labels).map(() => ({ x: 0, y: 0 }));
  let placedCount = 0;
  const nearest = []; // the closest few black holes this frame, reused
  const last = { mass: '', meter: '', vignette: '' }; // what's on screen, so it's only written when it changes

  // Keeps the `count` black holes in `holes` nearest to `player` in `nearest`, closest first, without sorting
  // (or copying) the whole list every frame.
  function findNearest(holes, player, count) {
    nearest.length = 0;
    for (const hole of holes) {
      if (hole === player || hole.state !== 'alive') continue;
      const distance = hole.position.distanceToSquared(player.position);
      if (nearest.length === count && distance >= nearest[count - 1].distance) continue;
      let i = Math.min(nearest.length, count - 1);
      if (nearest.length < count) nearest.push(null);
      while (i > 0 && nearest[i - 1].distance > distance) {
        nearest[i] = nearest[i - 1];
        i--;
      }
      nearest[i] = { hole, distance };
    }
  }

  // Pins `marker` to the screen edge (`margin` pixels in), pointing toward `position`, unless that's on screen.
  // Leaves where it went in `edge`, and returns whether it's off screen. An arrow (`hide`) is hidden while its black
  // hole is on screen; the compass is left where it was, to fade.
  function placeMarker(marker, position, camera, margin = 18, hide = true) {
    view.copy(position).applyMatrix4(camera.matrixWorldInverse);
    ndc.copy(view).applyMatrix4(camera.projectionMatrix);
    const onScreen = view.z < 0 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
    if (hide && marker.hidden !== onScreen) marker.hidden = onScreen;
    if (onScreen) return false;

    // Camera-space x/y points the same way on screen, and still makes sense for things behind you.
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dx = view.x || 1e-6;
    const dy = view.y || 1e-6;
    const t = Math.min((width / 2 - margin) / Math.abs(dx), (height / 2 - margin) / Math.abs(dy));
    const x = width / 2 + dx * t;
    const y = height / 2 - dy * t;
    const angle = Math.atan2(-dy, dx);
    marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) rotate(${angle.toFixed(3)}rad)`;
    const length = Math.hypot(dx, dy);
    Object.assign(edge, { x, y, dx: dx / length, dy: -dy / length });
    return true;
  }

  // Puts `label` beside the marker last placed (in `edge`), a little in from it and kept within `bounds`. It hangs
  // off that point toward the middle of the screen (left of it at the right edge, under it at the top), so it never
  // needs measuring. `of` is what it names, `name` how, and `distance` how far, in world units.
  function placeLabel(label, of, name, distance, player) {
    const seconds = roundTrip(distance / ((THRUST / DRAG) * player.size));
    if (label.of !== of) {
      label.of = of;
      label.name.textContent = name;
    }
    if (label.seconds !== seconds) {
      label.seconds = seconds;
      label.trip.textContent = formatTrip(seconds);
    }
    const inset = 16;
    const x = clamp(edge.x - edge.dx * inset, bounds.left, bounds.right);
    let y = clamp(edge.y - edge.dy * inset, bounds.top, bounds.bottom);
    // Two markers side by side would put one label over the other: step this one a line toward the middle.
    const inward = y > (bounds.top + bounds.bottom) / 2 ? -LINE : LINE;
    for (let i = 0; i < placedCount; i++) {
      if (Math.abs(placed[i].x - x) < LABEL_WIDTH && Math.abs(placed[i].y - y) < LINE) {
        y += inward;
        i = -1; // and check again against all of them
      }
    }
    placed[placedCount].x = x;
    placed[placedCount].y = y;
    placedCount++;
    const ax = (-100 * (x - bounds.left)) / Math.max(bounds.right - bounds.left, 1);
    const ay = (-100 * (y - bounds.top)) / Math.max(bounds.bottom - bounds.top, 1);
    label.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${ax.toFixed(1)}%, ${ay.toFixed(1)}%)`;
  }

  // `label` could name `of` this frame, beside the marker last placed. It does while `look` is held, or for a moment
  // the first time `of` comes up; otherwise it fades. `now` is in real seconds, the rest as for placeLabel().
  function offerLabel(label, of, name, distance, player, look, now) {
    if (!label.met.has(of)) {
      label.met.add(of);
      label.introducing = of;
      label.until = now + LABELS.flash;
    }
    const shown = look || (label.introducing === of && now < label.until);
    if (shown) placeLabel(label, of, name, distance, player);
    fade(label.element, shown);
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
    // Holding a touch on the mass readout is the look key on touch screens (see pointer.js).
    lookElement: $('.bh-readout'),

    // `compass` is the galaxy record the compass points to (from game.js), or null while it hides. `starving` is
    // whether you've gone long enough without feeding for it to show, and `look` whether the look key is held.
    update({ camera, player, holes, danger, compass, starving, look }) {
      const now = performance.now() / 1000;
      const text = formatMass(player.mass);
      if (text !== last.mass) mass.textContent = last.mass = text;
      const width = `${(player.appetite * 100).toFixed(1)}%`;
      if (width !== last.meter) meter.style.width = last.meter = width;
      const opacity = smoothstep(danger, 0.2, 1).toFixed(2);
      if (opacity !== last.vignette) vignette.style.opacity = last.vignette = opacity;

      // The compass, labelled first so the arrows' labels make way for it. Its distance is to the galaxy's edge,
      // where the stars start.
      placedCount = 0;
      if (compass) spot.set(compass.x, 0, compass.z);
      const pointing = (starving || look) && compass !== null && placeMarker(compassMarker, spot, camera, COMPASS_MARGIN, false);
      fade(compassMarker, pointing);
      if (pointing) {
        const distance = Math.hypot(compass.x - player.position.x, compass.z - player.position.z) - compass.radius;
        offerLabel(labels.compass, compass, compass.name, Math.max(0, distance), player, look, now);
      } else fade(labels.compass.element, false);

      // Edge arrows, with labels on the nearest heavier and the nearest lighter black hole that are off screen.
      if (player.state === 'alive') findNearest(holes, player, markers.length);
      else nearest.length = 0;
      let threat = false;
      let prey = false;
      markers.forEach((marker, i) => {
        const near = nearest[i];
        if (!near) {
          if (!marker.hidden) marker.hidden = true;
          return;
        }
        const { hole } = near;
        if (!placeMarker(marker, hole.position, camera)) return;
        marker.classList.toggle('prey', hole.edible);
        if (hole.edible ? prey : threat) return;
        if (hole.edible) prey = true;
        else threat = true;
        const label = hole.edible ? labels.prey : labels.threat;
        offerLabel(label, hole, called(hole), Math.sqrt(near.distance), player, look, now);
      });
      if (!threat) fade(labels.threat.element, false);
      if (!prey) fade(labels.prey.element, false);
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

    // A checkpoint has just been saved (or, with another `label`, picked up again after a reload): say so, briefly.
    noteCheckpoint(checkpoint, label = 'Checkpoint') {
      hud.setCheckpoint(checkpoint);
      saved.textContent = `${label} · ${checkpoint.name}`;
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

    // A line in the middle of the screen while the game is paused, or while R is held to retry (`hold`, 0–1, how
    // long it's been held). Neither: hidden.
    setStatus(paused, hold) {
      const show = paused || hold > 0;
      if (status.hidden === show) status.hidden = !show;
      if (!show) return;
      const title = hold > 0 ? 'Retry' : 'Paused';
      if (statusTitle.textContent !== title) {
        statusTitle.textContent = title;
        statusNote.textContent = hold > 0 ? 'keep holding R' : 'P or Esc to carry on';
      }
      statusBar.style.width = `${(Math.min(hold, 1) * 100).toFixed(0)}%`;
    },

    hideOverlay() {
      overlay.hidden = true;
    },

    dispose() {
      clearTimeout(sure);
      window.removeEventListener('resize', measure);
      root.remove();
      overlay.remove();
    },
  };

  hud.setCheckpoint(null);
  return hud;
}
