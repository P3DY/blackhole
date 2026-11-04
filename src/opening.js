import { UNIVERSE_SEED } from './config.js';
import { buildOpening } from './fields.js';
import { planUniverse } from './universe.js';
import { mulberry32 } from './utils.js';

// The opening's 600,000-odd stars take a couple of seconds to build on a phone, which would freeze the page
// while it loads. So a worker (builder.js) builds them, and this resolves with { plan, parts } for createGame().
// The plan is made here too: it's quick, and the same as the worker's, since both start the same seeded stream.
// If the worker can't start or fails, the opening is built here instead, as it used to be.
export function loadOpening() {
  const plan = planUniverse(mulberry32(UNIVERSE_SEED));
  return new Promise((resolve) => {
    let worker;
    const here = (reason, error) => {
      worker?.terminate();
      console.warn(`The opening ${reason}, so it's built on the main thread.`, error ?? '');
      resolve(buildOpening());
    };
    try {
      worker = new Worker(new URL('./builder.js', import.meta.url), { type: 'module' });
    } catch (error) {
      here("couldn't be built in a worker", error);
      return;
    }
    worker.onmessage = ({ data: { parts } }) => {
      worker.terminate();
      resolve({ plan, parts });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      here('failed to build in a worker', event.message);
    };
    worker.postMessage({ id: 0, opening: true });
  });
}
