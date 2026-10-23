import * as THREE from 'three';
import { PULL, REACH, THRUST, WARP, shadowOf } from './config.js';

const { smoothstep } = THREE.MathUtils;

// You, the rivals and the galaxy cores are all the same kind of object. `key` names it for good, across
// checkpoints, and `article` says its name reads "the …" in a sentence ("the Triangulum core", but "Sköll").
export function createHole(kind, name, mass, { key = `${kind}:${name}`, article = false } = {}) {
  return {
    kind, // 'player', 'rival' or 'core'
    name,
    key,
    article,
    index: -1, // its slot (see addHole() in game.js); accretion-disk particles refer to their black hole by it
    startMass: mass,
    mass,
    shadow: shadowOf(mass), // eases toward shadowOf(mass), so growth spurts aren't jumps
    size: shadowOf(mass), // the shadow as drawn: shrinks while falling, 0 once gone
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    thrust: new THREE.Vector3(),
    state: 'alive', // → 'falling' (into `eater`) → 'gone'
    eater: null,
    fallFrom: 1,
    feedRate: 0, // mass absorbed per second, smoothed
    appetite: 0, // feedRate as a share of FULL_FEED: drives the photon ring and jets
    jetsDue: 0,
    edible: false, // lighter than you
    tint: new THREE.Color(), // its photon ring's color, easing toward whichever side of you it's on
    ring: null,
    flash: 0, // 1 when it has just changed sides, fading to 0
    cuedAt: -Infinity, // game time it last did
    ai: null, // rivals only: { mode, galaxy, timer, rest }
  };
}

// How close `mover` can get to a heavier `hole` and still get away: where the pull beats its thrust
// (at `pace` of full thrust), or for a roaming black hole, its reach, whichever is further.
export function dangerRadius(hole, mover, pace = 1) {
  const noReturn = Math.sqrt((PULL * hole.size ** 3) / (THRUST * pace * Math.max(mover.size, 1e-6)));
  return hole.kind === 'core' ? noReturn : Math.max(noReturn, REACH * hole.size);
}

export function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Spirals `position` in toward `center`, rotating `turn` radians and shrinking by `shrink` (0..1).
export function spiralIn(position, center, turn, shrink) {
  const x = position.x - center.x;
  const z = position.z - center.z;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  position.x = center.x + (x * cos + z * sin) * (1 - shrink);
  position.z = center.z + (-x * sin + z * cos) * (1 - shrink);
}

// The field vertex shader's gravity warp around one black hole, for one point (mutated in place).
export function warpToward(point, hole, reach) {
  const x = point.x - hole.x;
  const z = point.z - hole.z;
  const pull = 1 - smoothstep(Math.hypot(x, z), reach, reach * WARP.outer);
  if (pull <= 0) return;
  const angle = WARP.twist * pull;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const shrink = 1 - WARP.shrink * pull;
  point.x = hole.x + (x * cos + z * sin) * shrink;
  point.z = hole.z + (-x * sin + z * cos) * shrink;
  point.y = hole.y + (point.y - hole.y) * (1 - WARP.flatten * pull);
}
