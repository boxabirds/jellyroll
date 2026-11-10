/**
 * Game sound. Two independent halves sharing one AudioContext:
 *   - effects: short sounds synthesised by ZzFX (sfx-sounds.ts says what,
 *     sfx-render.ts makes the samples) and played as plain audio buffers. No
 *     worklet, no WASM, nothing to fetch, so nothing that can fail to load;
 *   - drone: the JP-8 synth holding a pad in an AudioWorklet (drone.ts). It
 *     loads in the background, and if it fails the effects carry on.
 */
import { BIOME_COUNT } from '../game/biomes.ts';
import type { Ball } from '../game/physics.ts';
import { MUSHROOM_MAX_RADIUS, MUSHROOM_MIN_RADIUS } from '../game/tuning.ts';
import { DRONE_NOTES, DRONE_VELOCITY, JP8, droneCutoff, dronePatch } from './drone.ts';
import jp8WasmUrl from './jp8/jp8_wasm_bg.wasm?url';
import { renderLayers } from './sfx-render.ts';
import { CLIMB_RATIO, jumpSquish, landingSquish, magnetPickup, mergeSound, type Layer } from './sfx-sounds.ts';

const DRONE_PROCESSOR = 'jellyland-jp8';
/** Effects peak around 0.5-0.85 as rendered; the drone near 0.6 at its engine. The drone is a bed, well under the effects. */
const EFFECTS_GAIN = 0.8;
const DRONE_GAIN = 0.11;
const MUTE_STORAGE_KEY = 'jellyland.muted';
const ANALYSER_SIZE = 1024;
const MONO = 1;

/** Sounds are rendered once, up front, in a few sizes and takes; playback speed supplies the rest of the variety. */
const SIZE_STEPS = [0, 0.5, 1] as const;
const LANDING_STEPS = [0.15, 0.55, 1] as const;
const TAKES = 2;
/** Each trigger is played up to this fraction faster or slower, so repeats are never identical. */
const RATE_JITTER = 0.04;
/** Renders per tick while filling the pool, so loading never holds up a frame for long. */
const RENDERS_PER_TICK = 3;

/** Merges closer together than this climb in pitch; a longer gap starts over. */
const COMBO_WINDOW_MS = 1400;
const MAX_COMBO = 8;
/** Landings and knocks softer than this (m/s) are silent; FULL_IMPACT is as hard as they get. */
const MIN_IMPACT = 3;
const FULL_IMPACT = 14;
/** Landings closer together than this are one landing: bumpy ground would otherwise chatter. */
const IMPACT_GAP_MS = 150;
/** Several merges in one instant (a magnet's first sweep) would stack into a bang; they are spread this far apart. */
const MERGE_STAGGER_S = 0.045;

/** A limiter on the effects bus: overlapping sounds are squeezed, not clipped. */
const LIMIT_THRESHOLD_DB = -8;
const LIMIT_RATIO = 12;
const LIMIT_ATTACK_S = 0.002;
const LIMIT_RELEASE_S = 0.12;

/** The drone's filter is only re-sent when it has moved by this fraction. */
const CUTOFF_STEP = 0.04;
/** The filter follows speed at this rate (1/s), so it swells rather than jumps. */
const CUTOFF_FOLLOW_RATE = 2.5;

export type SoundState = 'idle' | 'loading' | 'ready' | 'error';

type Recipe = { key: string; layers: () => Layer[] };

const mergeKey = (kind: number, size: number, take: number) => `merge:${kind}:${size}:${take}`;
const landingKey = (step: number, take: number) => `landing:${step}:${take}`;
const takeKey = (name: string, take: number) => `${name}:${take}`;

/** Everything the game can play, each in TAKES slightly different renders. */
function recipes(): Recipe[] {
  const list: Recipe[] = [];
  for (let take = 0; take < TAKES; take++) {
    for (let kind = 0; kind < BIOME_COUNT; kind++) {
      SIZE_STEPS.forEach((size, step) => list.push({ key: mergeKey(kind, step, take), layers: () => mergeSound(kind, size) }));
    }
    LANDING_STEPS.forEach((intensity, step) => list.push({ key: landingKey(step, take), layers: () => landingSquish(intensity) }));
    list.push({ key: takeKey('jump', take), layers: () => jumpSquish() });
    list.push({ key: takeKey('magnet', take), layers: () => magnetPickup() });
  }
  return list;
}

/** Index of the entry of `steps` nearest to `value`. */
function nearest(steps: readonly number[], value: number) {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - value) < Math.abs(steps[best] - value)) best = i;
  return best;
}

export class JellySound {
  /** State of the drone; effects need only the audio context. */
  state: SoundState = 'idle';
  muted = readMuted();
  /** Effects triggered so far (merges, jumps, landings, pickups). */
  played = 0;
  /** Loudest output peak heard so far, 0..1. Proof for automated checks that sound is really made. */
  loudest = 0;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: AudioNode | null = null;
  private analyser: AnalyserNode | null = null;
  private drone: AudioWorkletNode | null = null;
  private readonly pool = new Map<string, AudioBuffer>();
  private readonly recipes = new Map(recipes().map(recipe => [recipe.key, recipe]));
  private readonly samples = new Float32Array(ANALYSER_SIZE);
  private take = 0;
  private combo = 0;
  private lastMerge = Number.NEGATIVE_INFINITY;
  private lastImpact = Number.NEGATIVE_INFINITY;
  private cutoff = droneCutoff(0);
  private sentCutoff = 0;

  /** 'running' once the browser is actually letting sound out. */
  get contextState(): string { return this.context?.state ?? 'none'; }

  /**
   * Browsers only allow audio after a user gesture, and some only if the
   * context is created and resumed inside the gesture itself. Call this from
   * every key press: the first call builds everything, later calls revive a
   * context the browser has suspended.
   */
  start() {
    if (this.context) {
      if (this.context.state !== 'running') void this.context.resume();
      return;
    }
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    void context.resume();

    const master = context.createGain();
    master.gain.value = this.muted ? 0 : 1;
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_SIZE;
    master.connect(context.destination);
    master.connect(analyser);
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = LIMIT_THRESHOLD_DB;
    limiter.ratio.value = LIMIT_RATIO;
    limiter.attack.value = LIMIT_ATTACK_S;
    limiter.release.value = LIMIT_RELEASE_S;
    const effects = context.createGain();
    effects.gain.value = EFFECTS_GAIN;
    effects.connect(limiter).connect(master);
    this.master = master; this.analyser = analyser; this.effects = effects;

    this.fillPool([...this.recipes.keys()]);
    this.state = 'loading';
    void this.loadDrone(context, master).catch(error => {
      // The drone is a garnish: effects and the game carry on, but say why it is missing.
      this.state = 'error';
      console.warn('[Jellyland] Drone unavailable:', error);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    try { localStorage.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0'); } catch { /* private mode: not remembered */ }
  }

  /** Turn one physics step's events into effects. */
  step(ball: Ball) {
    const now = performance.now();
    for (let i = 0; i < ball.pickupCount; i++) {
      const pickup = ball.pickups[i];
      this.combo = now - this.lastMerge < COMBO_WINDOW_MS ? Math.min(this.combo + 1, MAX_COMBO) : 0;
      this.lastMerge = now;
      const size = (pickup.radius - MUSHROOM_MIN_RADIUS) / (MUSHROOM_MAX_RADIUS - MUSHROOM_MIN_RADIUS);
      // Each kind has its own sound; a quick run of merges climbs in pitch.
      this.play(mergeKey(pickup.kind, nearest(SIZE_STEPS, size), this.nextTake()), CLIMB_RATIO ** this.combo, 1, i * MERGE_STAGGER_S);
    }
    if (ball.magnetPicked) this.play(takeKey('magnet', this.nextTake()));
    if (ball.jumped) this.play(takeKey('jump', this.nextTake()));
    const impact = Math.max(ball.impact, ball.rockImpact);
    if (impact >= MIN_IMPACT && now - this.lastImpact >= IMPACT_GAP_MS) {
      this.lastImpact = now;
      const strength = Math.min(1, (impact - MIN_IMPACT) / (FULL_IMPACT - MIN_IMPACT));
      this.play(landingKey(nearest(LANDING_STEPS, strength), this.nextTake()));
    }
  }

  /** Once a frame: move the drone's filter with speed and sample the output level. */
  frame(ball: Ball, dt: number) {
    const speed = ball.wornOut ? 0 : Math.hypot(ball.vx, ball.vy, ball.vz);
    this.cutoff += (droneCutoff(speed) - this.cutoff) * Math.min(1, CUTOFF_FOLLOW_RATE * dt);
    if (this.drone && Math.abs(this.cutoff - this.sentCutoff) > this.sentCutoff * CUTOFF_STEP) {
      this.sentCutoff = this.cutoff;
      this.drone.port.postMessage({ type: 'param', index: JP8.FILTER_CUTOFF, value: this.cutoff });
    }
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.samples);
      for (let i = 0; i < this.samples.length; i++) this.loudest = Math.max(this.loudest, Math.abs(this.samples[i]));
    }
  }

  /** New run: the merge streak starts over. */
  reset() {
    this.combo = 0;
  }

  dispose() {
    this.drone?.port.postMessage({ type: 'all-notes-off' });
    void this.context?.close();
    this.context = null; this.drone = null; this.effects = null; this.master = null;
  }

  private nextTake() {
    this.take = (this.take + 1) % TAKES;
    return this.take;
  }

  /**
   * @param rate playback speed: pitch and length together
   * @param delay seconds from now
   */
  private play(key: string, rate = 1, gain = 1, delay = 0) {
    const context = this.context, effects = this.effects;
    if (!context || !effects) return;
    // Asked for before the pool reached it: render it now, once.
    const buffer = this.pool.get(key) ?? this.render(key);
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (1 + RATE_JITTER * (2 * Math.random() - 1));
    if (gain === 1) {
      source.connect(effects);
    } else {
      const level = context.createGain();
      level.gain.value = gain;
      source.connect(level).connect(effects);
    }
    source.start(context.currentTime + delay);
    this.played++;
  }

  private render(key: string): AudioBuffer | undefined {
    const context = this.context, recipe = this.recipes.get(key);
    if (!context || !recipe) return undefined;
    const samples = renderLayers(recipe.layers(), context.sampleRate);
    const buffer = context.createBuffer(MONO, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    this.pool.set(key, buffer);
    return buffer;
  }

  /** Render the pool a few sounds at a time, yielding between batches. */
  private fillPool(keys: string[]) {
    for (let i = 0; i < RENDERS_PER_TICK && keys.length > 0; i++) {
      const key = keys.shift()!;
      if (!this.pool.has(key)) this.render(key);
    }
    if (keys.length > 0 && this.context) setTimeout(() => this.fillPool(keys), 0);
  }

  private async loadDrone(context: AudioContext, master: GainNode) {
    const [wasmModule] = await Promise.all([
      compileWasm(jp8WasmUrl),
      context.audioWorklet.addModule(new URL('./jp8-worklet.js', import.meta.url)),
    ]);
    const drone = new AudioWorkletNode(context, DRONE_PROCESSOR, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { wasmModule },
    });
    await new Promise<void>((resolve, reject) => {
      drone.port.onmessage = event => {
        if (event.data.type === 'ready') resolve();
        else if (event.data.type === 'error') reject(new Error(event.data.message));
      };
    });
    drone.port.postMessage({ type: 'patch', params: dronePatch() });
    for (const note of DRONE_NOTES) drone.port.postMessage({ type: 'note-on', note, velocity: DRONE_VELOCITY });
    const droneGain = context.createGain();
    droneGain.gain.value = DRONE_GAIN;
    drone.connect(droneGain).connect(master);
    this.drone = drone;
    this.state = 'ready';
  }
}

/** Streaming compilation needs the host to serve .wasm as application/wasm; not every static host does. */
async function compileWasm(url: string) {
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch {
    return WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  }
}

function readMuted() {
  try { return localStorage.getItem(MUTE_STORAGE_KEY) === '1'; } catch { return false; }
}
