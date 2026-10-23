import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  BOOST,
  BOOST_COST,
  CAMERA_DISTANCE,
  CAMERA_ELEVATION,
  CAPTURES_PER_FRAME,
  CHECKPOINT,
  DISK_CAPACITY,
  DRAG,
  EINSTEIN,
  FEED_TIME,
  FLEE_RANGE,
  FULL_FEED,
  HAWKING,
  HUNT_GIVE_UP,
  HUNT_PREY,
  HUNT_RANGE,
  HUNT_REST,
  HUNT_TIME,
  KEYS,
  MAX_LENSES,
  MAX_WARPS,
  PULL,
  REACH,
  RINGS,
  RIVAL_APPETITE,
  RIVAL_PACE,
  SHADOW_SIZE,
  SIDE_CHANGE,
  STAR_SIZE,
  START_MASS,
  THRUST,
  TINTS,
  UNIVERSE_SEED,
  arrivalMass,
  shadowOf,
} from './config.js';
import {
  diskVertexShader,
  fieldVertexShader,
  jetVertexShader,
  lensFragmentShader,
  passVertexShader,
  ringFragmentShader,
  ringVertexShader,
  starFragmentShader,
} from './shaders.js';
import { planUniverse } from './universe.js';
import { buildFields } from './fields.js';
import { queryGrid } from './grid.js';
import { createHole, dangerRadius, planarDistance, spiralIn, warpToward } from './holes.js';
import { createDisk } from './disk.js';
import { createJets } from './jets.js';
import { createHud } from './hud.js';
import { createHints } from './hints.js';
import { createPointer } from './pointer.js';
import { createAudio } from './audio.js';
import { createSettings } from './settings.js';
import { createStarfield, disposeObject, mulberry32 } from './utils.js';

const { clamp, damp, smoothstep } = THREE.MathUtils;

const HANDLED_KEYS = new Set(Object.values(KEYS).flat());

// Builds the whole game into a new scene and takes over the camera and controls it's given.
// Call update() then render() every frame, and dispose() to tear it all down.
export function createGame({ renderer, camera, controls }) {
  controls.enablePan = false; // the camera stays on the black hole
  controls.minPolarAngle = 0.15; // straight down would leave no "forward" to steer by
  controls.maxPolarAngle = Math.PI * 0.47;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020207);

  // Distant stars ride along with the camera, so they read as infinitely far away.
  const backdrop = createStarfield(3000, 400);
  backdrop.material.depthWrite = false;
  scene.add(backdrop);

  const random = mulberry32(UNIVERSE_SEED);
  const plan = planUniverse(random);
  const pixelRatio = renderer.getPixelRatio();

  const particleMaterial = (vertexShader, uniforms) =>
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: starFragmentShader,
      uniforms: { uSize: { value: STAR_SIZE * pixelRatio }, ...uniforms },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

  const starMaterial = particleMaterial(fieldVertexShader, {
    uTime: { value: 0 },
    uWarps: { value: Array.from({ length: MAX_WARPS }, () => new THREE.Vector4()) },
    uWarpCount: { value: 0 },
  });

  const fields = buildFields(plan, random, starMaterial);
  for (const field of fields) scene.add(field.points);

  const disk = createDisk(particleMaterial(diskVertexShader));
  scene.add(disk.points);

  const jets = createJets(particleMaterial(jetVertexShader));
  scene.add(jets.points);

  // --- Black holes --------------------------------------------------------------
  //
  // You, the rivals and the galaxy cores all follow the same rules: everything pulls on whatever roams,
  // anything that crosses a heavier black hole's shadow is swallowed, and a roaming black hole captures
  // lighter ones within its reach. Cores stay put, and only you can take one.

  const player = createHole('player', 'You', START_MASS);
  const rivals = plan.rivals.map((rival) => createHole('rival', rival.name, rival.mass));
  const cores = plan.galaxies.map((galaxy) => createHole('core', galaxy.name, galaxy.coreMass));
  const roamers = [player, ...rivals]; // you first, so you win ties over stars
  const holes = [...roamers, ...cores];
  holes.forEach((hole, index) => (hole.index = index));

  // Every black hole shows which side of you it's on. Its photon ring is tinted, and near you it gets a ring:
  // solid red at how close you can get to it if it outweighs you, dashed blue around it if you outweigh it.
  // While a hint explains a lighter one, another ring shows your reach.
  const ringGeometry = new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2); // ringFragmentShader draws the ring
  const ringMaterial = (color) =>
    new THREE.ShaderMaterial({
      vertexShader: ringVertexShader,
      fragmentShader: ringFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0 },
        uWidth: { value: RINGS.width * pixelRatio },
        uDashes: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  const DANGER_COLOR = new THREE.Color(RINGS.heavier);
  const PREY_COLOR = new THREE.Color(RINGS.lighter);
  for (const hole of holes) {
    if (hole === player) continue;
    hole.ring = new THREE.Mesh(ringGeometry, ringMaterial(DANGER_COLOR));
    scene.add(hole.ring);
  }
  const reachRing = new THREE.Mesh(ringGeometry, ringMaterial('#cfe0ff'));
  reachRing.visible = false;
  scene.add(reachRing);

  const stats = { time: 0, stars: 0, cores: 0, rivals: 0, peakMass: START_MASS };
  let won = false;
  // Each core or rival you swallow saves a checkpoint, once it's safe, and retry() goes back to the last one.
  let checkpoint = null;
  let pending = null; // what you swallowed, while its checkpoint waits for a safe moment
  // Hints can slow the game right down. Everything but the hints and the sound runs on the scaled time.
  let timeScale = 1;
  let timeLost = 0; // real seconds the slow motion has cost, so the stars twinkle on game time too

  // --- Post-processing ----------------------------------------------------------

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const lensPass = new ShaderPass(
    new THREE.ShaderMaterial({
      vertexShader: passVertexShader,
      fragmentShader: lensFragmentShader,
      uniforms: {
        tDiffuse: { value: null },
        uLenses: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uTints: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Color()) },
        uLensCount: { value: 0 },
        uAspect: { value: 1 },
        uPixel: { value: 0.001 },
      },
    }),
  );
  composer.addPass(lensPass);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.4, 0.55);
  composer.addPass(bloomPass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const onResize = () => composer.setSize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', onResize);

  // --- Input --------------------------------------------------------------------

  const pressed = new Set();
  const isDown = (codes) => codes.some((code) => pressed.has(code));
  const axis = (positive, negative) => (isDown(positive) ? 1 : 0) - (isDown(negative) ? 1 : 0);

  function onKeyDown(event) {
    if (!HANDLED_KEYS.has(event.code)) return;
    event.preventDefault();
    pressed.add(event.code);
    if (!event.repeat && KEYS.retry.includes(event.code)) retry();
    if (!event.repeat && KEYS.mute.includes(event.code)) audio.toggleMute();
  }
  const onKeyUp = (event) => pressed.delete(event.code);
  const onBlur = () => pressed.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // The settings menu, where the HUD (the Game tab), the audio and then the touch controls add their tabs.
  const settings = createSettings();

  const hud = createHud({ totals: { cores: cores.length, rivals: rivals.length }, settings, onRetry: retry, onStartOver: startOver });

  const audio = createAudio({ camera, settings });

  const pointer = createPointer({ camera, controls, element: renderer.domElement, settings });

  const hints = createHints({ controls });

  // --- Game state ---------------------------------------------------------------

  // Back to the last checkpoint, or the start if there isn't one yet (R, or Retry).
  function retry() {
    if (checkpoint) restore(checkpoint);
    else reset();
  }

  // Back to the start, forgetting the checkpoint.
  function startOver() {
    checkpoint = null;
    hud.setCheckpoint(null);
    reset();
  }

  // After the stars' alive flags have all been rewritten: upload them whole.
  function reload(field) {
    field.aliveAttribute.clearUpdateRanges();
    field.aliveAttribute.needsUpdate = true;
    field.points.visible = field.remaining > 0;
    field.dirtyMin = Infinity;
    field.dirtyMax = -1;
  }

  // Everything as it was at the start. A checkpoint, if there is one, is kept.
  function reset() {
    for (const field of fields) {
      field.alive.fill(1);
      field.remaining = field.count;
      reload(field);
    }

    for (const hole of holes) {
      Object.assign(hole, {
        mass: hole.startMass,
        shadow: shadowOf(hole.startMass),
        size: shadowOf(hole.startMass),
        state: 'alive',
        eater: null,
        feedRate: 0,
        appetite: 0,
        jetsDue: 0,
        boosting: false,
        flash: 0,
        cuedAt: -Infinity,
      });
      hole.velocity.set(0, 0, 0);
      hole.thrust.set(0, 0, 0);
      hole.edible = hole.mass < START_MASS;
      hole.tint.copy(tintOf(hole));
    }
    player.position.set(plan.start.x, 0, plan.start.z);
    cores.forEach((core, i) => core.position.set(plan.galaxies[i].x, 0, plan.galaxies[i].z));
    rivals.forEach((rival, i) => {
      const { x, z, home } = plan.rivals[i];
      rival.position.set(x, 0, z);
      rival.ai = { mode: 'feed', galaxy: home, timer: -20 * Math.random(), rest: 0 }; // staggered, so they don't all move on at once
    });

    disk.clear();
    Object.assign(stats, { time: 0, stars: 0, cores: 0, rivals: 0, peakMass: START_MASS });
    won = false;

    // Start looking along the galaxy's spiral, so "forward" sweeps through stars rather than into the core.
    const home = plan.galaxies[0];
    const behind = new THREE.Vector3(plan.start.z - home.z, 0, home.x - plan.start.x).normalize();
    const distance = CAMERA_DISTANCE * REACH * player.shadow;
    offset
      .copy(behind)
      .multiplyScalar(Math.cos(CAMERA_ELEVATION) * distance)
      .setY(Math.sin(CAMERA_ELEVATION) * distance);
    resume(offset, REACH * player.shadow);
  }

  // What a hole's checkpoint keeps besides where it is and where it's heading. Its eater is kept by index.
  const SAVED = ['mass', 'shadow', 'size', 'state', 'fallFrom', 'feedRate', 'appetite', 'edible', 'cuedAt'];

  // Saves everything that changes as you play: which stars are left, every black hole, the disks and the
  // stats. Holds on to the camera's angle and zoom too. A few megabytes, so only the last one is kept.
  function saveCheckpoint(victim) {
    pending = null;
    checkpoint = {
      name: victim.name,
      kind: victim.kind,
      fields: fields.map(({ alive, remaining, angle }) => ({ alive: alive.slice(), remaining, angle })),
      holes: holes.map((hole) => ({
        ...Object.fromEntries(SAVED.map((key) => [key, hole[key]])),
        eater: hole.eater ? hole.eater.index : -1,
        position: hole.position.clone(),
        velocity: hole.velocity.clone(),
        ai: hole.ai && { ...hole.ai },
      })),
      disk: disk.save(),
      stats: { ...stats },
      won,
      view: new THREE.Vector3().subVectors(camera.position, controls.target),
      cameraScale,
    };
    hud.noteCheckpoint(checkpoint);
  }

  // Everything as it was at `saved`, a checkpoint.
  function restore(saved) {
    saved.fields.forEach((state, i) => {
      const field = fields[i];
      field.alive.set(state.alive);
      field.remaining = state.remaining;
      field.angle = state.angle;
      field.points.rotation.y = state.angle;
      reload(field);
    });

    saved.holes.forEach((state, i) => {
      const hole = holes[i];
      for (const key of SAVED) hole[key] = state[key];
      Object.assign(hole, { eater: state.eater < 0 ? null : holes[state.eater], jetsDue: 0, boosting: false, flash: 0 });
      hole.position.copy(state.position);
      hole.velocity.copy(state.velocity);
      hole.thrust.set(0, 0, 0);
      if (state.ai) hole.ai = { ...state.ai };
      hole.tint.copy(tintOf(hole));
    });

    disk.load(saved.disk);
    Object.assign(stats, saved.stats);
    won = saved.won;
    resume(saved.view, saved.cameraScale);
  }

  // What starting and retrying share: the camera goes to you, `view` (camera minus target) at `scale` (the
  // camera's zoom, see update()), and the jets, the end card, any slowed moment and the sound start afresh.
  // A checkpoint still waiting to be saved is dropped, since what you swallowed is back.
  function resume(view, scale) {
    pending = null;
    controls.target.copy(player.position);
    camera.position.copy(player.position).add(view);
    controls.update();
    cameraScale = scale;

    jets.clear();
    hud.hideOverlay();
    hints.reset();
    pointer.recentre();
    timeScale = 1;
    audio.reset();
  }

  // `victim` starts spiralling into `eater`.
  function fall(victim, eater) {
    victim.state = 'falling';
    victim.eater = eater;
    victim.fallFrom = Math.max(planarDistance(victim.position, eater.position), 1e-6);
    victim.thrust.set(0, 0, 0);
    if (victim === player) audio.fall();
    else if (eater === player) audio.pull(victim.mass / player.mass);
  }

  function swallow(victim, eater) {
    victim.state = 'gone';
    victim.size = 0;
    eater.mass += victim.mass;

    // Anything still falling into the victim, and its accretion disk, now belongs to the eater.
    for (const hole of holes) if (hole.eater === victim && hole.state === 'falling') hole.eater = eater;
    disk.transfer(victim.index, eater.index);

    if (eater === player) {
      if (victim.kind === 'core') stats.cores++;
      else stats.rivals++;
      audio.devour(victim.mass / eater.mass);
      pending = victim;
    } else if (victim === player) {
      hud.showGameOver(eater, stats, checkpoint);
      audio.swallowed();
    } else {
      audio.distant(eater.position, player);
    }
  }

  // --- Capture ------------------------------------------------------------------

  const spot = new THREE.Vector3();
  const warpers = []; // roaming black holes, in the order their warps are applied

  // The vertex shader's gravity warps, for one point (mutated in place).
  function warpAll(point) {
    for (const hole of warpers) warpToward(point, hole.position, REACH * hole.size);
  }

  // Moves a star from its field into `hole`'s accretion disk, starting from where the warps drew it.
  function capture(field, i, cos, sin, hole) {
    const k = i * 3;
    const lx = field.positions[k];
    const lz = field.positions[k + 2];
    spot.set(field.x + cos * lx + sin * lz, field.positions[k + 1], field.z - sin * lx + cos * lz);

    // The field's rotation carries the star along: v = ω × r.
    const vx = field.spinRate * (spot.z - field.z);
    const vz = -field.spinRate * (spot.x - field.x);
    warpAll(spot);

    // Stars from far bigger galaxies are drawn huge; keep them in proportion to this disk.
    const scale = Math.min(field.scales[i], (3 * hole.shadow) / SHADOW_SIZE);
    disk.add(spot, vx, vz, hole, field.colors, k, scale, field.masses[i]);

    field.alive[i] = 0;
    field.remaining--;
    field.dirtyMin = Math.min(field.dirtyMin, i);
    field.dirtyMax = Math.max(field.dirtyMax, i);
  }

  function captureNearby() {
    let budget = Math.min(CAPTURES_PER_FRAME, DISK_CAPACITY - disk.count);

    for (const hole of warpers) {
      const reach = REACH * hole.size;
      for (const field of fields) {
        if (budget <= 0) break;
        if (field.remaining === 0) continue;

        const dx = hole.position.x - field.x;
        const dz = hole.position.z - field.z;
        if (dx * dx + dz * dz > (field.grid.radius + reach) ** 2) continue;

        // Into the field's local space, undoing its rotation (rotation.y = angle).
        const cos = Math.cos(field.angle);
        const sin = Math.sin(field.angle);
        queryGrid(field, dx * cos - dz * sin, dx * sin + dz * cos, reach, (i) => {
          capture(field, i, cos, sin, hole);
          return --budget > 0;
        });
      }
    }

    // Upload only the stretch of the alive flags that changed.
    for (const field of fields) {
      if (field.dirtyMax < 0) continue;
      field.aliveAttribute.addUpdateRange(field.dirtyMin, field.dirtyMax - field.dirtyMin + 1);
      field.aliveAttribute.needsUpdate = true;
      field.points.visible = field.remaining > 0;
      field.dirtyMin = Infinity;
      field.dirtyMax = -1;
    }
  }

  // --- Movement -----------------------------------------------------------------

  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const projected = new THREE.Vector3();
  let cameraScale = REACH * player.shadow;

  function steer() {
    // Relative to the camera: "forward" is wherever the camera looks, flattened onto the galactic plane.
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, up);
    player.thrust
      .set(0, 0, 0)
      .addScaledVector(forward, axis(KEYS.forward, KEYS.back))
      .addScaledVector(right, axis(KEYS.right, KEYS.left));
    if (player.thrust.lengthSq() > 0) {
      player.thrust.normalize();
      pointer.yieldToKeys();
    } else {
      pointer.steer(player.position, forward, right, player.thrust); // 0–1, by how far the pointer pushes
    }
    // Boosting only burns mass while you're actually pushing.
    player.boosting = (isDown(KEYS.boost) || pointer.boost) && player.thrust.lengthSq() > 0;
    player.thrust.multiplyScalar(THRUST * player.shadow * (player.boosting ? BOOST : 1));
  }

  // Thrust, drag and every other black hole's gravity, in small steps so close passes stay accurate.
  function move(mover, delta) {
    const steps = 4;
    const h = delta / steps;
    const { position, velocity, thrust } = mover;
    const reach = REACH * mover.size;

    for (let step = 0; step < steps; step++) {
      let ax = thrust.x - DRAG * velocity.x;
      let az = thrust.z - DRAG * velocity.z;

      for (const other of holes) {
        if (other === mover || other.state !== 'alive') continue;
        const dx = other.position.x - position.x;
        const dz = other.position.z - position.z;
        const distance = Math.hypot(dx, dz) || 1e-6;

        if (other.mass > mover.mass) {
          if (distance < other.size) {
            fall(mover, other); // crossed its shadow
            return;
          }
        } else if (distance < reach && (other.kind !== 'core' || mover === player)) {
          fall(other, mover); // within reach of something heavier
          continue;
        }

        const pull = (PULL * other.size ** 3) / (distance * distance + 0.25 * other.size * other.size);
        ax += (dx / distance) * pull;
        az += (dz / distance) * pull;
      }

      velocity.x += ax * h;
      velocity.z += az * h;
      position.x += velocity.x * h;
      position.z += velocity.z * h;
    }
  }

  // Carries a falling black hole along with its eater while it spirals in, then swallows it.
  function sink(hole, delta) {
    const { eater } = hole;
    hole.position.addScaledVector(eater.velocity, delta);
    hole.velocity.copy(eater.velocity);
    const distance = planarDistance(hole.position, eater.position);
    const shrink = clamp(((1.5 * distance + 2 * eater.size) * delta) / Math.max(distance, 1e-6), 0, 1);
    spiralIn(hole.position, eater.position, 3 * delta, shrink);
    if (distance < eater.size * 0.6) swallow(hole, eater);
  }

  // --- Rivals -------------------------------------------------------------------

  // The galaxy a rival should feed on next: plenty of stars left, about its size, not too far away.
  function pickGalaxy(rival) {
    let best = rival.ai.galaxy;
    let bestScore = 0;
    plan.galaxies.forEach((galaxy, index) => {
      const field = fields[index];
      const left = field.remaining / field.count;
      const fit = arrivalMass(galaxy.radius) / rival.mass;
      if (left < 0.25 || fit < 0.25 || fit > 4) return;
      const distance = Math.hypot(galaxy.x - rival.position.x, galaxy.z - rival.position.z);
      const stay = index === rival.ai.galaxy ? 0.3 : 1; // prefer somewhere new
      const score = ((left * galaxy.radius) / (distance + galaxy.radius)) * stay * (0.7 + Math.random() * 0.6);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    return best;
  }

  function setMode(rival, mode) {
    rival.ai.mode = mode;
    rival.ai.timer = 0;
    if (mode === 'travel') rival.ai.galaxy = pickGalaxy(rival);
  }

  // Picks what a rival is doing (feed, travel, hunt you or flee from you) and sets its thrust.
  function think(rival, delta) {
    const { ai } = rival;
    ai.timer += delta;
    ai.rest = Math.max(0, ai.rest - delta);
    const reach = REACH * rival.size;
    const toPlayer = planarDistance(rival.position, player.position);
    const playerAlive = player.state === 'alive';

    if (playerAlive && player.mass > rival.mass && toPlayer < REACH * player.size * FLEE_RANGE) {
      if (ai.mode !== 'flee') setMode(rival, 'flee');
    } else if (ai.mode === 'flee') {
      setMode(rival, 'travel');
    } else if (ai.mode === 'hunt') {
      const lost = toPlayer > reach * HUNT_GIVE_UP || ai.timer > HUNT_TIME;
      if (!playerAlive || player.mass > rival.mass * 0.95 || lost) {
        ai.rest = HUNT_REST;
        setMode(rival, 'travel');
      }
    } else if (
      playerAlive &&
      ai.rest === 0 &&
      player.mass < rival.mass * 0.9 &&
      player.mass > rival.mass * HUNT_PREY &&
      toPlayer < reach * HUNT_RANGE
    ) {
      setMode(rival, 'hunt');
    }

    const galaxy = plan.galaxies[ai.galaxy];
    const gx = rival.position.x - galaxy.x;
    const gz = rival.position.z - galaxy.z;
    const fromCenter = Math.hypot(gx, gz) || 1e-6;

    if (ai.mode === 'hunt') {
      aim.copy(player.position).addScaledVector(player.velocity, 0.4).sub(rival.position); // lead the target
    } else if (ai.mode === 'flee') {
      aim.subVectors(rival.position, player.position).normalize();
      const weave = 0.5 * Math.sin(ai.timer * 1.3); // so it isn't a straight line to run down
      aim.set(aim.x - aim.z * weave, 0, aim.z + aim.x * weave);
    } else if (ai.mode === 'travel') {
      aim.set(-gx, 0, -gz);
      if (fromCenter < galaxy.radius * 0.8) setMode(rival, 'feed');
    } else {
      // Feed: circle the galaxy, tightening the orbit, but never close to a heavier core.
      const core = cores[ai.galaxy];
      const coreDanger = core.state === 'alive' && core.mass > rival.mass ? dangerRadius(core, rival, RIVAL_PACE.feed) : 0;
      const floor = Math.max(galaxy.radius * 0.12, coreDanger * 3);
      const want = Math.max(floor, galaxy.radius * (0.75 - Math.max(ai.timer, 0) * 0.015));
      const radial = clamp((want - fromCenter) / want, -1.5, 1.5) * 2;
      aim.set((gz + gx * radial) / fromCenter, 0, (-gx + gz * radial) / fromCenter);
      const field = fields[ai.galaxy];
      if (ai.timer > FEED_TIME || field.remaining < field.count * 0.2) setMode(rival, 'travel');
    }
    aim.y = 0;
    aim.normalize();

    // Steer clear of anything heavier: a push that grows as it gets closer.
    const pace = RIVAL_PACE[ai.mode];
    for (const other of holes) {
      if (other === rival || other.state !== 'alive' || other.mass <= rival.mass) continue;
      const keepOut = 2 * dangerRadius(other, rival, pace);
      const dx = rival.position.x - other.position.x;
      const dz = rival.position.z - other.position.z;
      const distance = Math.hypot(dx, dz) || 1e-6;
      const push = 3 * clamp((2 * keepOut - distance) / keepOut, 0, 2);
      aim.x += (dx / distance) * push;
      aim.z += (dz / distance) * push;
    }

    rival.thrust.copy(aim).normalize().multiplyScalar(THRUST * rival.size * pace);
  }

  // --- Rendering helpers --------------------------------------------------------

  const PHOTON = { you: new THREE.Color(TINTS.you), heavier: new THREE.Color(TINTS.heavier), lighter: new THREE.Color(TINTS.lighter) };

  // The color `hole`'s photon ring is heading for: which side of you it's on, or neutral once you're gone.
  function tintOf(hole) {
    if (hole === player || player.state !== 'alive') return PHOTON.you;
    return hole.edible ? PHOTON.lighter : PHOTON.heavier;
  }

  // Writes a black hole into the lens pass's uniforms, if it's big enough on screen to matter.
  const lenses = lensPass.uniforms.uLenses.value;
  const tints = lensPass.uniforms.uTints.value;
  const tanHalfFov = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

  // The smallest radius a ring at `position` can have and still be RINGS.minPixels across on screen.
  function leastRingRadius(position) {
    const depth = -projected.copy(position).applyMatrix4(camera.matrixWorldInverse).z;
    return depth > camera.near ? (2 * RINGS.minPixels * depth * tanHalfFov()) / window.innerHeight : 0;
  }

  function addLens(position, shadow, brightness, tint) {
    const count = lensPass.uniforms.uLensCount;
    if (count.value >= MAX_LENSES || shadow <= 0) return;

    projected.copy(position).applyMatrix4(camera.matrixWorldInverse);
    const depth = -projected.z;
    if (depth <= camera.near) return;

    const radius = (0.5 * shadow) / (depth * tanHalfFov()); // fraction of screen height
    if (radius * window.innerHeight < 0.4) return;

    projected.applyMatrix4(camera.projectionMatrix);
    const u = projected.x * 0.5 + 0.5;
    const v = projected.y * 0.5 + 0.5;
    const margin = radius * EINSTEIN * 14; // where its deflection fades out
    if (u < -margin / camera.aspect || u > 1 + margin / camera.aspect || v < -margin || v > 1 + margin) return;

    tints[count.value].copy(tint);
    lenses[count.value++].set(u, v, radius, brightness);
  }

  // Whatever has (eventually) swallowed this black hole, or the hole itself if it's still around.
  function survivorOf(hole) {
    let survivor = hole;
    while (survivor.state !== 'alive' && survivor.eater) survivor = survivor.eater;
    return survivor;
  }

  reset();

  // --- Frame --------------------------------------------------------------------

  return {
    scene,

    update(elapsed, frameDelta) {
      const delta = frameDelta * timeScale;
      timeLost += frameDelta - delta;
      if (player.state === 'alive') stats.time += delta;

      // Sizes ease toward what the mass calls for; falling black holes shrink as they near their eater.
      for (const hole of holes) {
        hole.shadow = damp(hole.shadow, shadowOf(hole.mass), 4, delta);
        if (hole.state === 'alive') hole.size = hole.shadow;
        else if (hole.state === 'falling') {
          const progress = planarDistance(hole.position, hole.eater.position) / hole.fallFrom;
          hole.size = hole.shadow * Math.sqrt(clamp(progress, 0, 1));
        }
      }

      if (player.state === 'alive') steer();
      for (const rival of rivals) if (rival.state === 'alive') think(rival, delta);
      for (const hole of roamers) if (hole.state === 'alive') move(hole, delta);
      for (const hole of holes) if (hole.state === 'falling') sink(hole, delta);

      for (const field of fields) {
        field.angle += field.spinRate * delta;
        field.points.rotation.y = field.angle;
      }

      warpers.length = 0;
      for (const hole of roamers) if (hole.state === 'alive' && warpers.length < MAX_WARPS) warpers.push(hole);
      captureNearby();

      // Feeding: rivals keep only part of what they swallow.
      const absorbed = disk.update(delta, holes);
      for (const hole of holes) {
        const mass = absorbed.mass[hole.index];
        hole.mass += mass * (hole.kind === 'rival' ? RIVAL_APPETITE : 1);
        hole.feedRate = damp(hole.feedRate, mass / Math.max(delta, 1e-4), 3, delta);
        const roaming = hole.state === 'alive' && hole.kind !== 'core';
        hole.appetite = roaming ? clamp(hole.feedRate / hole.mass / FULL_FEED, 0, 1) : 0;
        if (roaming) jets.emit(hole, delta);
      }
      jets.update(delta);
      if (player.state === 'alive') {
        // Hawking radiation, plus the cost of boosting.
        player.mass *= Math.exp(-(HAWKING + (player.boosting ? BOOST_COST : 0)) * delta);
        stats.stars += absorbed.count[player.index];
        stats.peakMass = Math.max(stats.peakMass, player.mass);
      }

      // Who outweighs whom, and how close you are to anything heavier. Photon rings take on the tint of their
      // side of you, and near you each black hole gets a ring: red at the danger radius of anything heavier,
      // dashed blue around anything lighter. A hint lights up the black hole it's explaining (last frame's,
      // which is close enough).
      let danger = 0;
      let sideChange = null; // whether the black hole that just changed sides is now prey, if one did
      const hint = hints.focus;
      const playing = player.state === 'alive';
      const reach = REACH * player.size;
      for (const hole of holes) {
        if (hole === player) continue;
        const edible = player.mass > hole.mass;
        const alive = hole.state === 'alive';
        const distance = planarDistance(hole.position, player.position);
        const near = 1 - smoothstep(distance, reach * RINGS.range[0], reach * RINGS.range[1]);

        // Changing sides near you: its ring flares, and a tone rises (now prey) or falls (now a threat).
        if (edible !== hole.edible && alive && playing && near > 0 && stats.time - hole.cuedAt > SIDE_CHANGE.cooldown) {
          hole.flash = 1;
          hole.cuedAt = stats.time;
          sideChange ??= edible;
        }
        hole.edible = edible;
        hole.flash = Math.max(0, hole.flash - frameDelta / SIDE_CHANGE.flash);
        hole.tint.lerp(tintOf(hole), 1 - Math.exp(-6 * frameDelta));

        let radius = RINGS.prey * hole.size;
        let opacity = RINGS.floor * near;
        if (!edible) {
          radius = dangerRadius(hole, player);
          opacity = Math.max(0.7 * (1 - smoothstep(distance, radius * 3, radius * 12)), opacity);
          if (alive) danger = Math.max(danger, (radius / Math.max(distance, 1e-6)) ** 2);
        }
        const lit = hint?.hole === hole ? hint.glow : 0;
        opacity = Math.max(opacity, lit, hole.flash);

        const { ring } = hole;
        ring.visible = alive && playing && opacity > 0;
        if (!ring.visible) continue;
        ring.position.copy(hole.position);
        ring.scale.setScalar(Math.max(radius, leastRingRadius(hole.position)) * (1 + 0.25 * hole.flash));
        const { uniforms } = ring.material;
        uniforms.uColor.value.copy(edible ? PREY_COLOR : DANGER_COLOR);
        uniforms.uOpacity.value = opacity;
        uniforms.uDashes.value = edible ? RINGS.dashes : 0;
      }
      if (sideChange !== null) audio.sideChange(sideChange);
      reachRing.visible = hint?.kind === 'lighter' && playing;
      if (reachRing.visible) {
        reachRing.position.copy(player.position);
        reachRing.scale.setScalar(REACH * player.size);
        reachRing.material.uniforms.uOpacity.value = 0.6 * hint.glow;
      }

      if (!won && player.state === 'alive' && holes.every((hole) => hole === player || hole.state === 'gone')) {
        won = true;
        hud.showVictory(stats);
      }

      // A checkpoint for what you last swallowed, once nothing heavier is close and nothing is hunting you.
      if (
        pending &&
        playing &&
        danger < 1 / CHECKPOINT.safe ** 2 &&
        !rivals.some((rival) => rival.state === 'alive' && rival.ai.mode === 'hunt')
      ) {
        saveCheckpoint(pending);
      }

      // --- Camera: follow, and zoom out as you grow (keeping the user's orbit and zoom) ---
      const focus = player.state === 'gone' ? survivorOf(player) : player;
      const viewTarget = REACH * survivorOf(player).shadow;
      const nextScale = damp(cameraScale, viewTarget, 2, delta);
      offset.subVectors(camera.position, controls.target).multiplyScalar(nextScale / cameraScale);
      cameraScale = nextScale;
      controls.target.copy(focus.position);
      camera.position.copy(focus.position).add(offset);
      controls.minDistance = cameraScale * 2.5;
      controls.maxDistance = cameraScale * 40;
      camera.updateMatrixWorld();
      backdrop.position.copy(camera.position);

      // --- Uniforms ---
      const { uniforms } = starMaterial;
      uniforms.uTime.value = elapsed - timeLost;
      uniforms.uWarpCount.value = warpers.length;
      warpers.forEach((hole, i) => uniforms.uWarps.value[i].set(hole.position.x, hole.position.y, hole.position.z, REACH * hole.size));

      lensPass.uniforms.uLensCount.value = 0;
      lensPass.uniforms.uAspect.value = camera.aspect;
      lensPass.uniforms.uPixel.value = 1 / (window.innerHeight * renderer.getPixelRatio());
      for (const hole of holes) {
        if (hole.state === 'gone') continue;
        const brightness = hole.kind === 'core' ? 0.35 : (hole === player ? 0.5 : 0.4) + 2 * hole.appetite;
        addLens(hole.position, hole.size, brightness, hole.tint);
      }

      if (player.state !== 'alive') danger = 0;
      hud.update({ camera, player, holes, danger });
      timeScale = hints.update(frameDelta, { camera, player, holes, touch: pointer.mode });
      audio.update(frameDelta, { player, danger, stars: absorbed.count[player.index], timeScale });
    },

    render(delta) {
      composer.render(delta);
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      pointer.dispose();
      audio.dispose();
      hud.dispose();
      hints.dispose();
      settings.dispose();
      lensPass.dispose();
      bloomPass.dispose();
      outputPass.dispose();
      composer.dispose();
      disposeObject(scene);
    },
  };
}
