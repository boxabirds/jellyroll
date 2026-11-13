/**
 * Demo mode (?demo=true): the jelly plays itself through a loop of short scenes, each built to show off one thing, with a
 * caption and a fade between them. Nothing here needs the player: the controls are off, the run is not sent to the score
 * server, and the jelly cannot wear away.
 */
import { addBee } from '../game/bees.ts';
import { autoSteer } from '../game/autopilot.ts';
import { BIOME_LENGTH, CAVE, ICE, LAVA, SCREE, firstStretchOf } from '../game/biomes.ts';
import { wantPowerup, type Ball, type ControlInput } from '../game/physics.ts';
import { POWERUP_FREEZE, POWERUP_GLASS, POWERUP_MAGNET, POWERUP_SEEDS, START_RADIUS } from '../game/tuning.ts';

/** The jelly never wears below this share of its starting size in the demo. */
const KEEP_SIZE = 0.8;
/** The picture fades to black for this long between scenes, and back in again for as long. */
const FADE_SECONDS = 0.6;
/** Bees in the bee scene. */
const DEMO_BEES = 4;
/** Where in a stretch the scenes begin (metres), and how far before the cave's mouth the cave scene starts. */
const INTO_STRETCH = 300;
const BEFORE_CAVE = 90;
/** The meadow pond used for the splash scene, found by searching the world: where to start (metres), and how far from the middle the pond lies. It is 12 m long, with the start a good run before it. */
const POND_START = 8150;
const POND_OFFSET = -4.5;
/** A meadow stretch well past the first, for the seeds. */
const SEED_START = 3400;
/** A meadow pond 12 m long along a line this far off the middle, and a run up to it for the freeze scene. */
const FROZEN_POND_START = 8218;
const FROZEN_POND_OFFSET = -4.5;
const FREEZE_RUN_UP = 40;
/** The ray is used once the jelly is this close (metres) to the pond, so the patches land on it. */
const FREEZE_RANGE = 12;
/** A stretch of scree with a fog event (found by searching the world; see game/fog.ts), and how far into it the scene starts (the fog is already well in). */
const FOG_EVENT_START = 15766;
const FOG_LEAD_IN = 60;

export interface DemoHooks {
  ball: Ball;
  control: ControlInput;
  /** Start a fresh run at course distance `s`, `lateral` metres off the middle, with the world redrawn there. */
  begin(s: number, lateral: number): void;
}

interface Scene {
  title: string;
  text: string;
  seconds: number;
  s: number;
  lateral?: number;
  /** Hold this offset from the middle instead of looking for things to roll through (to go through a pond). */
  lane?: number;
  /** Timed events: each runs once its time has come; one that returns false is tried again next frame (it is waiting for something). */
  events: [number, (hooks: DemoHooks) => void | boolean][];
}

const give = (slot: number) => (hooks: DemoHooks) => { hooks.ball.stock[slot]++; wantPowerup(hooks.ball, slot); };
const bees = (hooks: DemoHooks) => {
  for (let i = 0; i < DEMO_BEES; i++) addBee(hooks.ball.flock, hooks.ball.x + (i - 1.5), hooks.ball.y + 1.2, hooks.ball.z);
};

export const SCENES: readonly Scene[] = [
  { title: 'Roll through it', text: 'Every jelly you touch becomes part of you.', seconds: 15, s: INTO_STRETCH, events: [[1.5, give(POWERUP_MAGNET)]] },
  { title: 'Bring friends', text: 'Bees fetch jelly for you, and heel like dogs.', seconds: 15, s: 700, events: [[0.4, bees]] },
  { title: 'Go solid', text: 'A glass marble smashes rocks to pieces.', seconds: 16, s: firstStretchOf(SCREE) * BIOME_LENGTH + INTO_STRETCH, events: [[0.6, give(POWERUP_GLASS)]] },
  { title: 'Make a splash', text: 'Real water: ripples, crowns and spray.', seconds: 14, s: POND_START, lane: POND_OFFSET, lateral: POND_OFFSET, events: [] },
  { title: 'Sow a garden', text: 'Throw seeds. They sprout into jelly to roll through.', seconds: 15, s: SEED_START, events: [[1.8, give(POWERUP_SEEDS)]] },
  { title: 'Slide on ice', text: 'Snow packs on and the steering goes slippery.', seconds: 15, s: firstStretchOf(ICE) * BIOME_LENGTH + 500, events: [] },
  { title: 'Into the cave', text: 'Crystals light the dark. Stalactites fall.', seconds: 19, s: firstStretchOf(CAVE) * BIOME_LENGTH - BEFORE_CAVE, events: [[1, give(POWERUP_GLASS)]] },
  { title: 'Lava', text: 'Embers, steam and fire, and still it rolls.', seconds: 15, s: firstStretchOf(LAVA) * BIOME_LENGTH + INTO_STRETCH, events: [] },
  { title: 'Freeze the water', text: 'A freeze ray turns a pond to solid ice.', seconds: 14, s: FROZEN_POND_START - FREEZE_RUN_UP, lane: FROZEN_POND_OFFSET, lateral: FROZEN_POND_OFFSET, events: [[0.5, hooks => (-hooks.ball.z < FROZEN_POND_START - FREEZE_RANGE ? false : give(POWERUP_FREEZE)(hooks))]] },
  { title: 'Into the fog', text: 'Some days the scree whites out.', seconds: 16, s: FOG_EVENT_START + FOG_LEAD_IN, events: [] },
];

/**
 * For making recordings: ?scenes=3,8,0 plays just those scenes (by number), in that order, and ?seconds=9 caps how long each runs.
 * Without them the demo plays every scene, round and round.
 */
function chosenScenes(): { order: number[]; cap: number } {
  const params = new URLSearchParams(location.search);
  const listed = (params.get('scenes') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < SCENES.length);
  const cap = Number(params.get('seconds'));
  return { order: listed.length > 0 ? listed : SCENES.map((_, index) => index), cap: Number.isFinite(cap) && cap > 0 ? cap : Number.POSITIVE_INFINITY };
}

export class Demo {
  private readonly order: number[];
  private readonly cap: number;
  /** Where in `order` the scene playing is. */
  private place = 0;
  private readonly hooks: DemoHooks;
  private readonly fade = document.createElement('div');
  private readonly caption = document.createElement('div');
  private readonly title = document.createElement('h1');
  private readonly text = document.createElement('p');
  private scene = -1;
  private clock = 0;
  private sceneClock = 0;
  private nextEvent = 0;
  private fading: 'in' | 'out' | null = null;
  private fadeClock = 0;

  constructor(hooks: DemoHooks) {
    this.hooks = hooks;
    ({ order: this.order, cap: this.cap } = chosenScenes());
    this.fade.id = 'demo-fade';
    this.caption.id = 'demo-caption';
    this.caption.append(this.title, this.text);
    const mark = document.createElement('div');
    mark.id = 'demo-mark'; mark.textContent = 'Jellyland';
    const note = document.createElement('div');
    note.id = 'demo-note'; note.textContent = 'Click for sound · press Esc to play it yourself';
    // (A recording has no use for the hint about clicking and pressing Esc.)
    if (new URLSearchParams(location.search).get('wait') === '1') document.body.append(this.fade, this.caption, mark);
    else document.body.append(this.fade, this.caption, mark, note);
    window.addEventListener('pointerdown', () => note.remove(), { once: true });
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const url = new URL(location.href); url.searchParams.delete('demo'); location.href = url.toString();
    });
    // ?wait=1 (for recordings): stay on black until the page is told to begin with a "demo-go" event, so the first scene starts on cue.
    if (new URLSearchParams(location.search).get('wait') === '1') {
      this.recording = true;
      this.waiting = true; this.fade.style.opacity = '1';
      window.addEventListener('demo-go', () => { this.waiting = false; this.start(0); }, { once: true });
    } else this.start(0);
  }

  private waiting = false;
  private recording = false;


  get current(): number { return this.scene; }

  /** Call every frame, before the physics. Steers the jelly, runs the scene's timed events and the fades. */
  update(dt: number) {
    if (this.waiting) return;
    const { ball, control } = this.hooks;
    this.clock += dt;
    if (ball.radius < START_RADIUS * KEEP_SIZE) { ball.radius = START_RADIUS * KEEP_SIZE; ball.wornOut = false; }
    const scene = SCENES[this.order[this.place]];
    control.throttle = 1; control.jump = false;
    control.steer = autoSteer(ball, this.clock, scene.lane ?? null);
    if (this.fading === 'out') {
      this.fadeClock += dt;
      this.fade.style.opacity = String(Math.min(1, this.fadeClock / FADE_SECONDS));
      if (this.fadeClock >= FADE_SECONDS) {
        // Recordings (?wait=1) stop after the last scene, on black, and say so; the demo itself goes round again.
        if (this.recording && this.place === this.order.length - 1) { this.waiting = true; window.dispatchEvent(new Event('demo-done')); return; }
        this.start((this.place + 1) % this.order.length);
      }
      return;
    }
    if (this.fading === 'in') {
      this.fadeClock += dt;
      this.fade.style.opacity = String(Math.max(0, 1 - this.fadeClock / FADE_SECONDS));
      if (this.fadeClock >= FADE_SECONDS) this.fading = null;
    }
    this.sceneClock += dt;
    while (this.nextEvent < scene.events.length && this.sceneClock >= scene.events[this.nextEvent][0]) {
      if (scene.events[this.nextEvent][1](this.hooks) === false) break;
      this.nextEvent++;
    }
    if (this.sceneClock >= Math.min(scene.seconds, this.cap) && this.fading === null) { this.fading = 'out'; this.fadeClock = 0; }
  }

  private start(place: number) {
    this.place = place;
    const index = this.order[place], scene = SCENES[index];
    this.scene = index;
    this.sceneClock = 0; this.nextEvent = 0;
    this.hooks.begin(scene.s, scene.lateral ?? 0);
    this.title.textContent = scene.title; this.text.textContent = scene.text;
    this.caption.classList.remove('swap'); void this.caption.offsetWidth; this.caption.classList.add('swap');
    this.fading = 'in'; this.fadeClock = 0;
  }
}
