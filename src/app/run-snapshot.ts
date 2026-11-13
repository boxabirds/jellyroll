/**
 * Saving a run so it can be picked up again after the graphics, the page or the whole tab is lost (a phone short of memory does all
 * three). The run is the jelly (one plain object), the patches the freeze ray made, and the score server's token for the run: the
 * world is made from position, so none of it is saved. Pure functions, so they can be tested without a browser.
 */
import type { Ball } from '../game/physics.ts';
import type { Frost } from '../game/frost-store.ts';
import { MAX_GAP_SECONDS, MS_PER_SECOND } from '../shared/run-rules.ts';

export const SNAPSHOT_VERSION = 1;
/**
 * A run can be picked up again for this long after it was last saved: inside the score server's limit on silence between check-ins
 * (a run quiet for longer stops being verified), less a margin for loading.
 */
export const RESUME_MAX_AGE_MS = (MAX_GAP_SECONDS - 60) * MS_PER_SECOND;
/** A run shorter than this is not worth offering back. */
export const RESUME_MIN_METRES = 30;

export interface RunSnapshot {
  version: number;
  savedAt: number;
  ball: Ball;
  frost: Frost[];
  /** The score server's token for the run, and whether a debug key has disqualified it. */
  token: string | null;
  debugUsed: boolean;
}

/** Whether a saved run is still worth offering: the right version, recent, a real run, and not one that had already ended. */
export function canResume(snapshot: RunSnapshot | null | undefined, now: number): snapshot is RunSnapshot {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !snapshot.ball) return false;
  if (!Number.isFinite(snapshot.savedAt) || now - snapshot.savedAt > RESUME_MAX_AGE_MS || now < snapshot.savedAt) return false;
  return !snapshot.ball.wornOut && snapshot.ball.distance >= RESUME_MIN_METRES;
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

/**
 * Copy `source` into `target` in place, keeping the objects, arrays and typed arrays that `target` already has (the rest of the game holds
 * on to them). Where the two differ in shape (a list that grew, a set), the saved one is put in its place.
 */
export function assignDeep(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const from = source[key], into = target[key];
    if (!isObject(from)) { target[key] = from; continue; }
    if (ArrayBuffer.isView(from) && ArrayBuffer.isView(into) && (into as unknown as ArrayLike<number>).length === (from as unknown as ArrayLike<number>).length) {
      (into as unknown as { set(values: ArrayLike<number>): void }).set(from as unknown as ArrayLike<number>);
    } else if (Array.isArray(from) && Array.isArray(into) && from.every(item => !isObject(item))) {
      // A list of numbers, say: filled in place, whatever length it has grown to.
      into.length = from.length;
      for (let i = 0; i < from.length; i++) into[i] = from[i];
    } else if (Array.isArray(from) && Array.isArray(into) && into.length === from.length && from.every(isObject) && into.every(isObject)
      && !from.some(item => item instanceof Map || item instanceof Set || Array.isArray(item) || ArrayBuffer.isView(item))) {
      for (let i = 0; i < from.length; i++) assignDeep(into[i] as Record<string, unknown>, from[i] as Record<string, unknown>);
    } else if (isObject(into) && !Array.isArray(from) && !Array.isArray(into) && !ArrayBuffer.isView(from) && !(from instanceof Map) && !(from instanceof Set)) {
      assignDeep(into, from);
    } else {
      target[key] = from;
    }
  }
}
