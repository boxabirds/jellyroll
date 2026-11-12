/**
 * The sound of the jelly rolling over snow: one seamless loop, made once from noise: a low, soft rustle with the
 * occasional squeak of crunch. It runs all the time the jelly is on snow and only its loudness follows the speed.
 */
export const SNOW_LOOP_SECONDS = 2.4;
/** The two ends of the loop are blended over this long, so the join cannot be heard. */
const CROSSFADE_SECONDS = 0.3;
const TAU = Math.PI * 2;
const PEAK = 0.8;

const STICK_LOWPASS_HZ = 650;
/** Slow swell of the rustle: whole cycles per loop, so it joins up. */
const STICK_SWELL_CYCLES = 3;
const STICK_SWELL_DEPTH = 0.3;
const STICK_CRUNCH_PER_SECOND = 28;
const STICK_CRUNCH_DECAY_SECONDS = 0.012;
const STICK_CRUNCH_LEVEL = 0.35;
const STICK_CRUNCH_LOWPASS_HZ = 2400;

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_TO_UNIT = 1 / 4294967296;
const SEED = 0x51ce1;

/** One-pole low-pass coefficient for `hz` at `sampleRate`. */
const coefficient = (hz: number, sampleRate: number) => 1 - Math.exp((-TAU * hz) / sampleRate);

/** The samples of one loop (mono). Deterministic, so a test can check it. */
export function renderSnowLoop(sampleRate: number): Float32Array {
  const length = Math.round(SNOW_LOOP_SECONDS * sampleRate);
  const fade = Math.round(CROSSFADE_SECONDS * sampleRate);
  const raw = rawRustle(length + fade, sampleRate);
  const out = new Float32Array(length);
  // The first `fade` samples blend in the extra tail, so the last sample runs straight on into the first.
  for (let i = 0; i < length; i++) {
    out[i] = i < fade ? raw[i] * Math.sin((i / fade) * (Math.PI / 2)) + raw[length + i] * Math.cos((i / fade) * (Math.PI / 2)) : raw[i];
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < length; i++) out[i] *= gain;
  return out;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state * UINT32_TO_UNIT;
  };
}

function rawRustle(count: number, sampleRate: number): Float32Array {
  const next = random(SEED);
  const out = new Float32Array(count);
  const low = coefficient(STICK_LOWPASS_HZ, sampleRate), crunchLow = coefficient(STICK_CRUNCH_LOWPASS_HZ, sampleRate);
  const crunchDecay = Math.exp(-1 / (STICK_CRUNCH_DECAY_SECONDS * sampleRate));
  const crunchChance = STICK_CRUNCH_PER_SECOND / sampleRate;
  let a = 0, b = 0, crunch = 0, crunchFiltered = 0;
  for (let i = 0; i < count; i++) {
    // Two low-passes of white noise make a soft, dark rustle.
    a += low * (next() * 2 - 1 - a);
    b += low * (a - b);
    if (next() < crunchChance) crunch = (next() * 0.5 + 0.5) * STICK_CRUNCH_LEVEL;
    crunch *= crunchDecay;
    crunchFiltered += crunchLow * ((next() * 2 - 1) * crunch - crunchFiltered);
    const swell = 1 - STICK_SWELL_DEPTH + STICK_SWELL_DEPTH * Math.sin((TAU * STICK_SWELL_CYCLES * i) / (SNOW_LOOP_SECONDS * sampleRate));
    out[i] = b * 6 * swell + crunchFiltered * 3;
  }
  return out;
}
