/**
 * Jelly sound definitions, as data. Each function returns a list of layers; a
 * layer is one ZzFX sound (named parameters), a start time and a gain. Nothing
 * here touches Web Audio: render.js turns layers into samples, player.js plays
 * them. Sizes and intensities are 0..1 so the game can map its own units.
 *
 * ZzFX units worth knowing (read off its source, v1.4.0):
 *   pitch(t) = frequency + ZZFX_SLIDE_HZ_PER_SECOND * slide * t
 *                        + ZZFX_DELTA_SLIDE_HZ_PER_SECOND_SQUARED * deltaSlide * t^2
 *   filter > 0 is a high-pass, filter < 0 a low-pass. It is resonant, and measured
 *   on noise its peak sits at about twice the number given (-350 peaks near 700 Hz).
 */

/** @typedef {{ start: number, gain: number, zzfx: Record<string, number> }} Layer */
/** @typedef {() => number} Random uniform in [0, 1) */

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
const clamp01 = (/** @type {number} */ x) => Math.min(1, Math.max(0, x));
const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
/** Interpolates so equal steps of t are equal musical intervals. */
const lerpPitch = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a * (b / a) ** t;
const semitones = (/** @type {number} */ n) => 2 ** (n / SEMITONES_PER_OCTAVE);
/** 1, give or take `amount`. */
const jitter = (/** @type {Random} */ random, /** @type {number} */ amount) => 1 + amount * (2 * random() - 1);

/** ZzFX slide for a pitch change of `hzPerSecond`. */
const slideFor = (/** @type {number} */ hzPerSecond) => hzPerSecond / ZZFX_SLIDE_HZ_PER_SECOND;

/**
 * A sine that dips at `dipPerSecond` and still arrives at `pitch * riseRatio`
 * after `length` seconds: the water-drop sweep.
 */
function dropSweep(/** @type {number} */ pitch, /** @type {number} */ riseRatio, /** @type {number} */ dipPerSecond, /** @type {number} */ length) {
  const dipHzPerSecond = -pitch * dipPerSecond;
  const curveHzPerSecondSquared = (pitch * (riseRatio - 1) - dipHzPerSecond * length) / (length * length);
  return {
    slide: slideFor(dipHzPerSecond),
    deltaSlide: curveHzPerSecondSquared / ZZFX_DELTA_SLIDE_HZ_PER_SECOND_SQUARED,
  };
}

/** Low-passed fluttering noise: the wet part of every squish. */
function squelchLayer(/** @type {number} */ start, /** @type {number} */ length, /** @type {number} */ filter, /** @type {number} */ gain, attack = SQUELCH_ATTACK_S) {
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
 * @param {number} size 0 (smallest mushroom) to 1 (largest): larger is lower, longer, thumpier
 * @param {number} climbStep position in a run of merges; each step is CLIMB_SEMITONES higher
 * @param {Random} random
 * @param {number} gainScale
 * @returns {Layer[]}
 */
export function mergePlop(size, climbStep = 0, random = Math.random, gainScale = 1) {
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
 * @param {Random} random
 * @returns {Layer[]}
 */
export function jumpSquish(random = Math.random) {
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
 * @param {number} intensity 0 (barely touches down) to 1 (hardest impact): harder is lower, longer, louder, splattier
 * @param {Random} random
 * @returns {Layer[]}
 */
export function landingSquish(intensity, random = Math.random) {
  const k = clamp01(intensity);
  const pitch = lerpPitch(LANDING_THUD_SOFT_HZ, LANDING_THUD_HARD_HZ, k) * jitter(random, PITCH_JITTER);
  const length = lerp(LANDING_THUD_LENGTH_SOFT_S, LANDING_THUD_LENGTH_HARD_S, k) * jitter(random, LENGTH_JITTER);
  const gain = jitter(random, GAIN_JITTER);
  const brightLength = lerp(LANDING_SPLAT_BRIGHT_LENGTH_SOFT_S, LANDING_SPLAT_BRIGHT_LENGTH_HARD_S, k);
  const dullLength = lerp(LANDING_SPLAT_DULL_LENGTH_SOFT_S, LANDING_SPLAT_DULL_LENGTH_HARD_S, k) * jitter(random, LENGTH_JITTER);
  /** @type {Layer[]} */
  const layers = [
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
 * @param {Random} random
 * @returns {Layer[]}
 */
export function magnetPickup(random = Math.random) {
  const root = PICKUP_ROOT_HZ * jitter(random, PITCH_JITTER / 2);
  const jump = root * (semitones(PICKUP_JUMP_SEMITONES) - 1);
  const shimmerRatio = semitones(PICKUP_SHIMMER_SEMITONES);
  const note = (/** @type {number} */ ratio, /** @type {number} */ ring, /** @type {number} */ gain) => ({
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

/** Mushroom sizes the trial page and the measurements use. */
export const MUSHROOM_SIZE = { small: 0, medium: 0.5, large: 1 };
/** Impact intensities the trial page and the measurements use. */
export const LANDING_INTENSITY = { soft: 0.2, hard: 1 };
/** The climbing run on the trial page. */
export const MERGE_RUN_LENGTH = 6;
export const MERGE_RUN_GAP_S = 0.15;
export const MERGE_RUN_SIZE = MUSHROOM_SIZE.small;
