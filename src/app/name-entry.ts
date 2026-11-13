/**
 * Signing a score: the player types, and each letter drops into the game as a giant jelly letter (the squishy letters of
 * the Unix Jelly guides) with a thump. Up to NAME_MAX_LETTERS letters or digits; Enter signs, Escape gives up. Touch
 * players tap the screen to bring up their keyboard (a real input sits under it for that), and have a Sign button.
 */
import { applyKey } from '../game/name-rules.ts';
import { NAME_MAX_LETTERS } from '../shared/run-rules.ts';
import { formatDistance } from '../shared/distance.ts';
import type * as THREE from 'three/webgpu';
import type { LetterStage } from '../world/jelly-letters/letter-stage.ts';

const LAST_NAME_KEY = 'jellyland.last-name';

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export type EntryResult = { kind: 'signed'; name: string } | { kind: 'skipped' };

export class NameEntry {
  /** Heard each time a letter lands (soft is the refusal wobble). Set by the owner of the sound. */
  onThump: (soft: boolean) => void = () => {};
  private readonly root = document.createElement('section');
  private readonly row: LetterStage;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input = document.createElement('input');
  private readonly prompt = document.createElement('p');
  private readonly left = document.createElement('span');
  private readonly leftTouch = document.createElement('span');
  private readonly message = document.createElement('p');
  private readonly signButton = document.createElement('button');
  private readonly skipButton = document.createElement('button');
  private readonly challenge = document.createElement('div');
  private name = '';
  private settle: ((result: EntryResult) => void) | null = null;
  private busy = false;

  constructor(letters: LetterStage, camera: THREE.PerspectiveCamera) {
    this.row = letters; this.camera = camera;
    this.root.id = 'name-entry';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Sign your score');
    this.prompt.className = 'ne-prompt';
    const hint = document.createElement('p');
    hint.className = 'ne-hint';
    this.left.className = 'ne-left';
    // Words for each kind of player: a keyboard has Enter, a phone has the Sign button and taps for its own keyboard.
    const keys = document.createElement('span'), taps = document.createElement('span');
    keys.className = 'keys-only'; taps.className = 'touch-only';
    keys.append(`Type your name onto the platform: up to ${NAME_MAX_LETTERS} letters or digits · `, this.left, ' · Enter to sign');
    taps.append(`Tap here to type your name: up to ${NAME_MAX_LETTERS} letters or digits · `, this.leftTouch);
    hint.append(keys, taps);
    this.message.className = 'ne-message';
    this.message.setAttribute('role', 'alert');
    this.challenge.className = 'ne-challenge';
    this.signButton.textContent = 'Sign'; this.signButton.className = 'ne-sign';
    this.skipButton.textContent = 'Skip'; this.skipButton.className = 'ne-skip';
    const actions = document.createElement('div');
    actions.className = 'ne-actions';
    actions.append(this.signButton, this.skipButton);
    this.input.className = 'ne-input';
    this.input.autocapitalize = 'characters'; this.input.autocomplete = 'off'; this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Your name');
    this.input.maxLength = 1;
    // A phone's keyboard: capitals, no suggestions or correction in the way, and a key that says what Enter does.
    this.input.setAttribute('autocorrect', 'off'); this.input.setAttribute('enterkeyhint', 'done'); this.input.inputMode = 'text';
    const top = document.createElement('div'), bottom = document.createElement('div');
    top.className = 'ne-top'; bottom.className = 'ne-bottom';
    top.append(this.prompt, hint);
    bottom.append(this.message, this.challenge, actions);
    this.row.onLand = soft => this.onThump(soft);
    this.root.append(top, bottom, this.input);
    document.body.append(this.root);
    // A phone's keyboard comes up when the player taps the screen (it is only allowed in answer to a tap) and stays up: a tap on a
    // button, or on the screen while the keyboard is already up, does not ask for it again.
    this.root.addEventListener('click', event => {
      if (!matchMedia('(pointer: coarse)').matches) return;
      if ((event.target as HTMLElement).closest('button, a, iframe, .ne-challenge')) return;
      if (document.activeElement !== this.input) this.input.focus({ preventScroll: true });
    });
    // Tapping a button must not take the keyboard away from the letters (a button takes focus, and the keyboard goes with it).
    for (const button of [this.signButton, this.skipButton]) button.addEventListener('pointerdown', event => event.preventDefault());
    this.signButton.addEventListener('click', () => this.press('Enter'));
    this.skipButton.addEventListener('click', () => this.press('Escape'));
    this.input.addEventListener('input', () => {
      // Soft keyboards report characters here rather than as named keys.
      const typed = this.input.value; this.input.value = '';
      for (const character of typed) this.press(character);
    });
  }

  get isOpen(): boolean { return this.root.classList.contains('shown'); }
  get challengeTarget(): HTMLElement { return this.challenge; }
  /** The letters as typed so far. */
  get text(): string { return this.name; }

  /** Open for a score of `distance`. Resolves when the player signs or skips; the screen stays up until `close`. */
  open(distance: number, rank: number): Promise<EntryResult> {
    this.name = ''; this.row.clear(); this.busy = false; this.signButton.disabled = false;
    this.prompt.innerHTML = '';
    this.prompt.append(`You made the leaderboard: ${ordinal(rank)}! Sign your `, Object.assign(document.createElement('b'), { textContent: formatDistance(distance) }), ' roll');
    this.setMessage('');
    this.updateCount();
    // (A keyboard can only be brought up by a tap, so on a phone this waits for one; see the click handler.)
    if (!matchMedia('(pointer: coarse)').matches) this.input.focus({ preventScroll: true });
    this.root.classList.add('shown');
    this.row.show(this.camera);
    window.addEventListener('keydown', this.keydown, true);
    // The last name used is offered, and replaced by the first key pressed.
    const previous = readLastName();
    if (previous) { for (const character of previous) { this.name += character; this.row.add(character, false); } this.updateCount(); this.fresh = true; }
    else this.fresh = false;
    return new Promise(resolve => { this.settle = resolve; });
  }

  /** The letters can be edited again, with a note (a name that was not allowed, say). */
  reopen(note: string) {
    this.busy = false;
    this.signButton.disabled = false;
    this.setMessage(note);
    this.row.wobble(true);
    window.addEventListener('keydown', this.keydown, true);
    this.settle = null;
    return new Promise<EntryResult>(resolve => { this.settle = resolve; });
  }

  /** The score is on its way: the keys stop, and a note says so. */
  holdFor(note: string) {
    this.busy = true;
    this.signButton.disabled = true;
    this.setMessage(note);
  }

  setMessage(text: string) {
    this.message.textContent = text;
    this.message.classList.toggle('shown', text.length > 0);
  }

  close() {
    this.root.classList.remove('shown');
    this.row.hide();
    window.removeEventListener('keydown', this.keydown, true);
    this.input.blur();
    this.challenge.innerHTML = '';
    this.settle = null;
  }

  dispose() {
    this.close();
    this.root.remove();
  }

  private fresh = false;

  private readonly keydown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Letters on a physical keyboard are handled here; a soft keyboard's "Unidentified" keys arrive as input events.
    if (event.key === 'Unidentified' || event.key === 'Process') return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat && event.key !== 'Backspace') return;
    this.press(event.key);
  };

  private press(key: string) {
    if (this.busy || !this.settle) return;
    if (this.fresh && /^[A-Za-z0-9]$/.test(key)) { this.name = ''; this.row.clear(); this.fresh = false; }
    this.fresh = false;
    const outcome = applyKey(this.name, key);
    switch (outcome.result) {
      case 'added': this.name = outcome.name; this.row.add(key.toUpperCase()); this.setMessage(''); break;
      case 'removed': this.name = outcome.name; this.row.removeLast(); this.setMessage(''); break;
      case 'refused': this.row.wobble(); break;
      case 'empty': this.setMessage('Type at least one letter.'); this.row.wobble(true); break;
      case 'sign': { saveLastName(this.name); const settle = this.settle; this.settle = null; window.removeEventListener('keydown', this.keydown, true); settle({ kind: 'signed', name: this.name }); break; }
      case 'skip': { const settle = this.settle; this.settle = null; this.close(); settle({ kind: 'skipped' }); break; }
      default: break;
    }
    this.updateCount();
  }

  private updateCount() {
    const remaining = NAME_MAX_LETTERS - this.name.length;
    this.left.textContent = this.leftTouch.textContent = remaining === 0 ? 'that is the most' : `${remaining} left`;
  }
}

function readLastName(): string {
  try { return (localStorage.getItem(LAST_NAME_KEY) ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NAME_MAX_LETTERS); } catch { return ''; }
}
function saveLastName(name: string) { try { localStorage.setItem(LAST_NAME_KEY, name); } catch { /* private mode */ } }
