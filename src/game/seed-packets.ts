/**
 * Seed packet power-ups, placed like the magnets: at most one per stretch of
 * the course, by hash, floating above the valley floor. Rolling through one
 * sprays a pile of seeds down the valley (see seeds.ts).
 */
import { hash2 } from './noise.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';
import {
  SEED_PACKET_CHANCE, SEED_PACKET_FLOAT_HEIGHT, SEED_PACKET_FREE_UNTIL, SEED_PACKET_LATERAL_FRACTION, SEED_PACKET_MARGIN,
  SEED_PACKET_SPACING, WORLD_SEED,
} from './tuning.ts';

const SEED_EXISTS = WORLD_SEED + 71;
const SEED_ALONG = WORLD_SEED + 72;
const SEED_ACROSS = WORLD_SEED + 73;

export type SeedPacket = { x: number; y: number; z: number };

export function createSeedPacket(): SeedPacket {
  return { x: 0, y: 0, z: 0 };
}

/** Which stretch of the course holds course distance `s`. */
export function seedPacketSegment(s: number): number {
  return Math.floor(s / SEED_PACKET_SPACING);
}

/** Fills `out` with the packet of `segment`; false when that stretch has none. */
export function seedPacketInSegment(segment: number, out: SeedPacket): boolean {
  if (segment < 0 || hash2(segment, 0, SEED_EXISTS) >= SEED_PACKET_CHANCE) return false;
  const s = segment * SEED_PACKET_SPACING + SEED_PACKET_MARGIN +
    hash2(segment, 0, SEED_ALONG) * (SEED_PACKET_SPACING - 2 * SEED_PACKET_MARGIN);
  if (s < SEED_PACKET_FREE_UNTIL) return false;
  const offset = (hash2(segment, 0, SEED_ACROSS) * 2 - 1) * courseHalfWidth(s) * SEED_PACKET_LATERAL_FRACTION;
  out.x = courseCenter(s) + offset;
  out.z = -s;
  out.y = terrainHeight(out.x, out.z) + SEED_PACKET_FLOAT_HEIGHT;
  return true;
}
