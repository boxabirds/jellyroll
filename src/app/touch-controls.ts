/**
 * On-screen controls for phones and tablets: a stick (a circle in a circle) for
 * speed and steering (bottom left), a big jump button (bottom right, under the
 * power-ups), and small buttons for tilt steering and sound (left edge). Everything is translucent so the hill shows through. Each control
 * tracks its own finger, so the stick and the buttons work together.
 */
import { stickValue, type StickValue } from './touch-math.ts';
import type { Input } from './input.ts';
import type { TiltSensor } from './tilt.ts';

/** How far the knob may travel from the centre, as a fraction of the base's radius. */
const TRAVEL_FRACTION = 0.62;

export class TouchControls {
  /** Set the first time a finger touches anything, so the page can start sound and keep the screen awake. */
  onFirstTouch: () => void = () => {};
  private readonly root = document.createElement('div');
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly value: StickValue = { x: 0, y: 0 };
  private stickPointer = -1;
  private touched = false;

  constructor(
    private readonly input: Input,
    private readonly tilt: TiltSensor,
    private readonly toggleMute: () => boolean,
    private readonly message: (text: string) => void,
  ) {
    this.root.className = 'touch-controls';
    this.root.setAttribute('aria-label', 'Touch controls');
    this.root.innerHTML = `
      <div class="stick-zone" data-stick>
        <div class="stick-base"><div class="stick-knob"></div></div>
      </div>
      <div class="touch-settings">
        <button type="button" class="touch-small" data-tilt aria-label="Tilt steering" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="3" width="10" height="18" rx="2.5" transform="rotate(-18 12 12)"/><path d="M5 20h14" opacity=".5"/></svg>
        </button>
        <button type="button" class="touch-small" data-sound aria-label="Mute sound" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-off" d="m15 9 6 6m0-6-6 6"/></svg>
        </button>
      </div>
      <div class="touch-buttons">
        <button type="button" class="touch-jump" data-jump aria-label="Jump">
          <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 21V6m-6 6 6-6 6 6M6 24h16"/></svg>
        </button>
      </div>`;
    document.body.append(this.root);
    this.base = this.root.querySelector('.stick-base') as HTMLDivElement;
    this.knob = this.root.querySelector('.stick-knob') as HTMLDivElement;

    const zone = this.root.querySelector('[data-stick]') as HTMLElement;
    zone.addEventListener('pointerdown', this.stickDown);
    zone.addEventListener('pointermove', this.stickMove);
    zone.addEventListener('pointerup', this.stickUp);
    zone.addEventListener('pointercancel', this.stickUp);

    const jump = this.root.querySelector('[data-jump]') as HTMLElement;
    jump.addEventListener('pointerdown', event => { this.touch(); jump.setPointerCapture(event.pointerId); jump.classList.add('down'); this.input.setTouchJump(true); });
    const release = () => { jump.classList.remove('down'); this.input.setTouchJump(false); };
    jump.addEventListener('pointerup', release);
    jump.addEventListener('pointercancel', release);

    const tiltButton = this.root.querySelector('[data-tilt]') as HTMLElement;
    tiltButton.addEventListener('click', async () => {
      this.touch();
      if (this.tilt.active) { this.tilt.disable(); this.message('Tilt steering off'); } else await this.tilt.enable();
      tiltButton.setAttribute('aria-pressed', String(this.tilt.active));
      tiltButton.classList.toggle('on', this.tilt.active);
    });
    // The sensor reports asynchronously; reflect it on the button when it arrives.
    window.setInterval(() => {
      tiltButton.classList.toggle('on', this.tilt.active);
      tiltButton.setAttribute('aria-pressed', String(this.tilt.active));
    }, 500);

    const soundButton = this.root.querySelector('[data-sound]') as HTMLElement;
    soundButton.addEventListener('click', () => {
      this.touch();
      const muted = this.toggleMute();
      soundButton.setAttribute('aria-pressed', String(muted));
      soundButton.classList.toggle('on', muted);
    });

    // Any other touch also counts as the first, and shows the touch layout on laptops with touchscreens.
    window.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') this.touch(); }, true);
  }

  /** Show the layout (also called when the first touch arrives on a device that did not look like a phone). */
  show() {
    document.documentElement.classList.add('touch');
  }

  /** A finger has touched something: show the touch layout, and on the very first one, let the page start sound. */
  private touch() {
    this.show();
    if (this.touched) return;
    this.touched = true;
    this.onFirstTouch();
  }

  private readonly stickDown = (event: PointerEvent) => {
    if (this.stickPointer !== -1) return;
    this.touch();
    this.stickPointer = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.stickMove(event);
  };

  private readonly stickMove = (event: PointerEvent) => {
    if (event.pointerId !== this.stickPointer) return;
    const rect = this.base.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = event.clientX - (rect.left + radius), dy = event.clientY - (rect.top + radius);
    const travel = radius * TRAVEL_FRACTION;
    stickValue(dx, dy, travel, this.value);
    this.input.setStick(this.value.x, this.value.y);
    // Draw the knob where the thumb is, held inside the base.
    const length = Math.hypot(dx, dy), scale = length > travel ? travel / length : 1;
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    this.base.classList.add('held');
  };

  private readonly stickUp = (event: PointerEvent) => {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = -1;
    this.input.setStick(0, 0);
    this.knob.style.transform = 'translate(0, 0)';
    this.base.classList.remove('held');
  };

  dispose() {
    this.root.remove();
  }
}

