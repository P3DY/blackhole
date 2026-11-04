// Keeps the last checkpoint across reloads, in IndexedDB. A checkpoint (see saveCheckpoint() in game.js) is made of
// plain objects, typed arrays, a Map and Vector3s, which IndexedDB stores as they are (the Vector3s come back as
// plain { x, y, z }, which is all restore() reads from them).
//
// Every call settles, and none throws: without IndexedDB (some private windows, or blocked site data) the game
// simply doesn't remember anything across reloads.

// Bump this when a checkpoint's shape changes, so older saves are ignored rather than half restored.
export const SAVE_VERSION = 1;

const DB_NAME = 'black-hole';
const STORE = 'saves';
const KEY = 'checkpoint';

// Whether `saved` (as stored: { version, seed, checkpoint }) can be restored into a game whose universe has seed
// `seed` and whose opening fields hold `counts` stars each.
export function fits(saved, { seed, counts }) {
  if (!saved || saved.version !== SAVE_VERSION || saved.seed !== seed) return false;
  const { checkpoint } = saved;
  if (!checkpoint || !Array.isArray(checkpoint.fields) || checkpoint.fields.length !== counts.length) return false;
  const fieldsFit = checkpoint.fields.every(
    (field, i) => field?.eaten instanceof Uint8Array && field.eaten.length === Math.ceil(counts[i] / 8) && field.remaining <= counts[i],
  );
  return (
    fieldsFit &&
    checkpoint.cosmos instanceof Map &&
    Array.isArray(checkpoint.holes) &&
    checkpoint.holes.some((hole) => hole?.key === 'player') &&
    checkpoint.disk?.positions instanceof Float32Array &&
    Boolean(checkpoint.stats) &&
    Boolean(checkpoint.view)
  );
}

export function createSaves() {
  let opened = null;

  // The database, opened once. Rejects if there isn't one to be had.
  function database() {
    opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    return opened;
  }

  // Runs `work(store)` in a transaction, and resolves with its request's result once the transaction is done.
  async function run(mode, work) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  const quietly = (what) => (error) => {
    console.warn(`Couldn't ${what} the checkpoint, so it won't survive a reload.`, error);
    return null;
  };

  return {
    // Stores `checkpoint`, replacing the last. Checkpoints aren't changed once made, so it needn't be copied first.
    store(checkpoint, seed) {
      return run('readwrite', (store) => store.put({ version: SAVE_VERSION, seed, checkpoint }, KEY)).catch(quietly('save'));
    },

    // What was stored, as { version, seed, checkpoint }, or null.
    load() {
      return run('readonly', (store) => store.get(KEY)).then((saved) => saved ?? null, quietly('load'));
    },

    clear() {
      return run('readwrite', (store) => store.delete(KEY)).catch(quietly('forget'));
    },
  };
}
