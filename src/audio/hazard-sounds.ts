/**
 * The sounds of the holes, synthesised with ZzFX like the other effects:
 * a splash for ponds and oases, a stab for ice shards, a hiss for a vent
 * throwing the jelly up, and a sizzling bloop for lava.
 */
import type { Layer, Random } from './sfx-sounds.ts';

const SHAPE_SINE = 0;
const SHAPE_NOISE = 4;
const PITCH_JITTER = 0.08;
const LENGTH_JITTER = 0.12;
const jitter = (random: Random, amount: number) => 1 + amount * (2 * random() - 1);
/** ZzFX measures slide in Hz per second divided by this. */
const ZZFX_SLIDE_HZ_PER_SECOND = 500;
const slideFor = (hzPerSecond: number) => hzPerSecond / ZZFX_SLIDE_HZ_PER_SECOND;

// splash: bright slosh, a dull slop under it and a falling drop
const SPLASH_NOISE_HZ = 160;
const SPLASH_SLOSH_LENGTH_S = 0.3;
const SPLASH_SLOSH_FILTER = -1300;
const SPLASH_SLOSH_GAIN = 0.7;
const SPLASH_SLOSH_FLUTTER_S = 0.045;
const SPLASH_SLOSH_TREMOLO = 0.6;
const SPLASH_SLOP_LENGTH_S = 0.22;
const SPLASH_SLOP_FILTER = -420;
const SPLASH_SLOP_GAIN = 0.9;
const SPLASH_DROP_HZ = 760;
const SPLASH_DROP_FALL_RATIO = 0.4;
const SPLASH_DROP_LENGTH_S = 0.16;
const SPLASH_DROP_START_S = 0.05;
const SPLASH_DROP_GAIN = 0.28;
const ATTACK_S = 0.003;

// stab: a hard click and crunch with a glassy ping
const STAB_NOISE_HZ = 2200;
const STAB_CLICK_LENGTH_S = 0.07;
const STAB_CLICK_FILTER = 1400;
const STAB_CLICK_GAIN = 0.75;
const STAB_CRUNCH_HZ = 220;
const STAB_CRUNCH_LENGTH_S = 0.12;
const STAB_CRUNCH_FILTER = -900;
const STAB_CRUNCH_GAIN = 0.7;
const STAB_PING_HZ = 2300;
const STAB_PING_FALL_RATIO = 0.8;
const STAB_PING_LENGTH_S = 0.2;
const STAB_PING_GAIN = 0.22;

// hiss: steam escaping, with a short rising whoosh
const HISS_NOISE_HZ = 4200;
const HISS_LENGTH_S = 0.6;
const HISS_FILTER = 1800;
const HISS_ATTACK_S = 0.04;
const HISS_GAIN = 0.55;
const WHOOSH_HZ = 170;
const WHOOSH_RISE_RATIO = 3.2;
const WHOOSH_LENGTH_S = 0.4;
const WHOOSH_GAIN = 0.28;

// sizzle: crackling noise over a slow bloop
const SIZZLE_NOISE_HZ = 600;
const SIZZLE_LENGTH_S = 0.55;
const SIZZLE_FILTER = 500;
const SIZZLE_CRACKLE_S = 0.035;
const SIZZLE_CRACKLE_TREMOLO = 0.95;
const SIZZLE_GAIN = 0.5;
const BLOOP_HZ = 130;
const BLOOP_RISE_RATIO = 1.9;
const BLOOP_LENGTH_S = 0.3;
const BLOOP_GAIN = 0.4;

/** A sine that glides from `pitch` to `pitch * ratio` over `length`. */
function glide(pitch: number, ratio: number, length: number, gain: number, start = 0): Layer {
  return {
    start, gain,
    zzfx: { frequency: pitch, shape: SHAPE_SINE, attack: ATTACK_S, release: length, slide: slideFor(pitch * (ratio - 1) / length) },
  };
}

export function holeSplash(random: Random = Math.random): Layer[] {
  const slosh = SPLASH_SLOSH_LENGTH_S * jitter(random, LENGTH_JITTER);
  return [
    {
      start: 0, gain: SPLASH_SLOSH_GAIN,
      zzfx: { frequency: SPLASH_NOISE_HZ, shape: SHAPE_NOISE, attack: ATTACK_S, release: slosh, filter: SPLASH_SLOSH_FILTER, repeatTime: SPLASH_SLOSH_FLUTTER_S, tremolo: SPLASH_SLOSH_TREMOLO },
    },
    {
      start: 0, gain: SPLASH_SLOP_GAIN,
      zzfx: { frequency: SPLASH_NOISE_HZ, shape: SHAPE_NOISE, attack: ATTACK_S, release: SPLASH_SLOP_LENGTH_S * jitter(random, LENGTH_JITTER), filter: SPLASH_SLOP_FILTER },
    },
    glide(SPLASH_DROP_HZ * jitter(random, PITCH_JITTER), SPLASH_DROP_FALL_RATIO, SPLASH_DROP_LENGTH_S, SPLASH_DROP_GAIN, SPLASH_DROP_START_S),
  ];
}

export function holeStab(random: Random = Math.random): Layer[] {
  return [
    {
      start: 0, gain: STAB_CLICK_GAIN,
      zzfx: { frequency: STAB_NOISE_HZ, shape: SHAPE_NOISE, attack: 0.001, release: STAB_CLICK_LENGTH_S, filter: STAB_CLICK_FILTER },
    },
    {
      start: 0, gain: STAB_CRUNCH_GAIN,
      zzfx: { frequency: STAB_CRUNCH_HZ * jitter(random, PITCH_JITTER), shape: SHAPE_NOISE, attack: 0.001, release: STAB_CRUNCH_LENGTH_S, filter: STAB_CRUNCH_FILTER },
    },
    glide(STAB_PING_HZ * jitter(random, PITCH_JITTER), STAB_PING_FALL_RATIO, STAB_PING_LENGTH_S, STAB_PING_GAIN),
  ];
}

export function holeHiss(random: Random = Math.random): Layer[] {
  return [
    {
      start: 0, gain: HISS_GAIN,
      zzfx: { frequency: HISS_NOISE_HZ, shape: SHAPE_NOISE, attack: HISS_ATTACK_S, release: HISS_LENGTH_S * jitter(random, LENGTH_JITTER), filter: HISS_FILTER },
    },
    glide(WHOOSH_HZ * jitter(random, PITCH_JITTER), WHOOSH_RISE_RATIO, WHOOSH_LENGTH_S, WHOOSH_GAIN),
  ];
}

export function holeSizzle(random: Random = Math.random): Layer[] {
  return [
    {
      start: 0, gain: SIZZLE_GAIN,
      zzfx: {
        frequency: SIZZLE_NOISE_HZ, shape: SHAPE_NOISE, attack: ATTACK_S, release: SIZZLE_LENGTH_S * jitter(random, LENGTH_JITTER),
        filter: SIZZLE_FILTER, repeatTime: SIZZLE_CRACKLE_S, tremolo: SIZZLE_CRACKLE_TREMOLO,
      },
    },
    glide(BLOOP_HZ * jitter(random, PITCH_JITTER), BLOOP_RISE_RATIO, BLOOP_LENGTH_S, BLOOP_GAIN),
  ];
}
