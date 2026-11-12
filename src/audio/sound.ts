/**
 * Game sound. Two independent halves sharing one AudioContext:
 *   - effects: recorded CC0 sounds where there is a recipe for the event
 *     (sample-sounds.ts), played with a random recipe and a little pitch
 *     variation; everything else (jump, magnet, seed packet, lava ember) and
 *     anything not yet loaded is synthesised by ZzFX (sfx-sounds.ts), as plain
 *     audio buffers with nothing to fetch, so effects can never be silent;
 *   - drone: the JP-8 synth holding a pad in an AudioWorklet (drone.ts). It
 *     loads in the background, and if it fails the effects carry on.
 */
import { BIOME_COUNT, CAVE, DUNES, ICE, LAVA, MEADOW, snowAt } from '../game/biomes.ts';
import type { Ball } from '../game/physics.ts';
import { BEE_MAX, MUSHROOM_MAX_RADIUS, MUSHROOM_MIN_RADIUS } from '../game/tuning.ts';
import { DRONE_NOTES, DRONE_VELOCITY, JP8, droneCutoff, dronePatch } from './drone.ts';
import { allSampleFiles, holeVariants, landingVariants, marbleBreakVariants, marbleHitVariants, MARBLE_ROLL_FILE, mergeVariants, type HoleSound, type SampleVariant } from './sample-sounds.ts';
import jp8WasmUrl from './jp8/jp8_wasm_bg.wasm?url';
import { holeHiss, holeSizzle, holeSplash, holeStab } from './hazard-sounds.ts';
import { renderLayers } from './sfx-render.ts';
import { renderSnowLoop } from './snow-sounds.ts';
import { renderMetalLoop } from './metal-sounds.ts';
import { renderBuzzLoop, buzzLevel, dopplerRate, BUZZ_GAIN } from './bee-sounds.ts';
import { beePickup, glassPickup, letterThump, levelUp, packetPickup, stoneImpact } from './companion-sounds.ts';
import { CLIMB_RATIO, jumpSquish, landingSquish, magnetPickup, mergeSound, seedSpray, type Layer } from './sfx-sounds.ts';

const DRONE_PROCESSOR = 'jellyland-jp8';
/** Recorded sounds are found by file name among the bundled files. */
const SAMPLE_URLS = import.meta.glob('./samples/*.{ogg,mp3}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
/** Recorded files come at very different loudnesses, so each is scaled to this peak (never boosted more than the cap). */
const SAMPLE_TARGET_PEAK = 0.7;
const SAMPLE_MAX_BOOST = 4;
/** Each recorded sound is played up to this fraction faster or slower, so no two are the same. */
const SAMPLE_PITCH_JITTER = 0.06;
/** Bigger collectibles play lower: playback speed for the smallest and the largest. */
const SAMPLE_RATE_SMALL = 1.25;
const SAMPLE_RATE_LARGE = 0.8;
/** Each merge in a quick run is this many semitones higher (gentler than the synth, which sounds fine climbing fast). */
const SAMPLE_CLIMB_SEMITONES = 0.7;
const SEMITONES_PER_OCTAVE = 12;
/** A landing is this loud at the softest, rising to full strength for the hardest. */
const LANDING_MIN_GAIN = 0.55;
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
/** A hole is entered once the jelly is this far into it; the next entry sound waits at least this long. */
const HOLE_ENTER_DEPTH = 0.5;
const HOLE_GAP_MS = 350;
/** While the jelly stays in water or lava it keeps sloshing or bubbling, this often (milliseconds). */
const HOLE_WADE_GAP_MS = 420;
const WADE_GAIN = 0.55;
/** A plunge is quietest at this speed (m/s) or less and loudest at FULL_PLUNGE_SPEED; a faster fall also plays lower. */
const SOFT_PLUNGE_SPEED = 3;
const FULL_PLUNGE_SPEED = 20;
const PLUNGE_MIN_GAIN = 0.5;
const PLUNGE_SLOW_RATE = 0.9;
/** How long the test probe listens for the output after playing something. */
const PROBE_LISTEN_MS = 600;
/** Several merges in one instant (a magnet's first sweep) would stack into a bang; they are spread this far apart. */
const MERGE_STAGGER_S = 0.045;

/** A limiter on the effects bus: overlapping sounds are squeezed, not clipped. */
const LIMIT_THRESHOLD_DB = -8;
const LIMIT_RATIO = 12;
const LIMIT_ATTACK_S = 0.002;
const LIMIT_RELEASE_S = 0.12;

/**
 * Snow: a rustle loop runs all the time and is heard whenever the jelly is rolling on snow, louder the faster it goes
 * and the more of the ground is snow; it eases in and out, and is kept low.
 */
const SNOW_ROLL_GAIN = 0.2;
const SNOW_EASE_SECONDS = 0.18;
/** Speed (m/s) at which the rustle is full, and the least it ever is while rolling at all. */
const SNOW_ROLL_FULL_SPEED = 20;
const SNOW_ROLL_MIN_SHARE = 0.25;
/** The rustle plays a little faster as the jelly does. */
/** The marble's rolling loop, set up like the snow's: how loud it is and how quiet at a crawl. Its pitch is the recording's own at every speed. */
const METAL_ROLL_GAIN = 0.45;
const METAL_ROLL_MIN_SHARE = 0.45;
const STONE_MIN_GAIN = 0.55;
const MARBLE_MIN_IMPACT = 1.2;
const CENTS_PER_OCTAVE = 1200;
const MARBLE_JUMP_RATE = 1.3;
const MARBLE_JUMP_GAIN = 0.4;
const SPIKE_BREAK_RATE = 1.15;
const SPIKE_CRACK_RATE = 1.4;
const SPIKE_CRACK_GAIN = 0.45;
/** Bee buzz: how quickly loudness, pitch and pan follow the bee (s), how far apart the bees' pitches sit, and how far to the side the loudest pan goes. */
const BUZZ_EASE_SECONDS = 0.06;
const BUZZ_DETUNE = 0.035;
const BUZZ_PAN = 0.8;
const SNOW_ROLL_RATE_SLOW = 0.85;
const SNOW_ROLL_RATE_FAST = 1.2;

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
    list.push({ key: takeKey('seeds', take), layers: () => seedSpray() });
    list.push({ key: takeKey('glass', take), layers: () => glassPickup() });
    LANDING_STEPS.forEach((intensity, step) => list.push({ key: takeKey(`stone${step}`, take), layers: () => stoneImpact(intensity) }));
    list.push({ key: takeKey('bee', take), layers: () => beePickup() });
    list.push({ key: takeKey('packet', take), layers: () => packetPickup() });
    list.push({ key: takeKey('thump', take), layers: () => letterThump(false) });
    list.push({ key: takeKey('thump-soft', take), layers: () => letterThump(true) });
    list.push({ key: takeKey('levelup', take), layers: () => levelUp() });
    list.push({ key: takeKey('splash', take), layers: () => holeSplash() });
    list.push({ key: takeKey('stab', take), layers: () => holeStab() });
    list.push({ key: takeKey('hiss', take), layers: () => holeHiss() });
    list.push({ key: takeKey('sizzle', take), layers: () => holeSizzle() });
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
  private readonly recorded = new Map<string, { buffer: AudioBuffer; gain: number }>();
  /** Whether the last merge sound was a recorded one or the synth fallback: for automated checks. */
  lastMergeSource: 'sample' | 'synth' | 'none' = 'none';
  private readonly recipes = new Map(recipes().map(recipe => [recipe.key, recipe]));
  private readonly samples = new Float32Array(ANALYSER_SIZE);
  private take = 0;
  private combo = 0;
  private lastMerge = Number.NEGATIVE_INFINITY;
  private lastImpact = Number.NEGATIVE_INFINITY;
  private inHole = false;
  private lastHole = Number.NEGATIVE_INFINITY;
  private lastWade = Number.NEGATIVE_INFINITY;
  private snowLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private metalLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private metalRecorded = false;
  /** One buzz per bee: a looping source with its own loudness and pan, and where the bee was last frame (for its Doppler). */
  private readonly buzzes: { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; detune: number }[] = [];
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

    this.startSnowLoop(context, effects);
    this.metalLoop = this.startLoop(context, effects, renderMetalLoop(context.sampleRate));
    this.startBuzzes(context, effects);
    this.fillPool([...this.recipes.keys()]);
    void this.loadSamples(context);
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
      this.mergeSound(pickup.kind, pickup.radius, this.combo, i * MERGE_STAGGER_S);
    }
    if (ball.magnetPicked) this.play(takeKey('magnet', this.nextTake()));
    if (ball.seedsSprayed) this.play(takeKey('seeds', this.nextTake()));
    if (ball.glassPicked) this.play(takeKey('glass', this.nextTake()));
    if (ball.packetFound) this.play(takeKey('packet', this.nextTake()));
    if (ball.beePicked) this.play(takeKey('bee', this.nextTake()));
    if (ball.shieldUp >= 0 || ball.flock.levelledUp) this.play(takeKey('levelup', this.nextTake()));
    // A marble does not squish as it jumps: it leaves the ground with a light knock of stone.
    if (ball.jumped) {
      if (ball.glassSeconds > 0) this.playVariant(marbleHitVariants()[0], MARBLE_JUMP_RATE, MARBLE_JUMP_GAIN, 0);
      else this.play(takeKey('jump', this.nextTake()));
    }
    if (ball.brokenCount > 0) this.playVariant(marbleBreakVariants()[0], 1, 1, 0);
    // The cave: a stalagmite knocked over and a stalactite landing both break like rock; one letting go cracks, higher and quieter.
    if (ball.toppledCount > 0 || ball.landedCount > 0) this.playVariant(marbleBreakVariants()[0], SPIKE_BREAK_RATE, 1, 0);
    if (ball.cracked > 0) this.playVariant(marbleBreakVariants()[0], SPIKE_CRACK_RATE, SPIKE_CRACK_GAIN, 0);
    this.holeSounds(ball, now);
    const impact = Math.max(ball.impact, ball.rockImpact);
    // A marble is hard: even a small landing knocks.
    const least = ball.glassSeconds > 0 ? MARBLE_MIN_IMPACT : MIN_IMPACT;
    if (impact >= least && now - this.lastImpact >= IMPACT_GAP_MS) {
      this.lastImpact = now;
      const strength = Math.min(1, Math.max(0, (impact - MIN_IMPACT) / (FULL_IMPACT - MIN_IMPACT)));
      if (ball.glassSeconds > 0) {
        // A glass marble hits like a boulder on rock, whatever it hit: a real rock hit, two octaves down.
        const gain = STONE_MIN_GAIN + (1 - STONE_MIN_GAIN) * strength;
        const variants = marbleHitVariants();
        if (!this.playVariant(variants[Math.floor(Math.random() * variants.length)], 1, gain, 0)) {
          this.play(takeKey(`stone${nearest(LANDING_STEPS, strength)}`, this.nextTake()), 1, gain);
        }
        return;
      }
      const variants = landingVariants(strength);
      const played = this.playVariant(variants[Math.floor(Math.random() * variants.length)], 1, LANDING_MIN_GAIN + (1 - LANDING_MIN_GAIN) * strength, 0);
      if (!played) this.play(landingKey(nearest(LANDING_STEPS, strength), this.nextTake()));
    }
  }

  /** Falling into a hole, being stabbed by a shard, a vent throwing the jelly, and wading on through it. Recorded sounds first, ZzFX until they load. */
  private holeSounds(ball: Ball, now: number) {
    const inside = ball.hazardDepth >= HOLE_ENTER_DEPTH && ball.grounded;
    const kind = ball.hazardKind;
    const water = kind === MEADOW || kind === DUNES || kind === CAVE;
    if (inside && !this.inHole && now - this.lastHole >= HOLE_GAP_MS) {
      this.lastHole = now; this.lastWade = now;
      const speed = Math.hypot(ball.vx, ball.vz);
      const strength = Math.min(1, Math.max(0, (speed - SOFT_PLUNGE_SPEED) / (FULL_PLUNGE_SPEED - SOFT_PLUNGE_SPEED)));
      const gain = PLUNGE_MIN_GAIN + (1 - PLUNGE_MIN_GAIN) * strength;
      const rate = 1 - (1 - PLUNGE_SLOW_RATE) * strength;
      if (water) this.holeSample('splash', rate, gain, () => this.play(takeKey('splash', this.nextTake()), rate, gain));
      else if (kind === LAVA) this.holeSample('lava', rate, gain, () => this.play(takeKey('sizzle', this.nextTake()), rate, gain));
      else if (kind === ICE) this.holeSample('stab', 1, 0.7, () => this.play(takeKey('stab', this.nextTake()), 0.8, 0.7));
    } else if (inside && (water || kind === LAVA) && now - this.lastWade >= HOLE_WADE_GAP_MS) {
      this.lastWade = now;
      this.holeSample(water ? 'wade' : 'bloop', 1, WADE_GAIN, () => {});
    }
    this.inHole = inside;
    if (ball.stabs > 0) this.holeSample('stab', 1, 1, () => this.play(takeKey('stab', this.nextTake())));
    if (ball.vented) this.holeSample('hiss', 1, 1, () => this.play(takeKey('hiss', this.nextTake())));
  }

  /** Play a random recorded recipe for a hole event, or `fallback` if the files have not loaded. */
  private holeSample(sound: HoleSound, rate: number, gain: number, fallback: () => void) {
    const variants = holeVariants(sound);
    if (!this.playVariant(variants[Math.floor(Math.random() * variants.length)], rate, gain, 0)) fallback();
  }

  /**
   * The sound of a collectible merging: a recorded recipe if there is one for
   * its kind and it has loaded, otherwise the synthesised sound.
   * @param radius the collectible's size; bigger plays lower
   * @param combo  merges in a quick run so far; each is a little higher
   */
  mergeSound(kind: number, radius: number, combo: number, delay = 0) {
    const size = Math.min(1, Math.max(0, (radius - MUSHROOM_MIN_RADIUS) / (MUSHROOM_MAX_RADIUS - MUSHROOM_MIN_RADIUS)));
    const variants = mergeVariants(kind);
    if (variants) {
      const rate = (SAMPLE_RATE_SMALL + (SAMPLE_RATE_LARGE - SAMPLE_RATE_SMALL) * size) * 2 ** ((combo * SAMPLE_CLIMB_SEMITONES) / SEMITONES_PER_OCTAVE);
      if (this.playVariant(variants[Math.floor(Math.random() * variants.length)], rate, 1, delay)) { this.lastMergeSource = 'sample'; return; }
    }
    this.lastMergeSource = 'synth';
    // Each kind has its own synthesised sound; a quick run of merges climbs in pitch.
    this.play(mergeKey(kind, nearest(SIZE_STEPS, size), this.nextTake()), CLIMB_RATIO ** combo, 1, delay);
  }

  /** How many recorded sounds have loaded so far, and how many there are. For automated checks. */
  get samplesLoaded() { return this.recorded.size; }
  readonly samplesExpected = allSampleFiles().length;

  /**
   * Play one recipe: all its layers, each at its own speed, loudness and delay.
   * Returns false (playing nothing) if the context is not up or a file has not loaded yet.
   */
  private playVariant(variant: SampleVariant, rate: number, gain: number, delay: number, cents?: number): boolean {
    const context = this.context, effects = this.effects;
    if (!context || !effects) return false;
    for (const layer of variant) if (!this.recorded.has(layer.file)) return false;
    // Each play is a little off in pitch: by the usual amount, or by up to `cents` hundredths of a semitone either way if given.
    const jitter = cents === undefined ? 1 + SAMPLE_PITCH_JITTER * (2 * Math.random() - 1) : 2 ** ((cents * (2 * Math.random() - 1)) / CENTS_PER_OCTAVE);
    const start = context.currentTime + delay;
    for (const layer of variant) {
      const sample = this.recorded.get(layer.file)!;
      const source = context.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = layer.rate * rate * jitter;
      const level = context.createGain();
      level.gain.value = layer.gain * sample.gain * gain;
      source.connect(level).connect(effects);
      source.start(start + layer.delay);
    }
    this.played++;
    return true;
  }

  /** Fetch and decode every recorded sound, measuring each one's peak so they can be levelled. */
  private async loadSamples(context: AudioContext) {
    await Promise.all(allSampleFiles().map(async file => {
      try {
        const url = SAMPLE_URLS[`./samples/${file}`];
        if (!url) throw new Error('not bundled');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        let peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        }
        this.recorded.set(file, { buffer, gain: Math.min(SAMPLE_MAX_BOOST, SAMPLE_TARGET_PEAK / Math.max(peak, 1e-3)) });
      } catch (error) {
        // The synthesised sound covers for a file that cannot be loaded.
        console.warn('[Jellyland] Could not load recorded sound', file, error);
      }
    }));
  }

  /**
   * Test hook: play one merge sound of `kind` and report which kind of sound it was
   * and the loudest output heard over the next half second.
   */
  async probeMerge(kind: number, radius: number): Promise<{ source: string; peak: number }> {
    this.loudest = 0;
    this.mergeSound(kind, radius, 0);
    await new Promise(resolve => setTimeout(resolve, PROBE_LISTEN_MS));
    return { source: this.lastMergeSource, peak: this.loudest };
  }

  /** Once a frame: move the drone's filter with speed and sample the output level. */
  /** One silent buzz per possible bee, each a little off the others in pitch so four do not sound as one. */
  private startBuzzes(context: AudioContext, effects: AudioNode) {
    const samples = renderBuzzLoop(context.sampleRate);
    const buffer = context.createBuffer(MONO, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    for (let i = 0; i < BEE_MAX; i++) {
      const source = context.createBufferSource();
      source.buffer = buffer; source.loop = true;
      const gain = context.createGain();
      gain.gain.value = 0;
      const pan = context.createStereoPanner();
      source.connect(gain).connect(pan).connect(effects);
      source.start(context.currentTime, (i / BEE_MAX) * buffer.duration);
      this.buzzes.push({ source, gain, pan, detune: 1 + (i - (BEE_MAX - 1) / 2) * BUZZ_DETUNE });
    }
  }

  /** Each bee's buzz: louder the nearer it is to the jelly, bent in pitch by how fast it is closing, panned to the side it is on. */
  private buzzFrame(ball: Ball) {
    const context = this.context;
    if (!context || this.buzzes.length === 0) return;
    const now = context.currentTime;
    const flock = ball.flock;
    const speed = Math.hypot(ball.vx, ball.vz);
    const rightX = speed > 1 ? -ball.vz / speed : 1, rightZ = speed > 1 ? ball.vx / speed : 0;
    for (let i = 0; i < this.buzzes.length; i++) {
      const buzz = this.buzzes[i];
      if (i >= flock.count || ball.wornOut) { buzz.gain.gain.setTargetAtTime(0, now, BUZZ_EASE_SECONDS); continue; }
      const bee = flock.bees[i];
      const dx = bee.x - ball.x, dy = bee.y - ball.y, dz = bee.z - ball.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Closing speed: how fast the gap is shrinking, from the two velocities (not from last frame, which is noisy).
      const closing = distance > 0.01 ? -((bee.vx - ball.vx) * dx + (bee.vy - ball.vy) * dy + (bee.vz - ball.vz) * dz) / distance : 0;
      buzz.gain.gain.setTargetAtTime(buzzLevel(distance) * BUZZ_GAIN, now, BUZZ_EASE_SECONDS);
      buzz.source.playbackRate.setTargetAtTime(dopplerRate(closing) * buzz.detune, now, BUZZ_EASE_SECONDS);
      buzz.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, ((dx * rightX + dz * rightZ) / Math.max(distance, 1)) * BUZZ_PAN)), now, BUZZ_EASE_SECONDS);
    }
  }

  /** Start a seamless loop from `samples`, silent. */
  private startLoop(context: AudioContext, effects: AudioNode, samples: Float32Array) {
    const buffer = context.createBuffer(MONO, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer; source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(effects);
    source.start();
    return { source, gain };
  }

  /** Start the snow rustle loop, silent. */
  private startSnowLoop(context: AudioContext, effects: AudioNode) {
    this.snowLoop = this.startLoop(context, effects, renderSnowLoop(context.sampleRate));
  }

  /** The marble's rolling: metal on concrete, whenever it touches the ground, louder the faster it goes, at the same pitch. */
  private metalFrame(ball: Ball) {
    const context = this.context, effects = this.effects;
    if (!this.metalLoop || !context || !effects) return;
    // Once the recorded stone sliding has loaded it takes over from the synthesised stand-in.
    const recorded = this.recorded.get(MARBLE_ROLL_FILE);
    if (recorded && !this.metalRecorded) {
      this.metalRecorded = true;
      this.metalLoop.source.stop();
      const source = context.createBufferSource();
      source.buffer = recorded.buffer; source.loop = true;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(effects);
      source.start();
      this.metalLoop = { source, gain };
    }
    const loop = this.metalLoop;
    const speed = Math.hypot(ball.vx, ball.vz);
    const fast = Math.min(1, speed / SNOW_ROLL_FULL_SPEED);
    const rolling = ball.grounded && !ball.wornOut && ball.glassSeconds > 0 ? 1 : 0;
    const now = context.currentTime;
    loop.gain.gain.setTargetAtTime(rolling * (METAL_ROLL_MIN_SHARE + (1 - METAL_ROLL_MIN_SHARE) * fast) * METAL_ROLL_GAIN, now, SNOW_EASE_SECONDS);
  }

  /** The rustle is heard while the jelly touches snow, whether or not any is sticking. */
  private snowFrame(ball: Ball) {
    const loop = this.snowLoop, context = this.context;
    if (!loop || !context) return;
    const speed = Math.hypot(ball.vx, ball.vz);
    const fast = Math.min(1, speed / SNOW_ROLL_FULL_SPEED);
    const rolling = ball.grounded && !ball.wornOut && ball.glassSeconds <= 0 ? snowAt(-ball.z) : 0;
    const level = rolling * (SNOW_ROLL_MIN_SHARE + (1 - SNOW_ROLL_MIN_SHARE) * fast);
    const now = context.currentTime;
    loop.gain.gain.setTargetAtTime(level * SNOW_ROLL_GAIN, now, SNOW_EASE_SECONDS);
    loop.source.playbackRate.setTargetAtTime(SNOW_ROLL_RATE_SLOW + (SNOW_ROLL_RATE_FAST - SNOW_ROLL_RATE_SLOW) * fast, now, SNOW_EASE_SECONDS);
  }

  frame(ball: Ball, dt: number) {
    this.snowFrame(ball);
    this.metalFrame(ball);
    this.buzzFrame(ball);
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
    this.snowLoop?.source.stop();
    this.snowLoop = null;
    this.metalLoop?.source.stop();
    this.metalLoop = null;
    for (const buzz of this.buzzes) buzz.source.stop();
    this.buzzes.length = 0;
    this.drone?.port.postMessage({ type: 'all-notes-off' });
    void this.context?.close();
    this.context = null; this.drone = null; this.effects = null; this.master = null;
  }

  /** A giant name letter landing (or, when `soft`, the refusal wobble). Starts the sound if a key press has not already. */
  thump(soft = false) {
    this.start();
    this.play(takeKey(soft ? 'thump-soft' : 'thump', this.nextTake()));
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
