/**
 * Game sound, played on the JP-8 synth engine (Rust/WASM in an
 * AudioWorklet). One patch: a rubbery resonant pluck. Each merge plays it as a
 * quick two-note "bloop" with a burst of the engine's bubble oscillator, and
 * merges in quick succession climb a pentatonic scale.
 */
import type { Pickup } from '../game/physics.ts';
import { MUSHROOM_MAX_RADIUS, MUSHROOM_MIN_RADIUS } from '../game/tuning.ts';
import wasmUrl from './jp8/jp8_wasm_bg.wasm?url';

const PROCESSOR_NAME = 'jellyland-jp8';
const PARAM_COUNT = 68;
const MASTER_GAIN = 1.4;
const MUTE_STORAGE_KEY = 'jellyland.muted';
const ANALYSER_SIZE = 1024;

/** JP-8 parameter slots (see jp8/src/audio/jp8-engine.ts `P`). */
const P = {
  VCO1_WAVE: 0, VCO1_RANGE: 1, VCO1_PW: 2, VCO1_LEVEL: 3, VCO2_WAVE: 4, VCO2_RANGE: 5, VCO2_PW: 6, VCO2_LEVEL: 7,
  VCO2_DETUNE: 8, NOISE: 10, SUB_OSC: 11, FILTER_CUTOFF: 12, FILTER_RESO: 13, FILTER_ENV: 14, FILTER_KEY: 15, HPF_CUTOFF: 16,
  ENV1_A: 17, ENV1_D: 18, ENV1_S: 19, ENV1_R: 20, ENV2_A: 22, ENV2_D: 23, ENV2_S: 24, ENV2_R: 25,
  LFO_RATE: 26, CHORUS: 32, VOLUME: 33, ARP_RANGE: 37, ARP_TEMPO: 38, SPECTRAL_PARTIALS: 41, WG_BRIGHTNESS: 47, WG_BODY_MIX: 48,
  MODAL_MIX: 49, MODAL_MATERIAL: 50, MODAL_MODES: 52, CHAOS_RATE1: 55, CHAOS_RATE2: 56,
  BUBBLE_ENABLE: 61, BUBBLE_RATE: 62, BUBBLE_MIN_SIZE: 63, BUBBLE_MAX_SIZE: 64, BUBBLE_LEVEL: 65,
} as const;
const WAVE_SAW = 1;
const WAVE_PULSE = 2;
const CHORUS_BOTH = 3;

/** "Jelly bloop": pulse + octave saw through a resonant, fast-closing filter, on a rubbery modal body. */
const BLOOP_PATCH: readonly (readonly [number, number])[] = [
  [P.VCO1_WAVE, WAVE_PULSE], [P.VCO1_PW, 0.5], [P.VCO1_LEVEL, 0.7],
  [P.VCO2_WAVE, WAVE_SAW], [P.VCO2_RANGE, 1], [P.VCO2_PW, 0.5], [P.VCO2_LEVEL, 0.35], [P.VCO2_DETUNE, 0.06],
  [P.NOISE, 0.02], [P.SUB_OSC, 0.35],
  [P.FILTER_CUTOFF, 700], [P.FILTER_RESO, 0.6], [P.FILTER_ENV, 0.8], [P.FILTER_KEY, 0.6], [P.HPF_CUTOFF, 40],
  [P.ENV1_A, 0.001], [P.ENV1_D, 0.16], [P.ENV1_S, 0], [P.ENV1_R, 0.14],
  [P.ENV2_A, 0.002], [P.ENV2_D, 0.28], [P.ENV2_S, 0], [P.ENV2_R, 0.22],
  [P.LFO_RATE, 5], [P.CHORUS, CHORUS_BOTH], [P.VOLUME, 1],
  // Neutral values for modules this patch leaves off; zero is out of range for some.
  [P.ARP_RANGE, 1], [P.ARP_TEMPO, 120], [P.SPECTRAL_PARTIALS, 32], [P.WG_BRIGHTNESS, 0.5], [P.WG_BODY_MIX, 0.5],
  [P.MODAL_MIX, 0.25], [P.MODAL_MATERIAL, 0.12], [P.MODAL_MODES, 16], [P.CHAOS_RATE1, 5], [P.CHAOS_RATE2, 7],
  [P.BUBBLE_ENABLE, 0], [P.BUBBLE_RATE, 45], [P.BUBBLE_MIN_SIZE, 0.002], [P.BUBBLE_MAX_SIZE, 0.012], [P.BUBBLE_LEVEL, 0.5],
];

/** Major pentatonic, in semitones: every combination of these sounds sweet. */
const SCALE = [0, 2, 4, 7, 9] as const;
const SEMITONES_PER_OCTAVE = 12;
/** MIDI note of the lowest merge (C4); a big mushroom plays here, a small one an octave up. */
const BASE_NOTE = 60;
const FIFTH = 7;
/** Merges closer together than this climb the scale; a longer gap starts over. */
const COMBO_WINDOW_MS = 1400;
const COMBO_MAX_STEPS = 12;
/** MIDI velocities (0-127): the engine takes whole numbers, so a fraction would be silence. */
const VELOCITY = 108;
const ECHO_VELOCITY = 70;
/** The answering note of the bloop comes this long after the first. */
const ECHO_DELAY_MS = 75;
const NOTE_HOLD_MS = 130;
const BUBBLE_BURST_MS = 260;

export type SoundState = 'idle' | 'loading' | 'ready' | 'error';

export class JellySound {
  state: SoundState = 'idle';
  muted = readMuted();
  /** Merge sounds actually sent to the engine. */
  played = 0;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly samples = new Float32Array(ANALYSER_SIZE);
  private combo = 0;
  private lastMerge = Number.NEGATIVE_INFINITY;
  private bubbleTimer = 0;

  /** Browsers only allow audio after a user gesture; call this from one. Safe to call repeatedly. */
  start() {
    if (this.state !== 'idle') return;
    this.state = 'loading';
    void this.load().catch(error => {
      // Sound is a garnish: the game carries on silently, but say why.
      this.state = 'error';
      console.warn('[Jellyland] Sound unavailable:', error);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.gain) this.gain.gain.value = this.muted ? 0 : MASTER_GAIN;
    try { localStorage.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0'); } catch { /* private mode: not remembered */ }
  }

  /** The bloop for one merged mushroom. */
  merge(pickup: Pickup) {
    const node = this.node;
    if (this.state !== 'ready' || !node) return;
    const now = performance.now();
    this.combo = now - this.lastMerge < COMBO_WINDOW_MS ? Math.min(this.combo + 1, COMBO_MAX_STEPS) : 0;
    this.lastMerge = now;
    // Smaller mushrooms sit higher, like smaller drops.
    const smallness = 1 - (pickup.radius - MUSHROOM_MIN_RADIUS) / (MUSHROOM_MAX_RADIUS - MUSHROOM_MIN_RADIUS);
    const degree = this.combo + Math.round(smallness * SCALE.length);
    const note = BASE_NOTE + SCALE[degree % SCALE.length] + SEMITONES_PER_OCTAVE * Math.floor(degree / SCALE.length);
    this.pluck(node, note, VELOCITY, 0);
    this.pluck(node, note + FIFTH, ECHO_VELOCITY, ECHO_DELAY_MS);
    // A short fizz of bubbles under the notes.
    node.port.postMessage({ type: 'param', index: P.BUBBLE_ENABLE, value: 1 });
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => node.port.postMessage({ type: 'param', index: P.BUBBLE_ENABLE, value: 0 }), BUBBLE_BURST_MS);
    this.played++;
  }

  /** Loudest output peak heard so far, 0..1. Proof for automated checks that sound is really made. */
  loudest = 0;

  /** Sample the output level; call once a frame. Main thread only, no allocation. */
  listen() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (let i = 0; i < this.samples.length; i++) peak = Math.max(peak, Math.abs(this.samples[i]));
    if (peak > this.loudest) this.loudest = peak;
    return peak;
  }

  dispose() {
    clearTimeout(this.bubbleTimer);
    this.node?.port.postMessage({ type: 'all-notes-off' });
    this.node?.disconnect();
    void this.context?.close();
    this.node = null; this.context = null;
  }

  private pluck(node: AudioWorkletNode, note: number, velocity: number, delayMs: number) {
    window.setTimeout(() => node.port.postMessage({ type: 'note-on', note, velocity }), delayMs);
    window.setTimeout(() => node.port.postMessage({ type: 'note-off', note }), delayMs + NOTE_HOLD_MS);
  }

  private async load() {
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    const [wasmModule] = await Promise.all([
      WebAssembly.compileStreaming(fetch(wasmUrl)),
      context.audioWorklet.addModule(new URL('./jp8-worklet.js', import.meta.url)),
    ]);
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { wasmModule },
    });
    await new Promise<void>((resolve, reject) => {
      node.port.onmessage = event => {
        if (event.data.type === 'ready') resolve();
        else if (event.data.type === 'error') reject(new Error(event.data.message));
      };
    });
    const params = new Float32Array(PARAM_COUNT);
    for (const [index, value] of BLOOP_PATCH) params[index] = value;
    node.port.postMessage({ type: 'patch', params });
    const gain = context.createGain();
    gain.gain.value = this.muted ? 0 : MASTER_GAIN;
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_SIZE;
    node.connect(gain).connect(context.destination);
    node.connect(analyser);
    await context.resume();
    this.node = node; this.gain = gain; this.analyser = analyser;
    this.state = 'ready';
  }
}

function readMuted() {
  try { return localStorage.getItem(MUTE_STORAGE_KEY) === '1'; } catch { return false; }
}
