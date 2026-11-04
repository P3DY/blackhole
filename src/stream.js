import { STREAM, radiusOf } from './config.js';
import { cellAt, cellsNear } from './cosmos.js';
import { buildCellParts, fieldsOf } from './fields.js';

// The endless universe past the opening (cosmos.js), made real around you. Every cell near enough, and not long
// outgrown, gets a record at once, with its core and maybe a rival. Its star fields take a frame or so to build,
// so a worker (builder.js) makes them and they arrive a few frames later. Cells left far behind or outgrown are
// dropped, but what you changed in them (stars eaten, the core's mass or whether it's gone, whether its rival
// came out) is kept as a delta, so a cell built again is as you left it.
//
// The game hears about records through `onBuild(record, delta)` (make its core, and maybe its rival),
// `onFold(record, delta)` (note the core's state in the delta) and `onDrop(record)` (let go of the core).
// `fields` is the game's list of every field; the streamer adds its own to it and takes them out again.
//
// If the worker can't be started or fails, the cells are built on this thread instead, one a frame. That's a
// dropped frame each, but every cell still gets its stars.
export function createStreamer({ scene, fields, material, onBuild, onFold, onDrop }) {
  const records = new Map(); // cell key → { key, cell, name, x, z, radius, tier, core, field, fields, dropped }
  let deltas = new Map(); // cell key → { fields: [{ eaten, remaining }], core: { gone, mass }, rival }
  const waiting = new Map(); // request id → { record, ring, sector }: the record its fields are for, and its cell
  const arrived = []; // { record, parts } built, waiting to go into the scene
  const local = []; // request ids to build on this thread, without the worker
  let nextId = 0;
  let planned = -Infinity; // when the cells around you were last worked out, in ms

  function deliver(id, parts) {
    const request = waiting.get(id);
    waiting.delete(id);
    if (request && !request.record.dropped) arrived.push({ record: request.record, parts });
  }

  let worker = null;
  try {
    worker = new Worker(new URL('./builder.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: { id, parts } }) => deliver(id, parts);
    worker.onerror = (event) => {
      event.preventDefault();
      console.warn('The cell builder failed, so cells are built on the main thread from now on.', event.message ?? '');
      withoutWorker();
    };
  } catch (error) {
    console.warn('The cell builder could not start, so cells are built on the main thread.', error);
  }

  // From now on, every cell is built here, including those the worker was still building.
  function withoutWorker() {
    worker?.terminate();
    worker = null;
    local.length = 0;
    local.push(...waiting.keys());
  }

  function deltaOf(key) {
    let delta = deltas.get(key);
    if (!delta) deltas.set(key, (delta = { fields: [], core: null, rival: false }));
    return delta;
  }

  function open(cell) {
    const { key, name, x, z, radius, tier } = cell;
    const record = { key, cell, name, x, z, radius, tier, core: null, field: null, fields: [], dropped: false };
    records.set(key, record);
    onBuild(record, deltaOf(key));
    const id = nextId++;
    waiting.set(id, { record, ring: cell.ring, sector: cell.sector });
    if (worker) worker.postMessage({ id, ring: cell.ring, sector: cell.sector });
    else local.push(id);
  }

  // Puts a cell's fields into the scene, with the stars you'd eaten there still gone. `time` (game time) sets how
  // far a galaxy has turned.
  function fill(record, parts, time) {
    const delta = deltaOf(record.key);
    record.fields = fieldsOf(parts, material);
    record.field = record.fields[0];
    record.fields.forEach((field, i) => {
      const saved = delta.fields[i];
      if (saved) {
        unpack(saved.eaten, field.alive);
        field.remaining = saved.remaining;
      }
      field.angle = field.spinRate * time;
      field.points.rotation.y = field.angle;
      scene.add(field.points);
      fields.push(field);
    });
  }

  // Notes what you've changed in a record in its delta.
  function fold(record) {
    const delta = deltaOf(record.key);
    record.fields.forEach((field, i) => {
      if (field.remaining < field.count) delta.fields[i] = { eaten: pack(field.alive), remaining: field.remaining };
    });
    onFold(record, delta);
  }

  // Lets go of a record, and with `keep`, remembers it first.
  function drop(record, keep) {
    if (keep) fold(record);
    onDrop(record);
    record.dropped = true;
    records.delete(record.key);
    for (const field of record.fields) {
      fields.splice(fields.indexOf(field), 1);
      scene.remove(field.points);
      field.points.geometry.dispose();
      field.points.material.dispose();
    }
  }

  // Drops the records you've left far behind or outgrown, and opens new ones near you, nearest first.
  function plan(focus, tier) {
    const minTier = tier + STREAM.fade[0];
    const unit = radiusOf(tier);
    const distance = (place) => Math.hypot(place.x - focus.x, place.z - focus.z) - place.radius;
    for (const record of [...records.values()]) {
      if (distance(record) > STREAM.drop * unit || record.tier < minTier - 0.3) drop(record, true);
    }
    const near = cellsNear(focus.x, focus.z, STREAM.build * unit, minTier).filter((cell) => !records.has(cell.key));
    near.sort((a, b) => distance(a) - distance(b));
    for (const cell of near) open(cell);
  }

  return {
    records,

    // Every frame: keeps the records around `focus` (an { x, z }, at `tier`) up to date four times a second, and
    // puts a couple of newly built cells into the scene, so their uploads to the GPU are spread out.
    update(focus, tier, time) {
      const now = performance.now();
      if (now - planned > 250) {
        planned = now;
        plan(focus, tier);
      }
      // Without the worker, one cell a frame is built here, skipping any dropped meanwhile.
      while (local.length > 0) {
        const id = local.shift();
        const request = waiting.get(id);
        if (!request) continue;
        if (request.record.dropped) {
          waiting.delete(id);
          continue;
        }
        deliver(id, buildCellParts(cellAt(request.ring, request.sector)));
        break;
      }
      for (const { record, parts } of arrived.splice(0, 2)) if (!record.dropped) fill(record, parts, time);
    },

    // The records around `focus` right away, for a fresh start or a retry. Their fields still come a few frames later.
    sync(focus, tier) {
      planned = performance.now();
      plan(focus, tier);
    },

    // What you've changed, everywhere: a copy for a checkpoint.
    save() {
      for (const record of records.values()) fold(record);
      return copyDeltas(deltas);
    },

    // Back to what a checkpoint saved. Every record goes; sync() brings back those around you.
    load(saved) {
      for (const record of [...records.values()]) drop(record, false);
      deltas = copyDeltas(saved);
      arrived.length = 0;
    },

    // Back to an untouched universe.
    clear() {
      for (const record of [...records.values()]) drop(record, false);
      deltas = new Map();
      arrived.length = 0;
    },

    dispose() {
      worker?.terminate();
    },
  };
}

function copyDeltas(deltas) {
  const copy = new Map();
  for (const [key, { fields, core, rival }] of deltas) {
    copy.set(key, {
      fields: fields.map((field) => field && { eaten: field.eaten.slice(), remaining: field.remaining }),
      core: core && { ...core },
      rival,
    });
  }
  return copy;
}

// Which of a field's particles have been eaten, one bit each.
export function pack(alive) {
  const bits = new Uint8Array(Math.ceil(alive.length / 8));
  for (let i = 0; i < alive.length; i++) if (alive[i] === 0) bits[i >> 3] |= 1 << (i & 7);
  return bits;
}

export function unpack(bits, alive) {
  for (let i = 0; i < alive.length; i++) alive[i] = bits[i >> 3] & (1 << (i & 7)) ? 0 : 1;
}
