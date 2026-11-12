/**
 * Names that cannot go on the table. The same function runs in the game (to wobble the letters at once) and on the
 * server (which is the one that counts). It ignores capitals, digits and symbols used as look-alike letters, and
 * letters stretched out ("FUUUCK").
 */
import { ALLOWED_WORDS, BLOCKED_WORDS } from './blocked-words.ts';
import { NAME_MAX_LETTERS } from './run-rules.ts';

const LOOK_ALIKES: Readonly<Record<string, string>> = { '0': 'O', '1': 'I', '3': 'E', '4': 'A', '5': 'S', '7': 'T', '8': 'B' };

/** Upper case, look-alikes turned into letters, repeated letters collapsed. */
export function normalise(name: string): string {
  let out = '';
  for (const ch of name.toUpperCase()) {
    const letter = LOOK_ALIKES[ch] ?? ch;
    if (letter === out[out.length - 1]) continue;
    out += letter;
  }
  return out;
}

const BLOCKED = BLOCKED_WORDS.map(normalise);
const ALLOWED = ALLOWED_WORDS.map(normalise);

export function isBlocked(name: string): boolean {
  let text = normalise(name);
  for (const allowed of ALLOWED) text = text.split(allowed).join('');
  return BLOCKED.some((word) => text.includes(word));
}

/** Name as the table keeps it: letters and digits only, capitals, at most NAME_MAX_LETTERS. */
export function cleanName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NAME_MAX_LETTERS);
}
