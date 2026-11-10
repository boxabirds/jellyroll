/**
 * Renders the game's real sounds offline and measures them. Nobody can listen
 * during a test run, so these pin what a meter can see: every effect is audible
 * and does not clip, each kind of collectible sounds measurably different, and
 * the drone is a steady bed that brightens with speed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DRONE_NOTES, DRONE_VELOCITY, JP8, JP8_PARAM_COUNT, droneCutoff, dronePatch } from '../src/audio/drone.ts';
import { renderLayers } from '../src/audio/sfx-render.ts';
import { jumpSquish, landingSquish, magnetPickup, mergeSound, type Layer } from '../src/audio/sfx-sounds.ts';
import { BIOME_COUNT, DUNES, ICE, LAVA, MEADOW, SCREE } from '../src/game/biomes.ts';
import { KIND_NAMES } from '../src/game/mushrooms.ts';
import { MAX_SPEED } from '../src/game/tuning.ts';

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const CHANNELS = 2;
const BLOCK_SECONDS = BLOCK / SAMPLE_RATE;
const SMALL = 0, MEDIUM = 0.5, LARGE = 1;

/** A repeatable random source, so a failing measurement can be reproduced. */
function seeded(seed: number) {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

const render = (layers: Layer[]) => renderLayers(layers, SAMPLE_RATE);
const peak = (samples: Float32Array) => samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
const seconds = (samples: Float32Array) => samples.length / SAMPLE_RATE;
/** Zero crossings per second over a slice: a crude pitch and brightness meter. */
function crossingRate(samples: Float32Array, from = 0, to = 1) {
  const start = Math.floor(samples.length * from), end = Math.floor(samples.length * to);
  let count = 0;
  for (let i = start + 1; i < end; i++) if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) count++;
  return count / ((end - start) / SAMPLE_RATE);
}

const merge = (kind: number, size: number, climb = 0, seed = 7) => render(mergeSound(kind, size, climb, seeded(seed)));

test('every effect is audible, does not clip, and is over quickly', () => {
  const effects: [string, Float32Array][] = [
    ['jump', render(jumpSquish(seeded(1)))], ['soft landing', render(landingSquish(0.15, seeded(2)))],
    ['hard landing', render(landingSquish(1, seeded(3)))], ['magnet', render(magnetPickup(seeded(4)))],
  ];
  for (let kind = 0; kind < BIOME_COUNT; kind++) {
    for (const size of [SMALL, MEDIUM, LARGE]) effects.push([`${KIND_NAMES[kind]} size ${size}`, merge(kind, size)]);
  }
  for (const [name, samples] of effects) {
    assert.ok(peak(samples) > 0.2, `${name} peaks at only ${peak(samples)}`);
    assert.ok(peak(samples) < 1, `${name} clips at ${peak(samples)}`);
    assert.ok(seconds(samples) > 0.03 && seconds(samples) < 0.8, `${name} lasts ${seconds(samples)} s`);
    assert.ok(samples.every(Number.isFinite), `${name} has non-finite samples`);
  }
});

test('each kind of collectible merges with a measurably different sound', () => {
  const brightness: number[] = [];
  for (let kind = 0; kind < BIOME_COUNT; kind++) brightness[kind] = crossingRate(merge(kind, MEDIUM));
  // From dull to bright: the cactus boing, the mushroom plop, the crystal chime, the snow crunch, the ember hiss.
  const order = [DUNES, MEADOW, SCREE, ICE, LAVA];
  for (let i = 1; i < order.length; i++) {
    const duller = order[i - 1], brighter = order[i];
    assert.ok(
      brightness[brighter] > brightness[duller] * 1.3,
      `${KIND_NAMES[brighter]} (${brightness[brighter]}/s) is not clearly brighter than ${KIND_NAMES[duller]} (${brightness[duller]}/s)`,
    );
  }
  // The chime rings on well after a plop has finished.
  assert.ok(seconds(merge(SCREE, MEDIUM)) > seconds(merge(MEADOW, MEDIUM)) * 1.5);
});

test('a mushroom plop sweeps upward like a water drop', () => {
  const plop = merge(MEADOW, MEDIUM);
  const early = crossingRate(plop, 0.05, 0.3), late = crossingRate(plop, 0.6, 0.9);
  assert.ok(late > early * 1.4, `late ${late}/s vs early ${early}/s`);
});

test('smaller things sound higher, and a quick run of merges climbs', () => {
  for (const kind of [MEADOW, DUNES, SCREE]) {
    const small = crossingRate(merge(kind, SMALL)), large = crossingRate(merge(kind, LARGE));
    assert.ok(small > large * 1.3, `${KIND_NAMES[kind]}: small ${small}/s vs large ${large}/s`);
    const first = crossingRate(merge(kind, MEDIUM, 0)), sixth = crossingRate(merge(kind, MEDIUM, 5));
    assert.ok(sixth > first * 1.3, `${KIND_NAMES[kind]}: sixth of a run ${sixth}/s vs first ${first}/s`);
  }
});

test('a hard landing is bigger than a soft one, and no two takes are identical', () => {
  const soft = render(landingSquish(0.15, seeded(5))), hard = render(landingSquish(1, seeded(5)));
  assert.ok(seconds(hard) > seconds(soft) * 1.5, `hard ${seconds(hard)} s vs soft ${seconds(soft)} s`);
  assert.ok(peak(hard) > peak(soft), `hard ${peak(hard)} vs soft ${peak(soft)}`);
  const takeA = merge(ICE, MEDIUM, 0, 11), takeB = merge(ICE, MEDIUM, 0, 12);
  assert.ok(takeA.length !== takeB.length || takeA.some((sample, i) => sample !== takeB[i]), 'two takes rendered identically');
});

const peakOf = (blocks: Float32Array[], fromSeconds: number, toSeconds: number) => {
  let max = 0;
  for (let b = Math.floor(fromSeconds / BLOCK_SECONDS); b < Math.min(blocks.length, Math.ceil(toSeconds / BLOCK_SECONDS)); b++) {
    for (const sample of blocks[b]) max = Math.max(max, Math.abs(sample));
  }
  return max;
};

/** Zero crossings per second of the left channel over a span of rendered blocks. */
const crossings = (blocks: Float32Array[], fromSeconds: number, toSeconds: number) => {
  let count = 0, previous = 0;
  const first = Math.floor(fromSeconds / BLOCK_SECONDS), last = Math.min(blocks.length, Math.ceil(toSeconds / BLOCK_SECONDS));
  for (let b = first; b < last; b++) {
    for (let i = 0; i < BLOCK; i++) {
      const sample = blocks[b][i * CHANNELS];
      if ((sample >= 0) !== (previous >= 0)) count++;
      previous = sample;
    }
  }
  return count / ((last - first) * BLOCK_SECONDS);
};

/** Hold the drone chord on the JP-8 engine with the filter set for `speed`, for `seconds`. */
function renderDrone(seconds: number, speed: number): Float32Array[] {
  let engine!: {
    memory: WebAssembly.Memory; __wbindgen_externrefs: WebAssembly.Table; __wbindgen_start(): void;
    create_engine(id: number, rate: number): void; render(id: number): void; get_output_ptr(id: number): number;
    get_param_ptr(id: number): number; apply_params_from_buf(id: number): void; note_on(id: number, note: number, velocity: number): void;
  };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL('../src/audio/jp8/jp8_wasm_bg.wasm', import.meta.url))), {
    './jp8_wasm_bg.js': {
      __wbindgen_init_externref_table() {
        const table = engine.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined); table.set(offset, undefined); table.set(offset + 1, null);
        table.set(offset + 2, true); table.set(offset + 3, false);
      },
    },
  });
  engine = instance.exports as unknown as typeof engine;
  engine.__wbindgen_start();
  engine.create_engine(0, SAMPLE_RATE);
  const params = new Float32Array(engine.memory.buffer, engine.get_param_ptr(0), JP8_PARAM_COUNT);
  params.set(dronePatch());
  params[JP8.FILTER_CUTOFF] = droneCutoff(speed);
  engine.apply_params_from_buf(0);
  for (const note of DRONE_NOTES) engine.note_on(0, note, DRONE_VELOCITY);
  const output = new Float32Array(engine.memory.buffer, engine.get_output_ptr(0), BLOCK * CHANNELS);
  const blocks: Float32Array[] = [];
  for (let time = 0; time < seconds; time += BLOCK_SECONDS) { engine.render(0); blocks.push(Float32Array.from(output)); }
  return blocks;
}

test('the drone fades in, holds steady, never clips, and brightens with speed', () => {
  const CRAWL = 1;
  const slow = renderDrone(10, CRAWL), fast = renderDrone(10, MAX_SPEED);
  const early = peakOf(slow, 0, 0.1), settled = peakOf(slow, 5, 6), later = peakOf(slow, 9, 10);
  assert.ok(early < settled * 0.5, `drone starts abruptly: ${early} vs ${settled}`);
  assert.ok(settled > 0.02, `drone settles at only ${settled}`);
  assert.ok(later > settled * 0.5, `drone faded away: ${later} vs ${settled}`);
  assert.ok(peakOf(fast, 0, 10) < 0.98, 'drone clips at full rush');
  const dull = crossings(slow, 5, 9), bright = crossings(fast, 5, 9);
  assert.ok(bright > dull * 1.5, `fast ${bright} vs slow ${dull} crossings/s`);
  console.log(`drone level: slow ${settled.toFixed(3)}, fast ${peakOf(fast, 5, 9).toFixed(3)}`);
});
