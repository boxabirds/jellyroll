/**
 * The page's side of saving a run: every few seconds of play, and the moment the page is hidden, the jelly's state is posted to a worker
 * thread that writes it to IndexedDB (see save-worker.ts). The only cost on the page is copying the snapshot into the message.
 */
import type { RunSnapshot } from './run-snapshot.ts';

/** Seconds of play between saves. */
const SAVE_EVERY_MS = 3000;
/** How long to wait for the saved run to come back at the start, so a slow disk never holds up the title screen. */
const LOAD_TIMEOUT_MS = 1200;
/** How long after the page's teardown the worker is left to finish writing. */
const TERMINATE_DELAY_MS = 3000;

export class RunSaver {
  private worker: Worker | null = null;
  private readonly waiting = new Map<number, (snapshot: RunSnapshot | null) => void>();
  private nextId = 1;
  private lastSaved = Number.NEGATIVE_INFINITY;
  /** Time spent copying the snapshot into the message, for the performance tally. */
  lastCopyMs = 0;

  constructor() {
    try {
      this.worker = new Worker(new URL('./save-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = event => {
        const done = this.waiting.get(event.data?.id);
        if (done) { this.waiting.delete(event.data.id); done(event.data.snapshot ?? null); }
      };
      // No worker, no storage: the game plays on without saving.
      this.worker.onerror = () => { this.worker = null; for (const done of this.waiting.values()) done(null); this.waiting.clear(); };
    } catch { this.worker = null; }
  }

  /** The saved run, or null (nothing saved, nowhere to save it, or too slow). */
  load(): Promise<RunSnapshot | null> {
    const worker = this.worker;
    if (!worker) return Promise.resolve(null);
    return new Promise(resolve => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.waiting.delete(id); resolve(null); }, LOAD_TIMEOUT_MS);
      this.waiting.set(id, snapshot => { clearTimeout(timer); resolve(snapshot); });
      worker.postMessage({ type: 'load', id });
    });
  }

  /** Called every frame of play: saves (building the snapshot only then) once it is due. */
  tick(now: number, build: () => RunSnapshot) {
    if (now - this.lastSaved >= SAVE_EVERY_MS) this.save(now, build);
  }

  /** Save now (the page is being hidden, say). */
  save(now: number, build: () => RunSnapshot) {
    if (!this.worker) return;
    this.lastSaved = now;
    const started = performance.now();
    try { this.worker.postMessage({ type: 'save', snapshot: build() }); } catch { /* a snapshot that cannot be copied is skipped */ }
    this.lastCopyMs = performance.now() - started;
  }

  /** The run ended or a new one began: nothing to pick up. */
  clear() {
    this.lastSaved = Number.NEGATIVE_INFINITY;
    this.worker?.postMessage({ type: 'clear' });
  }

  dispose() {
    // A save posted a moment ago (when the graphics were lost, say) must not be cut off by the teardown: let the worker finish first.
    const worker = this.worker;
    this.worker = null;
    if (worker) setTimeout(() => worker.terminate(), TERMINATE_DELAY_MS);
  }
}
