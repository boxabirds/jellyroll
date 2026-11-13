/**
 * Keeps the saved run in IndexedDB, on a thread of its own, so saving never takes time from drawing the game. The page posts a snapshot;
 * the copy is made when it is posted and the writing happens here. Messages are handled one after another, in the order they came.
 */
const DATABASE = 'jellyland', STORE = 'run', KEY = 'current';

type Message = { type: 'save'; snapshot: unknown } | { type: 'clear' } | { type: 'load'; id: number };
const scope = self as unknown as { onmessage: ((event: { data: Message }) => void) | null; postMessage(message: unknown): void };

let database: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

let queue: Promise<unknown> = Promise.resolve();
scope.onmessage = event => {
  const message = event.data;
  queue = queue.then(async () => {
    try {
      if (message.type === 'save') await run('readwrite', store => store.put(message.snapshot, KEY));
      else if (message.type === 'clear') await run('readwrite', store => store.delete(KEY));
      else scope.postMessage({ type: 'loaded', id: message.id, snapshot: (await run('readonly', store => store.get(KEY))) ?? null });
    } catch {
      // Storage refused (private browsing, full): the game carries on without saving.
      if (message.type === 'load') scope.postMessage({ type: 'loaded', id: message.id, snapshot: null });
    }
  });
};
