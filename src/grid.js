import * as THREE from 'three';

const { clamp } = THREE.MathUtils;

// Buckets a field's particles into a square grid over its local x/z, so captures only look at nearby cells.
// Particles are stored sorted by cell: cell c holds items[start[c]] … items[start[c + 1] - 1].
export function buildGrid(positions, count) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let radius = 0;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    radius = Math.max(radius, Math.hypot(x, z));
  }

  const cols = clamp(Math.round(Math.sqrt(count / 4)), 8, 128); // about four particles per cell
  const cellSize = (Math.max(maxX - minX, maxZ - minZ) / cols) * 1.0001 || 1;
  const cellOf = new Int32Array(count);
  const start = new Int32Array(cols * cols + 1);

  for (let i = 0; i < count; i++) {
    const cx = Math.min(cols - 1, Math.floor((positions[i * 3] - minX) / cellSize));
    const cz = Math.min(cols - 1, Math.floor((positions[i * 3 + 2] - minZ) / cellSize));
    cellOf[i] = cz * cols + cx;
    start[cellOf[i] + 1]++;
  }
  for (let cell = 0; cell < cols * cols; cell++) start[cell + 1] += start[cell];

  const items = new Int32Array(count);
  const next = start.slice(0, cols * cols);
  for (let i = 0; i < count; i++) items[next[cellOf[i]]++] = i;

  return { minX, minZ, cellSize, cols, start, items, radius };
}

// Calls visit(i) for each live particle within `radius` of local (hx, hz), working outward in square
// rings of cells so the nearest matter is captured first. Stops as soon as visit() returns false.
export function queryGrid(field, hx, hz, radius, visit) {
  const { minX, minZ, cellSize, cols, start, items } = field.grid;
  const { positions, alive } = field;
  const last = cols - 1;
  const cx = Math.floor((hx - minX) / cellSize);
  const cz = Math.floor((hz - minZ) / cellSize);
  const radiusSq = radius * radius;

  // Rings that miss the grid entirely are skipped, which matters when the hole is far off to one side.
  const firstRing = Math.max(0, -cx, cx - last, -cz, cz - last);
  const lastRing = Math.min(Math.ceil(radius / cellSize), Math.max(cx, last - cx, cz, last - cz));

  const visitCell = (x, z) => {
    const cell = z * cols + x;
    for (let k = start[cell]; k < start[cell + 1]; k++) {
      const i = items[k];
      if (alive[i] === 0) continue;
      const dx = positions[i * 3] - hx;
      const dz = positions[i * 3 + 2] - hz;
      if (dx * dx + dz * dz < radiusSq && visit(i) === false) return false;
    }
    return true;
  };

  for (let ring = firstRing; ring <= lastRing; ring++) {
    // Top and bottom rows of the ring…
    const x0 = Math.max(cx - ring, 0);
    const x1 = Math.min(cx + ring, last);
    for (const z of ring === 0 ? [cz] : [cz - ring, cz + ring]) {
      if (z < 0 || z > last) continue;
      for (let x = x0; x <= x1; x++) if (!visitCell(x, z)) return;
    }
    // …then the left and right columns between them.
    if (ring === 0) continue;
    const z0 = Math.max(cz - ring + 1, 0);
    const z1 = Math.min(cz + ring - 1, last);
    for (const x of [cx - ring, cx + ring]) {
      if (x < 0 || x > last) continue;
      for (let z = z0; z <= z1; z++) if (!visitCell(x, z)) return;
    }
  }
}
