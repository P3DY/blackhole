import { cellAt } from './cosmos.js';
import { buffersOf, buildCellParts, buildOpening } from './fields.js';

// A worker that builds star fields, so the game never waits on them: the particles of the endless universe's
// cells, which take a frame or so each, and once, at load, the opening's, which take a couple of seconds on a
// phone. Asked for { id, ring, sector }, it answers { id, parts } (see buildCellParts); asked for { id, opening },
// with the opening's parts (the main thread makes its own copy of the plan, which is quick). Either way it hands the arrays over rather than copying them.
self.onmessage = ({ data: { id, ring, sector, opening } }) => {
  const parts = opening ? buildOpening().parts : buildCellParts(cellAt(ring, sector));
  self.postMessage({ id, parts }, buffersOf(parts));
};

