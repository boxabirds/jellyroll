/**
 * Magnet power-ups. At most one per stretch of the course, placed by a hash
 * like everything else in the world, floating above the valley floor. Rolling
 * through one makes the jelly pull in every mushroom within MAGNET_RADIUS for
 * MAGNET_SECONDS.
 */
import { hash2 } from './noise.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';
import {
  MAGNET_CHANCE, MAGNET_FLOAT_HEIGHT, MAGNET_LATERAL_FRACTION, MAGNET_MARGIN, MAGNET_SPACING, WORLD_SEED,
} from './tuning.ts';

const SEED_EXISTS = WORLD_SEED + 61;
const SEED_ALONG = WORLD_SEED + 62;
const SEED_ACROSS = WORLD_SEED + 63;

export type Magnet = { x: number; y: number; z: number };

export function createMagnet(): Magnet {
  return { x: 0, y: 0, z: 0 };
}

/** Which stretch of the course holds course distance `s`. */
export function magnetSegment(s: number): number {
  return Math.floor(s / MAGNET_SPACING);
}

/** Fills `out` with the magnet of `segment`; false when that stretch has none. */
export function magnetInSegment(segment: number, out: Magnet): boolean {
  if (segment < 0 || hash2(segment, 0, SEED_EXISTS) >= MAGNET_CHANCE) return false;
  const s = segment * MAGNET_SPACING + MAGNET_MARGIN + hash2(segment, 0, SEED_ALONG) * (MAGNET_SPACING - 2 * MAGNET_MARGIN);
  const offset = (hash2(segment, 0, SEED_ACROSS) * 2 - 1) * courseHalfWidth(s) * MAGNET_LATERAL_FRACTION;
  out.x = courseCenter(s) + offset;
  out.z = -s;
  out.y = terrainHeight(out.x, out.z) + MAGNET_FLOAT_HEIGHT;
  return true;
}
