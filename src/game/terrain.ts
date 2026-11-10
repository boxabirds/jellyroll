/**
 * The endless hill as a pure function of position. The jelly travels toward
 * -Z; `s = -z` is the distance travelled down the course. Physics, the chunk
 * meshes and rock placement all sample this one function, so nothing can
 * disagree about where the ground is.
 */
import { hash2, smoothstep, valueNoise1, valueNoise2 } from './noise.ts';
import {
  BOWL_CURVATURE,
  GRADIENT_STEP,
  HILL_AMPLITUDE,
  HILL_WAVELENGTH,
  KICKER_CHANCE,
  KICKER_CORE_FRACTION,
  KICKER_FALLOFF,
  KICKER_FIRST_SEGMENT,
  KICKER_HALF_WIDTH,
  KICKER_HEIGHT,
  KICKER_LATERAL_FRACTION,
  KICKER_LENGTH,
  KICKER_MARGIN,
  KICKER_SPACING,
  MEAN_SLOPE,
  MEANDER_WAVES,
  MOGUL_AMPLITUDE,
  MOGUL_WAVELENGTH,
  RIPPLE_AMPLITUDE,
  RIPPLE_WAVELENGTH,
  ROUGHNESS_WAVELENGTH,
  SLOPE_WAVES,
  START_SMOOTH_FROM,
  START_SMOOTH_TO,
  VALLEY_HALF_WIDTH,
  VALLEY_HALF_WIDTH_SWING,
  RIDGE_BACK_FRACTION,
  RIDGE_DISTANCE,
  RIDGE_HEIGHT,
  VALLEY_WIDTH_WAVELENGTH,
  WORLD_SEED,
} from './tuning.ts';

const TAU = Math.PI * 2;
const SEED_HILLS = WORLD_SEED + 1;
const SEED_MOGULS = WORLD_SEED + 2;
const SEED_RIPPLE = WORLD_SEED + 3;
const SEED_ROUGHNESS = WORLD_SEED + 4;
const SEED_KICKER_EXISTS = WORLD_SEED + 5;
const SEED_KICKER_ALONG = WORLD_SEED + 6;
const SEED_KICKER_ACROSS = WORLD_SEED + 7;

export type Vec3Like = { x: number; y: number; z: number };

/** X of the valley centre line at course distance `s`. */
export function courseCenter(s: number): number {
  let x = 0;
  for (const wave of MEANDER_WAVES) x += wave.amplitude * Math.sin((s * TAU) / wave.wavelength + wave.phase);
  return x;
}

/** d(courseCenter)/ds: how fast the valley is drifting sideways. */
export function courseDrift(s: number): number {
  let slope = 0;
  for (const wave of MEANDER_WAVES) {
    const k = TAU / wave.wavelength;
    slope += wave.amplitude * k * Math.cos(s * k + wave.phase);
  }
  return slope;
}

export function courseHalfWidth(s: number): number {
  return VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING * Math.sin((s * TAU) / VALLEY_WIDTH_WAVELENGTH);
}

/** 0 on glassy stretches, 1 on the roughest ones. */
export function courseRoughness(s: number): number {
  const rough = valueNoise1(s / ROUGHNESS_WAVELENGTH, SEED_ROUGHNESS);
  return rough * rough * smoothstep(START_SMOOTH_FROM, START_SMOOTH_TO, s);
}

/** Height of the valley bank `beyond` metres outside the valley half width. */
function bankHeight(beyond: number): number {
  if (beyond <= 0) return 0;
  const phase = Math.PI * Math.min(beyond / RIDGE_DISTANCE, RIDGE_BACK_FRACTION);
  return (RIDGE_HEIGHT * (1 - Math.cos(phase))) / 2;
}

function descent(s: number): number {
  let y = -MEAN_SLOPE * s;
  for (const wave of SLOPE_WAVES) y += wave.amplitude * Math.sin((s * TAU) / wave.wavelength + wave.phase);
  return y;
}

/** Height added by the launch ramp (if any) of the segment containing `s`. */
export function kickerHeight(x: number, s: number): number {
  const segment = Math.floor(s / KICKER_SPACING);
  if (segment < KICKER_FIRST_SEGMENT) return 0;
  if (hash2(segment, 0, SEED_KICKER_EXISTS) > KICKER_CHANCE) return 0;
  const usable = KICKER_SPACING - 2 * KICKER_MARGIN - KICKER_LENGTH - KICKER_FALLOFF;
  const start = segment * KICKER_SPACING + KICKER_MARGIN + hash2(segment, 0, SEED_KICKER_ALONG) * usable;
  const along = s - start;
  if (along <= 0 || along >= KICKER_LENGTH + KICKER_FALLOFF) return 0;
  const lateralRange = courseHalfWidth(start) * KICKER_LATERAL_FRACTION;
  const centre = courseCenter(start) + (hash2(segment, 0, SEED_KICKER_ACROSS) * 2 - 1) * lateralRange;
  const across = Math.abs(x - centre);
  if (across >= KICKER_HALF_WIDTH) return 0;
  const lateral = 1 - smoothstep(KICKER_HALF_WIDTH * KICKER_CORE_FRACTION, KICKER_HALF_WIDTH, across);
  let profile: number;
  if (along < KICKER_LENGTH) {
    const t = along / KICKER_LENGTH;
    profile = t * t;
  } else {
    profile = 1 - smoothstep(0, 1, (along - KICKER_LENGTH) / KICKER_FALLOFF);
  }
  return KICKER_HEIGHT * profile * lateral;
}

export function terrainHeight(x: number, z: number): number {
  const s = -z;
  const u = Math.abs(x - courseCenter(s));
  const halfWidth = courseHalfWidth(s);
  const beyond = u - halfWidth;
  // Past the ridge the land is distant scenery drawn with very coarse cells:
  // the bowl stops climbing and fine relief fades out, leaving broad hills.
  const bowlReach = Math.min(u, halfWidth + RIDGE_DISTANCE);
  const rough = courseRoughness(s) * (1 - smoothstep(0, RIDGE_DISTANCE, beyond));
  return (
    descent(s) +
    BOWL_CURVATURE * bowlReach * bowlReach +
    bankHeight(beyond) +
    HILL_AMPLITUDE * valueNoise2(x / HILL_WAVELENGTH, s / HILL_WAVELENGTH, SEED_HILLS) +
    MOGUL_AMPLITUDE * rough * valueNoise2(x / MOGUL_WAVELENGTH, s / MOGUL_WAVELENGTH, SEED_MOGULS) +
    RIPPLE_AMPLITUDE * rough * valueNoise2(x / RIPPLE_WAVELENGTH, s / RIPPLE_WAVELENGTH, SEED_RIPPLE) +
    kickerHeight(x, s)
  );
}

/** Unit surface normal at (x, z), written into `out`. Returns the height there. */
export function terrainNormal(x: number, z: number, out: Vec3Like): number {
  const h = terrainHeight(x, z);
  const dhdx = (terrainHeight(x + GRADIENT_STEP, z) - h) / GRADIENT_STEP;
  const dhdz = (terrainHeight(x, z + GRADIENT_STEP) - h) / GRADIENT_STEP;
  const inverseLength = 1 / Math.hypot(dhdx, 1, dhdz);
  out.x = -dhdx * inverseLength;
  out.y = inverseLength;
  out.z = -dhdz * inverseLength;
  return h;
}
