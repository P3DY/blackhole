import { cellAt } from './cosmos.js';
import { buffersOf, buildCellParts } from './fields.js';

// A worker that builds the particles of the endless universe's cells, which takes a frame or so each, so the game
// never waits on it. Asked for { id, ring, sector }, it answers { id, parts } (see buildCellParts), handing the
// arrays over rather than copying them.
self.onmessage = ({ data: { id, ring, sector } }) => {
  const parts = buildCellParts(cellAt(ring, sector));
  self.postMessage({ id, parts }, buffersOf(parts));
};
