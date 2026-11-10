/**
 * Renders every effect in pure Node (no browser, no audio device), writes each
 * to renders/<id>.wav and prints measurements as a table and as JSON.
 *   node experiments/sfx-trial/scripts/measure.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECTS } from '../sfx/catalogue.js';
import { MERGE_RUN_GAP_S, MERGE_RUN_LENGTH } from '../sfx/jelly-sounds.js';
import { renderLayers } from '../sfx/render.js';

const SAMPLE_RATE = 48000;
const SEED = 20261110;
const OTHER_SEED = 7;
/** A sound is "over" once it stays under this fraction of its peak. */
const TAIL_THRESHOLD = 0.05;
/** Pitch is read in windows of this length. */
const PITCH_WINDOW_S = 0.03;
/** The plop's dip is looked for in short windows hopped across its first part. */
const DIP_WINDOW_S = 0.016;
const DIP_HOP_S = 0.004;
const DIP_SEARCH_SHARE = 0.5;
const PITCH_SEARCH_MIN_HZ = 40;
const PITCH_SEARCH_MAX_HZ = 6000;
const PITCH_SEARCH_STEP_HZ = 5;
const CENTROID_MAX_HZ = 12000;
const CENTROID_STEP_HZ = 25;
/** Small laptop and phone speakers reproduce little below about this. */
const SMALL_SPEAKER_FLOOR_HZ = 300;
const PERCENT = 100;
const RENDER_TIMING_REPEATS = 200;
const WAV_HEADER_BYTES = 44;
const WAV_BYTES_PER_SAMPLE = 2;
const WAV_BITS = 16;
const WAV_PCM = 1;
const WAV_FMT_CHUNK_BYTES = 16;
const INT16_MAX = 32767;
const MS_PER_S = 1000;

/** Small seeded generator (mulberry32) so the measured renders are reproducible. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const peakOf = samples => samples.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0);
const rmsOf = samples => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / Math.max(1, samples.length));

/** Seconds until the last sample at or above TAIL_THRESHOLD of peak. */
function audibleLength(samples, peak) {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]) >= peak * TAIL_THRESHOLD) return (i + 1) / SAMPLE_RATE;
  }
  return 0;
}

/** Energy at one frequency in a Hann-windowed slice. */
function energyAt(slice, hz) {
  let re = 0, im = 0;
  const step = 2 * Math.PI * hz / SAMPLE_RATE;
  const n = slice.length;
  for (let i = 0; i < n; i++) {
    const windowed = slice[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    re += windowed * Math.cos(step * i);
    im += windowed * Math.sin(step * i);
  }
  return re * re + im * im;
}

/** The strongest frequency in the window starting at `startS`. */
function dominantHz(samples, startS, windowS = PITCH_WINDOW_S) {
  const from = Math.round(startS * SAMPLE_RATE);
  const slice = samples.subarray(from, from + Math.round(windowS * SAMPLE_RATE));
  let best = 0, bestEnergy = 0;
  for (let hz = PITCH_SEARCH_MIN_HZ; hz <= PITCH_SEARCH_MAX_HZ; hz += PITCH_SEARCH_STEP_HZ) {
    const energy = energyAt(slice, hz);
    if (energy > bestEnergy) { bestEnergy = energy; best = hz; }
  }
  return best;
}

/** Lowest pitch reached in the first part of the sound, and when: shows the dip before the rise. */
function pitchDip(samples, lengthS) {
  let lowest = Infinity, at = 0;
  for (let t = 0; t < lengthS * DIP_SEARCH_SHARE; t += DIP_HOP_S) {
    const hz = dominantHz(samples, t, DIP_WINDOW_S);
    if (hz < lowest) { lowest = hz; at = t; }
  }
  return `${lowest}@${Math.round((at + DIP_WINDOW_S / 2) * MS_PER_S)}ms`;
}

/** Where the energy sits on average: low for a thud, high for hiss. */
function centroidHz(samples) {
  let weighted = 0, total = 0;
  for (let hz = CENTROID_STEP_HZ; hz <= CENTROID_MAX_HZ; hz += CENTROID_STEP_HZ) {
    const energy = energyAt(samples, hz);
    weighted += energy * hz;
    total += energy;
  }
  return total ? weighted / total : 0;
}

/** Share of the energy that a small speaker can reproduce. */
function percentAbove(samples, floorHz) {
  let above = 0, total = 0;
  for (let hz = CENTROID_STEP_HZ; hz <= CENTROID_MAX_HZ; hz += CENTROID_STEP_HZ) {
    const energy = energyAt(samples, hz);
    total += energy;
    if (hz >= floorHz) above += energy;
  }
  return total ? Math.round(PERCENT * above / total) : 0;
}

/** Zero crossings per second over the audible part. */
function zeroCrossingRate(samples, lengthS) {
  const end = Math.round(lengthS * SAMPLE_RATE);
  let crossings = 0;
  for (let i = 1; i < end; i++) if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings++;
  return lengthS ? crossings / lengthS : 0;
}

function writeWav(path, samples) {
  const dataBytes = samples.length * WAV_BYTES_PER_SAMPLE;
  const wav = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(WAV_HEADER_BYTES - 8 + dataBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(WAV_FMT_CHUNK_BYTES, 16);
  wav.writeUInt16LE(WAV_PCM, 20);
  wav.writeUInt16LE(1, 22); // channels
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * WAV_BYTES_PER_SAMPLE, 28);
  wav.writeUInt16LE(WAV_BYTES_PER_SAMPLE, 32);
  wav.writeUInt16LE(WAV_BITS, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  samples.forEach((x, i) => {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * INT16_MAX), WAV_HEADER_BYTES + i * WAV_BYTES_PER_SAMPLE);
  });
  writeFileSync(path, wav);
}

const rendersDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'renders');
mkdirSync(rendersDir, { recursive: true });

const rows = EFFECTS.map(effect => {
  const samples = renderLayers(effect.layers(seeded(SEED)), SAMPLE_RATE);
  const again = renderLayers(effect.layers(seeded(OTHER_SEED)), SAMPLE_RATE);
  writeWav(join(rendersDir, `${effect.id}.wav`), samples);
  const peak = peakOf(samples);
  const length = audibleLength(samples, peak);
  const lastWindow = Math.max(0, length - PITCH_WINDOW_S);
  const started = performance.now();
  for (let i = 0; i < RENDER_TIMING_REPEATS; i++) renderLayers(effect.layers(Math.random), SAMPLE_RATE);
  const renderMs = (performance.now() - started) / RENDER_TIMING_REPEATS;
  return {
    id: effect.id,
    peak: +peak.toFixed(3),
    rms: +rmsOf(samples.subarray(0, Math.round(length * SAMPLE_RATE))).toFixed(3),
    msTo5pct: Math.round(length * MS_PER_S),
    hzEarly: dominantHz(samples, 0),
    hzMid: dominantHz(samples, lastWindow / 2),
    hzLate: dominantHz(samples, lastWindow),
    hzDip: effect.id.startsWith('plop') ? pitchDip(samples, length) : '',
    centroidHz: Math.round(centroidHz(samples)),
    pctAbove300Hz: percentAbove(samples, SMALL_SPEAKER_FLOOR_HZ),
    zeroCrossPerS: Math.round(zeroCrossingRate(samples, length)),
    otherSeedPeak: +peakOf(again).toFixed(3),
    otherSeedHzEarly: dominantHz(again, 0),
    otherSeedMs: Math.round(audibleLength(again, peakOf(again)) * MS_PER_S),
    clipped: peak > 1,
    renderMs: +renderMs.toFixed(2),
  };
});

console.table(rows);
const run = EFFECTS.find(effect => effect.id === 'merge-run');
const runSamples = renderLayers(run.layers(seeded(SEED)), SAMPLE_RATE);
const runStartHz = Array.from({ length: MERGE_RUN_LENGTH }, (_, step) => dominantHz(runSamples, step * MERGE_RUN_GAP_S, DIP_WINDOW_S));
console.log('merge-run: pitch at the start of each merge (Hz):', runStartHz.join(', '));
writeFileSync(join(rendersDir, 'measurements.json'), JSON.stringify({ sampleRate: SAMPLE_RATE, seed: SEED, rows, runStartHz }, null, 2));
