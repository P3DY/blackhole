import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  BOOST,
  CAMERA_DISTANCE,
  CAMERA_ELEVATION,
  CAPTURES_PER_FRAME,
  DISK_CAPACITY,
  DRAG,
  EINSTEIN,
  FEED_TIME,
  FLEE_RANGE,
  FULL_FEED,
  HINTS,
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
  RIVAL_APPETITE,
  RIVAL_PACE,
  SHADOW_SIZE,
  STAR_SIZE,
  START_MASS,
  THRUST,
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
  starFragmentShader,
} from './shaders.js';
import { planUniverse } from './universe.js';
import { buildFields } from './fields.js';
import { queryGrid } from './grid.js';
import { createHole, dangerRadius, planarDistance, spiralIn, warpToward } from './holes.js';
import { createDisk } from './disk.js';
import { createJets } from './jets.js';
import { createHud, formatMass } from './hud.js';
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

  // Rings mark how close you can get to a black hole that outweighs you.
  const ringGeometry = new THREE.RingGeometry(0.97, 1, 128).rotateX(-Math.PI / 2);
  for (const hole of holes) {
    if (hole === player) continue;
    hole.ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: '#ff4040',
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(hole.ring);
  }

  const stats = { time: 0, stars: 0, cores: 0, rivals: 0, peakMass: START_MASS };
  let won = false;
  let hintsShown = 0;

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
    if (!event.repeat && KEYS.restart.includes(event.code)) reset();
  }
  const onKeyUp = (event) => pressed.delete(event.code);
  const onBlur = () => pressed.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const hud = createHud({ cores: cores.length, rivals: rivals.length }, () => reset());

  // --- Game state ---------------------------------------------------------------

  function reset() {
    for (const field of fields) {
      field.alive.fill(1);
      field.remaining = field.count;
      field.aliveAttribute.clearUpdateRanges(); // upload the whole thing
      field.aliveAttribute.needsUpdate = true;
      field.points.visible = true;
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
        noticedAt: -Infinity,
      });
      hole.velocity.set(0, 0, 0);
      hole.thrust.set(0, 0, 0);
      hole.edible = hole.mass < START_MASS;
    }
    player.position.set(plan.start.x, 0, plan.start.z);
    cores.forEach((core, i) => core.position.set(plan.galaxies[i].x, 0, plan.galaxies[i].z));
    rivals.forEach((rival, i) => {
      const { x, z, home } = plan.rivals[i];
      rival.position.set(x, 0, z);
      rival.ai = { mode: 'feed', galaxy: home, timer: -20 * Math.random(), rest: 0 }; // staggered, so they don't all move on at once
    });

    disk.clear();
    jets.clear();
    Object.assign(stats, { time: 0, stars: 0, cores: 0, rivals: 0, peakMass: START_MASS });
    won = false;
    hintsShown = 0;

    // Start looking along the galaxy's spiral, so "forward" sweeps through stars rather than into the core.
    const home = plan.galaxies[0];
    const behind = new THREE.Vector3(plan.start.z - home.z, 0, home.x - plan.start.x).normalize();
    const distance = CAMERA_DISTANCE * REACH * player.shadow;
    camera.position
      .copy(player.position)
      .addScaledVector(behind, Math.cos(CAMERA_ELEVATION) * distance)
      .add(new THREE.Vector3(0, Math.sin(CAMERA_ELEVATION) * distance, 0));
    controls.target.copy(player.position);
    controls.update();
    cameraScale = REACH * player.shadow;

    hud.hideOverlay();
    hud.clearToasts();
  }

  // `victim` starts spiralling into `eater`.
  function fall(victim, eater) {
    victim.state = 'falling';
    victim.eater = eater;
    victim.fallFrom = Math.max(planarDistance(victim.position, eater.position), 1e-6);
    victim.thrust.set(0, 0, 0);
  }

  function swallow(victim, eater) {
    victim.state = 'gone';
    victim.size = 0;
    eater.mass += victim.mass;

    // Anything still falling into the victim, and its accretion disk, now belongs to the eater.
    for (const hole of holes) if (hole.eater === victim && hole.state === 'falling') hole.eater = eater;
    disk.transfer(victim.index, eater.index);

    const gain = formatMass(victim.mass);
    if (eater === player) {
      if (victim.kind === 'core') stats.cores++;
      else stats.rivals++;
      hud.toast(`Swallowed ${victim.kind === 'core' ? `the <b>${victim.name}</b> core` : `<b>${victim.name}</b>`} · +${gain}`);
    } else if (victim === player) {
      hud.showGameOver(eater, stats);
    } else if (eater.kind === 'core') {
      hud.toast(`<b>${victim.name}</b> fell into the <b>${eater.name}</b> core`);
    } else {
      hud.toast(`<b>${eater.name}</b> swallowed <b>${victim.name}</b>`);
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
      player.thrust.normalize().multiplyScalar(THRUST * player.shadow * (isDown(KEYS.boost) ? BOOST : 1));
    }
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
      hud.toast(`<b>${rival.name}</b> is hunting you. Hold Shift to outrun it.`);
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

  // Writes a black hole into the lens pass's uniforms, if it's big enough on screen to matter.
  const lenses = lensPass.uniforms.uLenses.value;
  const tanHalfFov = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

  function addLens(position, shadow, brightness) {
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

    update(elapsed, delta) {
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
        stats.stars += absorbed.count[player.index];
        stats.peakMass = Math.max(stats.peakMass, player.mass);
      }

      // Who outweighs whom, the rings around anything heavier, and how close you are to one.
      let danger = 0;
      for (const hole of holes) {
        if (hole === player) continue;
        const alive = hole.state === 'alive';
        const edible = player.mass > hole.mass;
        if (alive && edible !== hole.edible && player.state === 'alive' && stats.time - hole.noticedAt > 15) {
          if (edible && hole.kind === 'core') hud.toast(`You now outweigh the <b>${hole.name}</b> core. Go take it.`);
          else if (edible) hud.toast(`You now outweigh <b>${hole.name}</b>. Hunt it down.`);
          else if (hole.kind === 'rival') hud.toast(`<b>${hole.name}</b> has grown heavier than you.`);
          hole.noticedAt = stats.time;
        }
        hole.edible = edible;

        const showRing = alive && !edible && player.state === 'alive';
        hole.ring.visible = showRing;
        if (!showRing) continue;
        const radius = dangerRadius(hole, player);
        const distance = planarDistance(hole.position, player.position);
        hole.ring.position.copy(hole.position);
        hole.ring.scale.setScalar(radius);
        hole.ring.material.opacity = 0.7 * (1 - smoothstep(distance, radius * 3, radius * 12));
        danger = Math.max(danger, (radius / Math.max(distance, 1e-6)) ** 2);
      }

      if (!won && player.state === 'alive' && holes.every((hole) => hole === player || hole.state === 'gone')) {
        won = true;
        hud.showVictory(stats);
      }

      if (player.state === 'alive' && hintsShown < HINTS.length && stats.time >= HINTS[hintsShown][0]) {
        hud.toast(HINTS[hintsShown++][1]);
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
      uniforms.uTime.value = elapsed;
      uniforms.uWarpCount.value = warpers.length;
      warpers.forEach((hole, i) => uniforms.uWarps.value[i].set(hole.position.x, hole.position.y, hole.position.z, REACH * hole.size));

      lensPass.uniforms.uLensCount.value = 0;
      lensPass.uniforms.uAspect.value = camera.aspect;
      lensPass.uniforms.uPixel.value = 1 / (window.innerHeight * renderer.getPixelRatio());
      for (const hole of holes) {
        if (hole.state === 'gone') continue;
        const brightness = hole.kind === 'core' ? 0.35 : (hole === player ? 0.5 : 0.4) + 2 * hole.appetite;
        addLens(hole.position, hole.size, brightness);
      }

      hud.update({ camera, player, holes, stats, danger: player.state === 'alive' ? danger : 0 });
    },

    render(delta) {
      composer.render(delta);
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      hud.dispose();
      lensPass.dispose();
      bloomPass.dispose();
      outputPass.dispose();
      composer.dispose();
      disposeObject(scene);
    },
  };
}
