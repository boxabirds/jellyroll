/**
 * The game's sound effects, as data. Each function returns a list of layers; a
 * layer is one ZzFX sound (named parameters), a start time and a gain. Nothing
 * here touches Web Audio: sfx-render.ts turns layers into samples, sound.ts
 * plays them, and the tests render and measure them. Sizes and intensities are
 * 0..1 so the game can map its own units.
 *
 * Every kind of collectible merges with its own sound: a wet plop for a jelly
 * mushroom, a crunch for a snowball, a springy boing for a cactus, a glassy
 * chime for a crystal, a hiss and whoomp for an ember.
 *
 * ZzFX units worth knowing (read off its source, v1.4.0):
 *   pitch(t) = frequency + ZZFX_SLIDE_HZ_PER_SECOND * slide * t
 *                        + ZZFX_DELTA_SLIDE_HZ_PER_SECOND_SQUARED * deltaSlide * t^2
 *   filter > 0 is a high-pass, filter < 0 a low-pass. It is resonant, and measured
 *   on noise its peak sits at about twice the number given (-350 peaks near 700 Hz).
 */
import { DUNES, ICE, LAVA, MEADOW, SCREE } from '../game/biomes.ts';

export type Layer = { start: number; gain: number; zzfx: Record<string, number> };
/** Uniform in [0, 1). */
export type Random = () => number;

// ---- ZzFX units ----
const ZZFX_SLIDE_HZ_PER_SECOND = 500;
const ZZFX_DELTA_SLIDE_HZ_PER_SECOND_SQUARED = 250;
const SHAPE_SINE = 0;
const SHAPE_NOISE = 4;
const SEMITONES_PER_OCTAVE = 12;

// ---- variation: no two triggers are identical ----
/** Pitch moves by up to this fraction either way per trigger. */
const PITCH_JITTER = 0.05;
/** Lengths move by up to this fraction either way per trigger. */
const LENGTH_JITTER = 0.1;
/** Layer gains move by up to this fraction either way per trigger. */
const GAIN_JITTER = 0.08;

// ---- plop: a water drop. A sine that dips, then sweeps up as it dies ----
/** Starting pitch of the bloop for the smallest and largest mushroom. */
const PLOP_PITCH_SMALL_HZ = 640;
const PLOP_PITCH_LARGE_HZ = 300;
/** How long the bloop is, for the smallest and largest mushroom. */
const PLOP_LENGTH_SMALL_S = 0.11;
const PLOP_LENGTH_LARGE_S = 0.21;
/** The bloop ends at this multiple of its starting pitch. */
const PLOP_RISE_RATIO = 2.3;
/** The initial dip: pitch starts out falling at this fraction of itself per second. */
const PLOP_DIP_PER_SECOND = 10;
const PLOP_ATTACK_S = 0.004;
/** Share of the bloop's length spent falling from full level to PLOP_BODY_LEVEL. */
const PLOP_DECAY_SHARE = 0.25;
const PLOP_BODY_LEVEL = 0.6;
const PLOP_GAIN = 0.55;
/** The thump under the bloop: the "p" of the plop. Bigger mushrooms have more of it. */
const THUMP_PITCH_RATIO = 0.42;
const THUMP_FALL_PER_SECOND = 3;
const THUMP_LENGTH_SHARE = 0.55;
const THUMP_GAIN_SMALL = 0.18;
const THUMP_GAIN_LARGE = 0.3;
/** The droplet: a second, smaller, higher bloop just after, which makes it read as wet. */
const DROPLET_PITCH_RATIO = 1.75;
const DROPLET_START_SHARE = 0.62;
const DROPLET_LENGTH_SHARE = 0.45;
const DROPLET_RISE_RATIO = 1.8;
const DROPLET_GAIN = 0.2;
/** Each merge in a run is this many semitones above the last. */
const CLIMB_SEMITONES = 2;

// ---- squelch: low-passed noise with a flutter, plus a wobbling sine body ----
/** ZzFX's noise shape is pitched; this keeps it broadband. */
const SQUELCH_NOISE_HZ = 90;
/** The flutter that makes noise read as squelch instead of hiss. */
const SQUELCH_FLUTTER_PERIOD_S = 0.034;
const SQUELCH_FLUTTER_DEPTH = 0.55;
const SQUELCH_ATTACK_S = 0.006;

// jump: the jelly peels off the ground, so everything opens upward
const JUMP_BOING_HZ = 240;
const JUMP_BOING_RISE_RATIO = 2.6;
const JUMP_BOING_LENGTH_S = 0.17;
const JUMP_BOING_ATTACK_S = 0.008;
const JUMP_BOING_GAIN = 0.3;
/** Two noise layers, a dull one fading into a brighter one, stand in for a rising filter sweep. Filters are in ZzFX units. */
const JUMP_SQUELCH_DULL_FILTER = -450;
const JUMP_SQUELCH_BRIGHT_FILTER = -1100;
const JUMP_SQUELCH_DULL_LENGTH_S = 0.07;
const JUMP_SQUELCH_BRIGHT_START_S = 0.035;
const JUMP_SQUELCH_BRIGHT_LENGTH_S = 0.09;
const JUMP_SQUELCH_DULL_GAIN = 0.8;
const JUMP_SQUELCH_BRIGHT_GAIN = 0.4;

// landing: values are for the softest and the hardest impact
const LANDING_THUD_SOFT_HZ = 430;
const LANDING_THUD_HARD_HZ = 390;
/** The thud is a plop upside down: it starts here and falls to this fraction of its starting pitch. */
const LANDING_THUD_FALL_RATIO = 0.35;
const LANDING_THUD_LENGTH_SOFT_S = 0.12;
const LANDING_THUD_LENGTH_HARD_S = 0.24;
const LANDING_THUD_GAIN_SOFT = 0.2;
const LANDING_THUD_GAIN_HARD = 0.3;
const LANDING_THUD_ATTACK_S = 0.003;
/** The splat: bright at the moment of impact, then dull. */
const LANDING_SPLAT_BRIGHT_FILTER_SOFT_HZ = -500;
const LANDING_SPLAT_BRIGHT_FILTER_HARD_HZ = -1500;
const LANDING_SPLAT_DULL_FILTER = -450;
const LANDING_SPLAT_BRIGHT_LENGTH_SOFT_S = 0.03;
const LANDING_SPLAT_BRIGHT_LENGTH_HARD_S = 0.07;
const LANDING_SPLAT_DULL_LENGTH_SOFT_S = 0.06;
const LANDING_SPLAT_DULL_LENGTH_HARD_S = 0.2;
const LANDING_SPLAT_BRIGHT_GAIN_SOFT = 0.14;
const LANDING_SPLAT_BRIGHT_GAIN_HARD = 0.3;
const LANDING_SPLAT_DULL_GAIN_SOFT = 0.35;
const LANDING_SPLAT_DULL_GAIN_HARD = 0.85;
const LANDING_SPLAT_ATTACK_S = 0.002;
/** The jiggle after a hard landing: the body rebounding, as repeated small upward chirps. */
const JIGGLE_MIN_INTENSITY = 0.5;
const JIGGLE_HZ = 300;
const JIGGLE_START_S = 0.09;
const JIGGLE_LENGTH_S = 0.26;
const JIGGLE_PERIOD_S = 0.062;
const JIGGLE_RISE_HZ_PER_SECOND = 1800;
const JIGGLE_TREMOLO = 0.9;
const JIGGLE_GAIN = 0.3;

// ---- magnet pickup: a soft two-note chime with a small plop to start it ----
const PICKUP_ROOT_HZ = 784; // G5
/** The second note is this many semitones above the first (a fourth, landing on C6). */
const PICKUP_JUMP_SEMITONES = 5;
const PICKUP_JUMP_AT_S = 0.075;
const PICKUP_ATTACK_S = 0.005;
const PICKUP_HOLD_S = 0.1;
const PICKUP_RING_S = 0.34;
const PICKUP_GAIN = 0.34;
/** A quiet copy an octave and a fifth up gives the bell colour. */
const PICKUP_SHIMMER_SEMITONES = 19;
const PICKUP_SHIMMER_GAIN = 0.1;
const PICKUP_SHIMMER_RING_S = 0.22;
const PICKUP_PLOP_SIZE = 0.15;
const PICKUP_PLOP_GAIN_SCALE = 0.55;

// ---- helpers ----
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Interpolates so equal steps of t are equal musical intervals. */
const lerpPitch = (a: number, b: number, t: number) => a * (b / a) ** t;
const semitones = (n: number) => 2 ** (n / SEMITONES_PER_OCTAVE);
/** 1, give or take `amount`. */
const jitter = (random: Random, amount: number) => 1 + amount * (2 * random() - 1);

/** ZzFX slide for a pitch change of `hzPerSecond`. */
const slideFor = (hzPerSecond: number) => hzPerSecond / ZZFX_SLIDE_HZ_PER_SECOND;

/**
 * A sine that dips at `dipPerSecond` and still arrives at `pitch * riseRatio`
 * after `length` seconds: the water-drop sweep.
 */
function dropSweep(pitch: number, riseRatio: number, dipPerSecond: number, length: number) {
  const dipHzPerSecond = -pitch * dipPerSecond;
  const curveHzPerSecondSquared = (pitch * (riseRatio - 1) - dipHzPerSecond * length) / (length * length);
  return {
    slide: slideFor(dipHzPerSecond),
    deltaSlide: curveHzPerSecondSquared / ZZFX_DELTA_SLIDE_HZ_PER_SECOND_SQUARED,
  };
}

/** Low-passed fluttering noise: the wet part of every squish. */
function squelchLayer(start: number, length: number, filter: number, gain: number, attack = SQUELCH_ATTACK_S): Layer {
  return {
    start,
    gain,
    zzfx: {
      frequency: SQUELCH_NOISE_HZ,
      shape: SHAPE_NOISE,
      attack,
      release: length,
      repeatTime: SQUELCH_FLUTTER_PERIOD_S,
      tremolo: SQUELCH_FLUTTER_DEPTH,
      filter,
    },
  };
}

/**
 * A mushroom merging into the ball.
 * @param size 0 (smallest mushroom) to 1 (largest): larger is lower, longer, thumpier
 * @param climbStep position in a run of merges; each step is CLIMB_SEMITONES higher
 * @param random
 * @param gainScale
 */
export function mergePlop(size: number, climbStep = 0, random: Random = Math.random, gainScale = 1): Layer[] {
  const s = clamp01(size);
  const pitch = lerpPitch(PLOP_PITCH_SMALL_HZ, PLOP_PITCH_LARGE_HZ, s)
    * semitones(climbStep * CLIMB_SEMITONES) * jitter(random, PITCH_JITTER);
  const length = lerp(PLOP_LENGTH_SMALL_S, PLOP_LENGTH_LARGE_S, s) * jitter(random, LENGTH_JITTER);
  const gain = gainScale * jitter(random, GAIN_JITTER);
  const decay = length * PLOP_DECAY_SHARE;
  const thumpPitch = pitch * THUMP_PITCH_RATIO;
  const thumpLength = length * THUMP_LENGTH_SHARE;
  const dropletPitch = pitch * DROPLET_PITCH_RATIO * jitter(random, PITCH_JITTER);
  const dropletLength = length * DROPLET_LENGTH_SHARE;
  return [
    {
      start: 0,
      gain: PLOP_GAIN * gain,
      zzfx: {
        frequency: pitch,
        shape: SHAPE_SINE,
        attack: PLOP_ATTACK_S,
        decay,
        sustainVolume: PLOP_BODY_LEVEL,
        release: length - decay,
        ...dropSweep(pitch, PLOP_RISE_RATIO, PLOP_DIP_PER_SECOND, length),
      },
    },
    {
      start: 0,
      gain: lerp(THUMP_GAIN_SMALL, THUMP_GAIN_LARGE, s) * gain,
      zzfx: {
        frequency: thumpPitch,
        shape: SHAPE_SINE,
        attack: PLOP_ATTACK_S,
        release: thumpLength,
        slide: slideFor(-thumpPitch * THUMP_FALL_PER_SECOND),
      },
    },
    {
      start: length * DROPLET_START_SHARE,
      gain: DROPLET_GAIN * gain,
      zzfx: {
        frequency: dropletPitch,
        shape: SHAPE_SINE,
        attack: PLOP_ATTACK_S,
        release: dropletLength,
        ...dropSweep(dropletPitch, DROPLET_RISE_RATIO, 0, dropletLength),
      },
    },
  ];
}

/**
 * The ball leaving the ground: a rising boing under a squelch that opens up.
 * @param random
 */
export function jumpSquish(random: Random = Math.random): Layer[] {
  const pitch = JUMP_BOING_HZ * jitter(random, PITCH_JITTER);
  const length = JUMP_BOING_LENGTH_S * jitter(random, LENGTH_JITTER);
  const gain = jitter(random, GAIN_JITTER);
  return [
    {
      start: 0,
      gain: JUMP_BOING_GAIN * gain,
      zzfx: {
        frequency: pitch,
        shape: SHAPE_SINE,
        attack: JUMP_BOING_ATTACK_S,
        release: length,
        ...dropSweep(pitch, JUMP_BOING_RISE_RATIO, 0, length),
      },
    },
    squelchLayer(0, JUMP_SQUELCH_DULL_LENGTH_S, JUMP_SQUELCH_DULL_FILTER, JUMP_SQUELCH_DULL_GAIN * gain),
    squelchLayer(JUMP_SQUELCH_BRIGHT_START_S, JUMP_SQUELCH_BRIGHT_LENGTH_S * jitter(random, LENGTH_JITTER),
      JUMP_SQUELCH_BRIGHT_FILTER, JUMP_SQUELCH_BRIGHT_GAIN * gain),
  ];
}

/**
 * The ball hitting the ground.
 * @param intensity 0 (barely touches down) to 1 (hardest impact): harder is lower, longer, louder, splattier
 * @param random
 */
export function landingSquish(intensity: number, random: Random = Math.random): Layer[] {
  const k = clamp01(intensity);
  const pitch = lerpPitch(LANDING_THUD_SOFT_HZ, LANDING_THUD_HARD_HZ, k) * jitter(random, PITCH_JITTER);
  const length = lerp(LANDING_THUD_LENGTH_SOFT_S, LANDING_THUD_LENGTH_HARD_S, k) * jitter(random, LENGTH_JITTER);
  const gain = jitter(random, GAIN_JITTER);
  const brightLength = lerp(LANDING_SPLAT_BRIGHT_LENGTH_SOFT_S, LANDING_SPLAT_BRIGHT_LENGTH_HARD_S, k);
  const dullLength = lerp(LANDING_SPLAT_DULL_LENGTH_SOFT_S, LANDING_SPLAT_DULL_LENGTH_HARD_S, k) * jitter(random, LENGTH_JITTER);
  const layers: Layer[] = [
    {
      start: 0,
      gain: lerp(LANDING_THUD_GAIN_SOFT, LANDING_THUD_GAIN_HARD, k) * gain,
      zzfx: {
        frequency: pitch,
        shape: SHAPE_SINE,
        attack: LANDING_THUD_ATTACK_S,
        release: length,
        slide: slideFor(pitch * (LANDING_THUD_FALL_RATIO - 1) / length),
      },
    },
    squelchLayer(0, brightLength,
      lerp(LANDING_SPLAT_BRIGHT_FILTER_SOFT_HZ, LANDING_SPLAT_BRIGHT_FILTER_HARD_HZ, k),
      lerp(LANDING_SPLAT_BRIGHT_GAIN_SOFT, LANDING_SPLAT_BRIGHT_GAIN_HARD, k) * gain,
      LANDING_SPLAT_ATTACK_S),
    squelchLayer(0, dullLength, LANDING_SPLAT_DULL_FILTER,
      lerp(LANDING_SPLAT_DULL_GAIN_SOFT, LANDING_SPLAT_DULL_GAIN_HARD, k) * gain),
  ];
  if (k > JIGGLE_MIN_INTENSITY) {
    const jiggleShare = (k - JIGGLE_MIN_INTENSITY) / (1 - JIGGLE_MIN_INTENSITY);
    layers.push({
      start: JIGGLE_START_S,
      gain: JIGGLE_GAIN * jiggleShare * gain,
      zzfx: {
        frequency: JIGGLE_HZ * jitter(random, PITCH_JITTER),
        shape: SHAPE_SINE,
        attack: PLOP_ATTACK_S,
        release: JIGGLE_LENGTH_S,
        slide: slideFor(JIGGLE_RISE_HZ_PER_SECOND),
        repeatTime: JIGGLE_PERIOD_S,
        tremolo: JIGGLE_TREMOLO,
      },
    });
  }
  return layers;
}

/**
 * Picking up the magnet: a small plop, then a two-note rising chime.
 * @param random
 */
export function magnetPickup(random: Random = Math.random): Layer[] {
  const root = PICKUP_ROOT_HZ * jitter(random, PITCH_JITTER / 2);
  const jump = root * (semitones(PICKUP_JUMP_SEMITONES) - 1);
  const shimmerRatio = semitones(PICKUP_SHIMMER_SEMITONES);
  const note = (ratio: number, ring: number, gain: number) => ({
    start: 0,
    gain,
    zzfx: {
      frequency: root * ratio,
      shape: SHAPE_SINE,
      attack: PICKUP_ATTACK_S,
      sustain: PICKUP_HOLD_S,
      release: ring,
      pitchJump: jump * ratio,
      pitchJumpTime: PICKUP_JUMP_AT_S,
    },
  });
  return [
    note(1, PICKUP_RING_S, PICKUP_GAIN),
    note(shimmerRatio, PICKUP_SHIMMER_RING_S, PICKUP_SHIMMER_GAIN),
    ...mergePlop(PICKUP_PLOP_SIZE, 0, random, PICKUP_PLOP_GAIN_SCALE),
  ];
}

// ---- snowball: a crunch. Grainy bright noise over a soft low thud ----
const SHAPE_TRIANGLE = 1;
const CRUNCH_FILTER = -2600;
/** Grain rate of the crunch: packed snow giving way in little steps. */
const CRUNCH_GRAIN_PERIOD_S = 0.011;
const CRUNCH_GRAIN_DEPTH = 0.95;
const CRUNCH_LENGTH_SMALL_S = 0.07;
const CRUNCH_LENGTH_LARGE_S = 0.14;
const CRUNCH_GAIN = 0.36;
const CRUNCH_ATTACK_S = 0.002;
/** A second, duller crunch a moment later: the snowball collapsing in. */
const CRUNCH_TAIL_FILTER = -900;
const CRUNCH_TAIL_START_SHARE = 0.45;
const CRUNCH_TAIL_GAIN = 0.24;
const SNOW_THUD_SMALL_HZ = 210;
const SNOW_THUD_LARGE_HZ = 130;
const SNOW_THUD_FALL_PER_SECOND = 4;
const SNOW_THUD_GAIN = 0.28;

// ---- cactus: a springy boing. A triangle wave with a fast wobble, sliding up, and a pop ----
const BOING_SMALL_HZ = 420;
const BOING_LARGE_HZ = 210;
const BOING_LENGTH_SMALL_S = 0.16;
const BOING_LENGTH_LARGE_S = 0.26;
const BOING_RISE_RATIO = 1.5;
/** The spring: pitch wobbles at this rate (ZzFX modulation), which is what makes it "boing". */
const BOING_WOBBLE = 34;
const BOING_GAIN = 0.4;
const BOING_ATTACK_S = 0.004;
const POP_PITCH_RATIO = 3.2;
const POP_LENGTH_S = 0.035;
const POP_GAIN = 0.28;

// ---- crystal: a glassy chime. Three partials of a struck bar, and a tick ----
const CHIME_SMALL_HZ = 2100;
const CHIME_LARGE_HZ = 1150;
/** Frequency ratios of a struck bar's first modes: inharmonic, which is why it reads as glass, not a note. */
const CHIME_PARTIALS = [1, 2.76, 5.4] as const;
const CHIME_PARTIAL_GAINS = [0.3, 0.16, 0.08] as const;
const CHIME_RING_SMALL_S = 0.32;
const CHIME_RING_LARGE_S = 0.55;
/** Higher partials die sooner. */
const CHIME_RING_SHARES = [1, 0.55, 0.3] as const;
const CHIME_ATTACK_S = 0.002;
const TICK_FILTER = 3200;
const TICK_LENGTH_S = 0.012;
const TICK_GAIN = 0.3;

// ---- ember: a hiss over a low whoomp ----
const HISS_FILTER = 2600;
const HISS_FLUTTER_PERIOD_S = 0.019;
const HISS_FLUTTER_DEPTH = 0.5;
const HISS_LENGTH_SMALL_S = 0.16;
const HISS_LENGTH_LARGE_S = 0.3;
const HISS_GAIN = 0.26;
const HISS_ATTACK_S = 0.004;
const WHOOMP_SMALL_HZ = 190;
const WHOOMP_LARGE_HZ = 110;
const WHOOMP_FALL_RATIO = 0.5;
const WHOOMP_LENGTH_S = 0.18;
const WHOOMP_GAIN = 0.36;
const WHOOMP_ATTACK_S = 0.012;

function noiseLayer(start: number, length: number, filter: number, gain: number, attack: number, grainPeriod: number, grainDepth: number): Layer {
  return {
    start,
    gain,
    zzfx: { frequency: SQUELCH_NOISE_HZ, shape: SHAPE_NOISE, attack, release: length, repeatTime: grainPeriod, tremolo: grainDepth, filter },
  };
}

/** A snowball merging in: it crunches. */
export function snowCrunch(size: number, climbStep = 0, random: Random = Math.random): Layer[] {
  const s = clamp01(size);
  const length = lerp(CRUNCH_LENGTH_SMALL_S, CRUNCH_LENGTH_LARGE_S, s) * jitter(random, LENGTH_JITTER);
  const gain = jitter(random, GAIN_JITTER);
  // A run of snowballs climbs by brightening the crunch and lifting the thud.
  const lift = semitones(climbStep * CLIMB_SEMITONES);
  const thud = lerpPitch(SNOW_THUD_SMALL_HZ, SNOW_THUD_LARGE_HZ, s) * lift * jitter(random, PITCH_JITTER);
  return [
    noiseLayer(0, length, CRUNCH_FILTER * lift, CRUNCH_GAIN * gain, CRUNCH_ATTACK_S, CRUNCH_GRAIN_PERIOD_S * jitter(random, LENGTH_JITTER), CRUNCH_GRAIN_DEPTH),
    noiseLayer(length * CRUNCH_TAIL_START_SHARE, length, CRUNCH_TAIL_FILTER, CRUNCH_TAIL_GAIN * gain, CRUNCH_ATTACK_S, CRUNCH_GRAIN_PERIOD_S * 2, CRUNCH_GRAIN_DEPTH),
    {
      start: 0,
      gain: SNOW_THUD_GAIN * gain,
      zzfx: { frequency: thud, shape: SHAPE_SINE, attack: PLOP_ATTACK_S, release: length, slide: slideFor(-thud * SNOW_THUD_FALL_PER_SECOND) },
    },
  ];
}

/** A cactus merging in: it boings. */
export function cactusBoing(size: number, climbStep = 0, random: Random = Math.random): Layer[] {
  const s = clamp01(size);
  const pitch = lerpPitch(BOING_SMALL_HZ, BOING_LARGE_HZ, s) * semitones(climbStep * CLIMB_SEMITONES) * jitter(random, PITCH_JITTER);
  const length = lerp(BOING_LENGTH_SMALL_S, BOING_LENGTH_LARGE_S, s) * jitter(random, LENGTH_JITTER);
  const gain = jitter(random, GAIN_JITTER);
  return [
    {
      start: 0,
      gain: BOING_GAIN * gain,
      zzfx: {
        frequency: pitch, shape: SHAPE_TRIANGLE, attack: BOING_ATTACK_S, release: length, modulation: BOING_WOBBLE,
        ...dropSweep(pitch, BOING_RISE_RATIO, 0, length),
      },
    },
    {
      start: 0,
      gain: POP_GAIN * gain,
      zzfx: { frequency: pitch * POP_PITCH_RATIO, shape: SHAPE_SINE, attack: CHIME_ATTACK_S, release: POP_LENGTH_S, slide: slideFor(-pitch * POP_PITCH_RATIO / POP_LENGTH_S / 2) },
    },
  ];
}

/** A crystal merging in: it chimes. */
export function crystalChime(size: number, climbStep = 0, random: Random = Math.random): Layer[] {
  const s = clamp01(size);
  const pitch = lerpPitch(CHIME_SMALL_HZ, CHIME_LARGE_HZ, s) * semitones(climbStep * CLIMB_SEMITONES) * jitter(random, PITCH_JITTER);
  const ring = lerp(CHIME_RING_SMALL_S, CHIME_RING_LARGE_S, s) * jitter(random, LENGTH_JITTER);
  const gain = jitter(random, GAIN_JITTER);
  const layers: Layer[] = CHIME_PARTIALS.map((ratio, i) => ({
    start: 0,
    gain: CHIME_PARTIAL_GAINS[i] * gain,
    zzfx: { frequency: pitch * ratio, shape: SHAPE_SINE, attack: CHIME_ATTACK_S, release: ring * CHIME_RING_SHARES[i] },
  }));
  layers.push(noiseLayer(0, TICK_LENGTH_S, TICK_FILTER, TICK_GAIN * gain, CHIME_ATTACK_S, 0, 0));
  return layers;
}

/** An ember merging in: it hisses out with a whoomp. */
export function emberHiss(size: number, climbStep = 0, random: Random = Math.random): Layer[] {
  const s = clamp01(size);
  const length = lerp(HISS_LENGTH_SMALL_S, HISS_LENGTH_LARGE_S, s) * jitter(random, LENGTH_JITTER);
  const gain = jitter(random, GAIN_JITTER);
  const whoomp = lerpPitch(WHOOMP_SMALL_HZ, WHOOMP_LARGE_HZ, s) * semitones(climbStep * CLIMB_SEMITONES) * jitter(random, PITCH_JITTER);
  return [
    noiseLayer(0, length, HISS_FILTER, HISS_GAIN * gain, HISS_ATTACK_S, HISS_FLUTTER_PERIOD_S * jitter(random, LENGTH_JITTER), HISS_FLUTTER_DEPTH),
    {
      start: 0,
      gain: WHOOMP_GAIN * gain,
      zzfx: { frequency: whoomp, shape: SHAPE_SINE, attack: WHOOMP_ATTACK_S, release: WHOOMP_LENGTH_S, slide: slideFor(whoomp * (WHOOMP_FALL_RATIO - 1) / WHOOMP_LENGTH_S) },
    },
  ];
}

// ---- seed packet: a rattle of seeds, a whoosh as they fly, then a patter of little pops as they sprout ----
const RATTLE_TICKS = 11;
const RATTLE_SECONDS = 0.24;
const RATTLE_TICK_SECONDS = 0.012;
const RATTLE_FILTER = 3000;
const RATTLE_GAIN = 0.32;
const WHOOSH_HZ = 260;
const WHOOSH_RISE_RATIO = 2.6;
const WHOOSH_SECONDS = 0.34;
const WHOOSH_START_S = 0.04;
const WHOOSH_GAIN = 0.2;
const SPROUT_POPS = 7;
const SPROUT_FIRST_S = 0.62;
const SPROUT_LAST_S = 1.25;
const SPROUT_POP_GAIN = 0.4;
/** Each pop is a small plop, this much higher than the last on average (semitones per pop, kept small). */
const SPROUT_CLIMB_SEMITONES = 1;

/** A seed packet being picked up and sprayed: rattle, whoosh, then the seeds sprouting. */
export function seedSpray(random: Random = Math.random): Layer[] {
  const layers: Layer[] = [];
  for (let i = 0; i < RATTLE_TICKS; i++) {
    layers.push(noiseLayer(random() * RATTLE_SECONDS, RATTLE_TICK_SECONDS, RATTLE_FILTER * jitter(random, 0.3) * -1, RATTLE_GAIN * jitter(random, 0.3), CHIME_ATTACK_S, 0, 0));
  }
  const pitch = WHOOSH_HZ * jitter(random, PITCH_JITTER);
  layers.push({
    start: WHOOSH_START_S,
    gain: WHOOSH_GAIN,
    zzfx: { frequency: pitch, shape: SHAPE_SINE, attack: 0.03, release: WHOOSH_SECONDS, ...dropSweep(pitch, WHOOSH_RISE_RATIO, 0, WHOOSH_SECONDS) },
  });
  for (let i = 0; i < SPROUT_POPS; i++) {
    const at = SPROUT_FIRST_S + (SPROUT_LAST_S - SPROUT_FIRST_S) * ((i + random() * 0.6) / SPROUT_POPS);
    for (const layer of mergePlop(random(), i * SPROUT_CLIMB_SEMITONES / CLIMB_SEMITONES, random, SPROUT_POP_GAIN)) {
      layers.push({ ...layer, start: layer.start + at });
    }
  }
  return layers;
}

type MergeSound = (size: number, climbStep: number, random: Random) => Layer[];
const MERGE_SOUNDS: MergeSound[] = [];
MERGE_SOUNDS[MEADOW] = (size, climbStep, random) => mergePlop(size, climbStep, random);
MERGE_SOUNDS[ICE] = snowCrunch;
MERGE_SOUNDS[DUNES] = cactusBoing;
MERGE_SOUNDS[SCREE] = crystalChime;
MERGE_SOUNDS[LAVA] = emberHiss;

/**
 * The sound of a collectible of `kind` merging into the jelly.
 * @param size 0 (smallest) to 1 (largest): larger is lower and longer
 * @param climbStep position in a run of merges; each step is CLIMB_SEMITONES higher
 */
export function mergeSound(kind: number, size: number, climbStep = 0, random: Random = Math.random): Layer[] {
  return MERGE_SOUNDS[kind](size, climbStep, random);
}

/** Pitch ratio between one merge of a run and the next. */
export const CLIMB_RATIO = semitones(CLIMB_SEMITONES);
