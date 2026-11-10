/**
 * The background drone, as data for the JP-8 synth engine: a slow, warm pad
 * holding an open fifth. It never retriggers; the only thing that moves is its
 * filter, which opens as the jelly picks up speed, so going fast sounds like
 * rushing air and crawling sounds muffled.
 */

import { MAX_SPEED } from '../game/tuning.ts';

export const JP8_PARAM_COUNT = 68;

/** JP-8 parameter slots (jp8: src/audio/jp8-engine.ts `P`). */
export const JP8 = {
  VCO1_WAVE: 0, VCO1_PW: 2, VCO1_LEVEL: 3, VCO2_WAVE: 4, VCO2_PW: 6, VCO2_LEVEL: 7, VCO2_DETUNE: 8, SUB_OSC: 11,
  FILTER_CUTOFF: 12, FILTER_RESO: 13, FILTER_ENV: 14, FILTER_KEY: 15, HPF_CUTOFF: 16,
  ENV1_A: 17, ENV1_D: 18, ENV1_S: 19, ENV1_R: 20, ENV2_A: 22, ENV2_D: 23, ENV2_S: 24, ENV2_R: 25,
  LFO_RATE: 26, LFO_FILTER: 29, CHORUS: 32, VOLUME: 33,
  ARP_RANGE: 37, ARP_TEMPO: 38, SPECTRAL_PARTIALS: 41, WG_BRIGHTNESS: 47, WG_BODY_MIX: 48, MODAL_MODES: 52,
  CHAOS_RATE1: 55, CHAOS_RATE2: 56, BUBBLE_MIN_SIZE: 63, BUBBLE_MAX_SIZE: 64,
} as const;

const WAVE_SAW = 1;
const CHORUS_BOTH = 3;
/** Filter cutoff (Hz) at a crawl and at full rush, and the speed (m/s) that counts as full rush. */
const CUTOFF_SLOW = 320;
const CUTOFF_FAST = 3200;
const RUSH_SPEED = MAX_SPEED;

/** Two detuned saws through a soft filter, with very slow attack and a drifting LFO. */
const PATCH: readonly (readonly [number, number])[] = [
  [JP8.VCO1_WAVE, WAVE_SAW], [JP8.VCO1_PW, 0.5], [JP8.VCO1_LEVEL, 0.7],
  [JP8.VCO2_WAVE, WAVE_SAW], [JP8.VCO2_PW, 0.5], [JP8.VCO2_LEVEL, 0.7], [JP8.VCO2_DETUNE, 0.14], [JP8.SUB_OSC, 0.3],
  [JP8.FILTER_CUTOFF, CUTOFF_SLOW], [JP8.FILTER_RESO, 0.12], [JP8.FILTER_ENV, 0.15], [JP8.FILTER_KEY, 0.3], [JP8.HPF_CUTOFF, 20],
  [JP8.ENV1_A, 1.5], [JP8.ENV1_D, 1.5], [JP8.ENV1_S, 0.6], [JP8.ENV1_R, 2],
  [JP8.ENV2_A, 2], [JP8.ENV2_D, 1], [JP8.ENV2_S, 0.9], [JP8.ENV2_R, 2.5],
  [JP8.LFO_RATE, 0.17], [JP8.LFO_FILTER, 0.18], [JP8.CHORUS, CHORUS_BOTH], [JP8.VOLUME, 0.6],
  // Neutral values for modules this patch leaves off; zero is out of range for some.
  [JP8.ARP_RANGE, 1], [JP8.ARP_TEMPO, 120], [JP8.SPECTRAL_PARTIALS, 32], [JP8.WG_BRIGHTNESS, 0.5], [JP8.WG_BODY_MIX, 0.5],
  [JP8.MODAL_MODES, 16], [JP8.CHAOS_RATE1, 5], [JP8.CHAOS_RATE2, 7], [JP8.BUBBLE_MIN_SIZE, 0.003], [JP8.BUBBLE_MAX_SIZE, 0.01],
];

export function dronePatch(): Float32Array {
  const params = new Float32Array(JP8_PARAM_COUNT);
  for (const [index, value] of PATCH) params[index] = value;
  return params;
}

/** MIDI notes held for the whole run: D, the A above it, and the D above that. */
export const DRONE_NOTES = [38, 45, 50] as const;
/** MIDI velocity (0-127). The engine takes whole numbers, so a fraction would be silence. */
export const DRONE_VELOCITY = 90;

/** Filter cutoff for a speed in m/s. Rises with the square root so the low end of the range is audible. */
export function droneCutoff(speed: number): number {
  const rush = Math.sqrt(Math.min(1, Math.max(0, speed / RUSH_SPEED)));
  return CUTOFF_SLOW + (CUTOFF_FAST - CUTOFF_SLOW) * rush;
}
