/** Keyboard → control input. W/S throttle, A/D steer, Space jump; arrow keys mirror WASD. */
import type { ControlInput } from '../game/physics.ts';

const ACCELERATE_KEYS = ['KeyW', 'ArrowUp'] as const;
const DECELERATE_KEYS = ['KeyS', 'ArrowDown'] as const;
const LEFT_KEYS = ['KeyA', 'ArrowLeft'] as const;
const RIGHT_KEYS = ['KeyD', 'ArrowRight'] as const;
const JUMP_KEY = 'Space';
const RESTART_KEY = 'KeyR';
const MUTE_KEY = 'KeyM';
/** Help is asked for by the character typed, wherever "?" lives on the keyboard. */
const HELP_CHARACTER = '?';
const CLOSE_HELP_KEY = 'Escape';
const HANDLED_KEYS = new Set<string>([...ACCELERATE_KEYS, ...DECELERATE_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS, JUMP_KEY, RESTART_KEY, MUTE_KEY]);

export class Input {
  /** Mutated in place; the physics step reads it directly. */
  readonly control: ControlInput = { throttle: 0, steer: 0, jump: false };
  /** Set on a fresh Space press; the runtime clears it once it has acted on it. */
  jumpPressed = false;
  /** Whether the controls help is showing; "?" toggles it, Escape hides it. */
  helpShown = false;
  private readonly held = new Set<string>();
  private readonly onRestart: () => void;
  private readonly onMute: () => void;
  private readonly onGesture: () => void;

  /** `onGesture` fires on every handled key press: the browser's cue that audio may start. */
  constructor(onRestart: () => void, onMute: () => void, onGesture: () => void) {
    this.onRestart = onRestart; this.onMute = onMute; this.onGesture = onGesture;
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.release);
  }

  dispose() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.release);
  }

  private readonly keydown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === HELP_CHARACTER) { if (!event.repeat) this.helpShown = !this.helpShown; event.preventDefault(); return; }
    if (event.code === CLOSE_HELP_KEY) { this.helpShown = false; return; }
    if (!HANDLED_KEYS.has(event.code)) return;
    event.preventDefault();
    this.onGesture();
    if (event.code === RESTART_KEY) { if (!event.repeat) this.onRestart(); return; }
    if (event.code === MUTE_KEY) { if (!event.repeat) this.onMute(); return; }
    if (event.code === JUMP_KEY && !event.repeat) this.jumpPressed = true;
    this.held.add(event.code);
    this.refresh();
  };

  private readonly keyup = (event: KeyboardEvent) => {
    if (this.held.delete(event.code)) this.refresh();
  };

  /** A key released while the window is unfocused never sends keyup. */
  private readonly release = () => { this.held.clear(); this.refresh(); };

  private pressed(keys: readonly string[]) {
    return keys.some(key => this.held.has(key)) ? 1 : 0;
  }

  private refresh() {
    this.control.throttle = this.pressed(ACCELERATE_KEYS) - this.pressed(DECELERATE_KEYS);
    this.control.steer = this.pressed(RIGHT_KEYS) - this.pressed(LEFT_KEYS);
    this.control.jump = this.held.has(JUMP_KEY);
  }
}
