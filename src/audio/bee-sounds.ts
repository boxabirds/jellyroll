/**
 * The bees' buzz: one seamless loop made once, played once per bee. How loud each bee is follows its distance from the jelly,
 * and its pitch slides a little with how fast it is closing on or leaving the jelly (a Doppler shift, with the speed of sound
 * turned down so a bee going past is heard to bend, but only slightly).
 */
export const BUZZ_LOOP_SECONDS = 1;
const TAU = Math.PI * 2;
const PEAK = 0.8;
/** Whole cycles per loop, so the loop joins: the pitch of the buzz, and the rate of the wing beat that flutters it. */
const BUZZ_CYCLES = 235;
const WING_CYCLES = 29;
const WING_DEPTH = 0.4;
/** Harmonics of the buzz and their levels: a thin, reedy sound, rich in upper partials. */
const HARMONICS: readonly number[] = [1, 0.7, 0.55, 0.4, 0.3, 0.22, 0.15, 0.1];
/** A little breath on top, and how much the pitch wavers (cycles per loop, and depth as a fraction of the pitch). */
const NOISE_LEVEL = 0.06;
const WAVER_CYCLES = 3;
const WAVER_DEPTH = 0.006;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_TO_UNIT = 1 / 4294967296;
const SEED = 0xbee5;

/** The samples of one loop (mono). Deterministic, so a test can check it. */
export function renderBuzzLoop(sampleRate: number): Float32Array {
  const length = Math.round(BUZZ_LOOP_SECONDS * sampleRate);
  const out = new Float32Array(length);
  let state = SEED;
  for (let i = 0; i < length; i++) {
    const phase = i / length;
    // The waver is a whole number of cycles over the loop, so the pitch returns to where it began.
    const wave = BUZZ_CYCLES * phase + (WAVER_DEPTH * BUZZ_CYCLES * Math.sin(TAU * WAVER_CYCLES * phase)) / (TAU * WAVER_CYCLES);
    let tone = 0;
    HARMONICS.forEach((level, h) => { tone += level * Math.sin(TAU * wave * (h + 1)); });
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    const breath = (state * UINT32_TO_UNIT * 2 - 1) * NOISE_LEVEL;
    const flutter = 1 - WING_DEPTH + WING_DEPTH * Math.sin(TAU * WING_CYCLES * phase);
    out[i] = (tone + breath * HARMONICS.length) * flutter;
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < length; i++) out[i] *= gain;
  return out;
}

/** A bee this near is at full level; the level falls away as 1 / distance beyond it, and is gone past BUZZ_RANGE. */
export const BUZZ_NEAR = 3;
export const BUZZ_RANGE = 70;
/** How loud one bee is at BUZZ_NEAR or closer (the master of all four together stays comfortable). */
export const BUZZ_GAIN = 0.1;

/** 0..1 loudness of a bee `distance` metres from the jelly. */
export function buzzLevel(distance: number): number {
  if (distance >= BUZZ_RANGE) return 0;
  return Math.min(1, BUZZ_NEAR / Math.max(distance, BUZZ_NEAR)) * (1 - distance / BUZZ_RANGE);
}

/** Speed of sound for the Doppler shift (m/s): about the real one, so 40 m/s of closing bends the pitch by 12%... */
export const DOPPLER_SPEED = 330;
/** ...and the shift is only this share of that, so it stays slight. */
export const DOPPLER_SHARE = 0.5;
const MAX_SHIFT = 0.2;

/** Playback rate for a bee closing on the jelly at `closingSpeed` m/s (negative when it is moving away). */
export function dopplerRate(closingSpeed: number): number {
  const shift = (DOPPLER_SPEED / (DOPPLER_SPEED - closingSpeed)) - 1;
  return 1 + Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, shift * DOPPLER_SHARE));
}
