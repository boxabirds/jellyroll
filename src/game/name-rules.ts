/**
 * The rules of typing a name: letters and digits only, capitals, at most NAME_MAX_LETTERS. Pure, so the entry screen
 * and its tests use the same code.
 */
import { NAME_MAX_LETTERS } from '../shared/run-rules.ts';

export type KeyResult =
  /** A letter or digit was added. */
  | 'added'
  /** The last letter was taken off. */
  | 'removed'
  /** The key means nothing here. */
  | 'ignored'
  /** The name is full, so the letter did not go in. */
  | 'refused'
  /** Enter with a name: sign the score. */
  | 'sign'
  /** Enter with no name: ask for a letter. */
  | 'empty'
  /** Escape: give up signing. */
  | 'skip';

export interface KeyOutcome { name: string; result: KeyResult }

const LETTER_OR_DIGIT = /^[A-Za-z0-9]$/;

export function applyKey(name: string, key: string): KeyOutcome {
  if (key === 'Enter') return { name, result: name.length > 0 ? 'sign' : 'empty' };
  if (key === 'Escape') return { name, result: 'skip' };
  if (key === 'Backspace') return name.length > 0 ? { name: name.slice(0, -1), result: 'removed' } : { name, result: 'ignored' };
  if (!LETTER_OR_DIGIT.test(key)) return { name, result: 'ignored' };
  if (name.length >= NAME_MAX_LETTERS) return { name, result: 'refused' };
  return { name: name + key.toUpperCase(), result: 'added' };
}
