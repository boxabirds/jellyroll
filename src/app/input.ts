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
/** Debug: the digits 1 to 6 jump to that biome; - and = make the holes smaller and bigger; B adds a bee; G turns the jelly into a glass marble; comma goes back 100 metres. */
const BEE_KEY = 'b';
const MARBLE_KEY = 'g';
const BACK_KEY = ',';
const BIOME_KEYS = /^[1-6]$/;
const HOLES_SMALLER_KEY = '-';
const HOLES_BIGGER_KEYS = ['=', '+'];
const HANDLED_KEYS = new Set<string>([...ACCELERATE_KEYS, ...DECELERATE_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS, JUMP_KEY, RESTART_KEY, MUTE_KEY]);

export type DebugCommand = { biome: number } | { holes: number } | { bee: true } | { marble: true } | { back: true };

export class Input {
  /** Mutated in place; the physics step reads it directly. */
  readonly control: ControlInput = { throttle: 0, steer: 0, jump: false };
  /** Set on a fresh Space press; the runtime clears it once it has acted on it. */
  jumpPressed = false;
  /** Whether the controls help is showing; "?" toggles it, Escape hides it. */
  helpShown = false;
  private readonly held = new Set<string>();
  /** Touch stick, tilt and the touch jump button, merged with the keyboard in refresh(). */
  private stickX = 0;
  private stickY = 0;
  private tiltX = 0;
  private touchJump = false;
  private readonly onRestart: () => void;
  private readonly onMute: () => void;
  private readonly onGesture: () => void;
  /** Debug keys are passed here. */
  onDebug: (command: DebugCommand) => void = () => {};

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
    if (event.code === CLOSE_HELP_KEY) {
      this.helpShown = false;
      // The cursor is hidden while playing; Escape brings it back, and sends it away again.
      if (!event.repeat) document.documentElement.classList.toggle('show-cursor');
      return;
    }
    if (!event.repeat) {
      if (BIOME_KEYS.test(event.key)) { this.onDebug({ biome: Number(event.key) - 1 }); return; }
      if (event.key.toLowerCase() === BEE_KEY) { this.onDebug({ bee: true }); return; }
      if (event.key.toLowerCase() === MARBLE_KEY) { this.onDebug({ marble: true }); return; }
      if (event.key === BACK_KEY) { this.onDebug({ back: true }); return; }
      if (event.key === HOLES_SMALLER_KEY) { this.onDebug({ holes: -1 }); return; }
      if (HOLES_BIGGER_KEYS.includes(event.key)) { this.onDebug({ holes: 1 }); return; }
    }
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

  /** The on-screen stick: x is -1 (left) to 1 (right), y is -1 (brake) to 1 (accelerate). */
  setStick(x: number, y: number) {
    this.stickX = x; this.stickY = y;
    this.used = true;
    this.refresh();
  }

  /** Tilt steering, -1 to 1. Called every frame while tilt is on. */
  setTilt(x: number) {
    if (x === this.tiltX) return;
    this.tiltX = x;
    this.refresh();
  }

  /** The on-screen jump button. A fresh press counts as a tap even if it is released within a frame. */
  setTouchJump(down: boolean) {
    if (down && !this.touchJump) this.jumpPressed = true;
    this.touchJump = down;
    this.used = true;
    this.refresh();
  }

  private pressed(keys: readonly string[]) {
    return keys.some(key => this.held.has(key)) ? 1 : 0;
  }

  private refresh() {
    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    this.control.throttle = clamp(this.pressed(ACCELERATE_KEYS) - this.pressed(DECELERATE_KEYS) + this.stickY);
    this.control.steer = clamp(this.pressed(RIGHT_KEYS) - this.pressed(LEFT_KEYS) + this.stickX + this.tiltX);
    this.control.jump = this.held.has(JUMP_KEY) || this.touchJump;
  }
}
