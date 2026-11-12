/**
 * The sound of a stone ball dragging and grinding over stone, for the glass marble: one seamless loop made once from
 * noise. A heavy low rumble, a broad gritty scrape in the low mids that stutters as the ball catches and slips
 * (stick-slip, at several unrelated rates), and the odd sharp grain popping loose. It runs all the time the marble touches
 * the ground; only its loudness and pitch follow the speed, as with the snow.
 */
export const METAL_LOOP_SECONDS = 2.2;
const CROSSFADE_SECONDS = 0.3;
const TAU = Math.PI * 2;
const PEAK = 0.8;

const RUMBLE_HZ = 38;
const RUMBLE_GAIN = 9;
/** The scrape: noise through two broad band-pass filters (Hz, Q) in the low mids, where stone on stone lives. */
const SCRAPE_BANDS: readonly { hz: number; q: number; gain: number }[] = [
  { hz: 95, q: 0.9, gain: 1.4 },
  { hz: 240, q: 1.1, gain: 0.9 },
  { hz: 520, q: 1.2, gain: 0.25 },
];
const SCRAPE_GAIN = 1.3;
/** Stick-slip: whole cycles per loop (so it joins up), unrelated to each other, and how deep each cuts. */
const STUTTER: readonly { cycles: number; depth: number }[] = [
  { cycles: 3, depth: 0.2 }, { cycles: 41, depth: 0.28 }, { cycles: 67, depth: 0.22 }, { cycles: 113, depth: 0.16 },
];
/** Grains popping loose: how many a second, how long each rings, how loud, and how bright. */
const GRAINS_PER_SECOND = 14;
const GRAIN_DECAY_SECONDS = 0.016;
const GRAIN_LEVEL = 0.9;
const GRAIN_LOWPASS_HZ = 800;

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_TO_UNIT = 1 / 4294967296;
const SEED = 0x3e7a1;

const coefficient = (hz: number, sampleRate: number) => 1 - Math.exp((-TAU * hz) / sampleRate);

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state * UINT32_TO_UNIT;
  };
}

/** A two-pole band-pass resonator (RBJ biquad, constant skirt gain). */
function resonator(hz: number, q: number, sampleRate: number) {
  const w = (TAU * hz) / sampleRate, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

/** The samples of one loop (mono). Deterministic, so a test can check it. */
export function renderMetalLoop(sampleRate: number): Float32Array {
  const length = Math.round(METAL_LOOP_SECONDS * sampleRate);
  const fade = Math.round(CROSSFADE_SECONDS * sampleRate);
  const raw = rawRoll(length + fade, sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = i < fade ? raw[i] * Math.sin((i / fade) * (Math.PI / 2)) + raw[length + i] * Math.cos((i / fade) * (Math.PI / 2)) : raw[i];
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < length; i++) out[i] *= gain;
  return out;
}

function rawRoll(count: number, sampleRate: number): Float32Array {
  const next = random(SEED);
  const out = new Float32Array(count);
  const low = coefficient(RUMBLE_HZ, sampleRate), grainLow = coefficient(GRAIN_LOWPASS_HZ, sampleRate);
  const bands = SCRAPE_BANDS.map(band => ({ filter: resonator(band.hz, band.q, sampleRate), gain: band.gain }));
  const grainDecay = Math.exp(-1 / (GRAIN_DECAY_SECONDS * sampleRate)), grainChance = GRAINS_PER_SECOND / sampleRate;
  let a = 0, b = 0, grain = 0, grainFiltered = 0;
  for (let i = 0; i < count; i++) {
    const white = next() * 2 - 1;
    a += low * (white - a);
    b += low * (a - b);
    let scrape = 0;
    for (const band of bands) scrape += band.filter(next() * 2 - 1) * band.gain;
    if (next() < grainChance) grain = (next() * 0.6 + 0.4) * GRAIN_LEVEL;
    grain *= grainDecay;
    grainFiltered += grainLow * ((next() * 2 - 1) * grain - grainFiltered);
    const phase = i / (METAL_LOOP_SECONDS * sampleRate);
    let catching = 1;
    for (const stutter of STUTTER) catching *= 1 - stutter.depth * (0.5 + 0.5 * Math.sin(TAU * stutter.cycles * phase));
    out[i] = b * RUMBLE_GAIN * catching + scrape * SCRAPE_GAIN * catching + grainFiltered * 4;
  }
  return out;
}
