/** Deterministic, allocation-free hash noise shared by terrain and rock placement. */

const HASH_PRIME_X = 374761393;
const HASH_PRIME_Y = 668265263;
const HASH_PRIME_SEED = 1442695041;
const HASH_MIX = 1274126177;
const HASH_SHIFT_A = 13;
const HASH_SHIFT_B = 16;
const UINT32_TO_UNIT = 1 / 4294967296;

/** Uniform value in [0, 1) for an integer lattice point. */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, HASH_PRIME_X) ^ Math.imul(iy, HASH_PRIME_Y) ^ Math.imul(seed, HASH_PRIME_SEED);
  h = Math.imul(h ^ (h >>> HASH_SHIFT_A), HASH_MIX);
  h ^= h >>> HASH_SHIFT_B;
  h = Math.imul(h ^ (h >>> HASH_SHIFT_A), HASH_MIX);
  h ^= h >>> HASH_SHIFT_B;
  return (h >>> 0) * UINT32_TO_UNIT;
}

/** Quintic fade: zero first and second derivative at lattice points. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth value noise in [-1, 1]. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fy) * 2 - 1;
}

/** Smooth value noise in [0, 1] along one axis. */
export function valueNoise1(x: number, seed: number): number {
  const ix = Math.floor(x);
  const fx = fade(x - ix);
  const a = hash2(ix, 0, seed);
  const b = hash2(ix + 1, 0, seed);
  return a + (b - a) * fx;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
