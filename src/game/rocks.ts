/**
 * Rocks are never stored: each world cell answers "is there a rock, and where"
 * from a hash. Physics and rendering both ask the same question, so the field
 * is infinite and needs no bookkeeping.
 */
import { rockScale } from './biomes.ts';
import { createHazardSample, hazardAt } from './hazards.ts';
import { hash2, smoothstep, valueNoise1 } from './noise.ts';
import { createMushroomLedger, isMushroomTaken, resetMushroomLedger, takeMushroom, type MushroomLedger } from './mushrooms.ts';
import { courseCenter, courseHalfWidth, kickerHeight, terrainHeight } from './terrain.ts';
import {
  RIDGE_DISTANCE,
  ROCK_BANK_LIMIT,
  ROCK_CELL,
  ROCK_DENSITY_WAVELENGTH,
  ROCK_EMBED,
  ROCK_FREE_UNTIL,
  ROCK_FULL_DENSITY_AT,
  ROCK_KICKER_CLEARANCE,
  ROCK_MAX_DENSITY,
  ROCK_MAX_RADIUS,
  ROCK_MIN_DENSITY_FRACTION,
  ROCK_MIN_RADIUS,
  WORLD_SEED,
} from './tuning.ts';

const SEED_EXISTS = WORLD_SEED + 11;
const SEED_OFFSET_X = WORLD_SEED + 12;
const SEED_OFFSET_Z = WORLD_SEED + 13;
const SEED_RADIUS = WORLD_SEED + 14;
const SEED_LOOK = WORLD_SEED + 15;
const SEED_DENSITY = WORLD_SEED + 16;

const holeScratch = createHazardSample();

export type Rock = { x: number; y: number; z: number; radius: number; look: number };

/** Which rocks have been smashed (by the glass marble): a ring of cells, like the collectibles' ledger. */
export type RockLedger = MushroomLedger;
export const createRockLedger = createMushroomLedger;
export const resetRockLedger = resetMushroomLedger;
export const isRockBroken = isMushroomTaken;
export const breakRock = takeMushroom;

export function createRock(): Rock {
  return { x: 0, y: 0, z: 0, radius: 0, look: 0 };
}

export function rockCellIndex(coordinate: number): number {
  return Math.floor(coordinate / ROCK_CELL);
}

/** Chance that a cell at course distance `s` holds a rock. */
export function rockDensity(s: number): number {
  const patch = valueNoise1(s / ROCK_DENSITY_WAVELENGTH, SEED_DENSITY);
  const fraction = ROCK_MIN_DENSITY_FRACTION + (1 - ROCK_MIN_DENSITY_FRACTION) * patch;
  return Math.min(1, ROCK_MAX_DENSITY * fraction * rockScale(s)) * smoothstep(ROCK_FREE_UNTIL, ROCK_FULL_DENSITY_AT, s);
}

/**
 * Fills `out` with the rock of cell (cellX, cellZ) and returns true, or
 * returns false when the cell is empty. Small rocks are more common.
 */
export function rockInCell(cellX: number, cellZ: number, out: Rock): boolean {
  const z = (cellZ + hash2(cellX, cellZ, SEED_OFFSET_Z)) * ROCK_CELL;
  const s = -z;
  if (hash2(cellX, cellZ, SEED_EXISTS) >= rockDensity(s)) return false;
  const x = (cellX + hash2(cellX, cellZ, SEED_OFFSET_X)) * ROCK_CELL;
  // The land beyond the ridges is distant scenery; rocks belong to the valley.
  const beyond = Math.abs(x - courseCenter(s)) - courseHalfWidth(s);
  if (beyond > RIDGE_DISTANCE * ROCK_BANK_LIMIT) return false;
  if (kickerHeight(x, s) > ROCK_KICKER_CLEARANCE) return false;
  // Rocks do not stand in the holes.
  if (hazardAt(x - courseCenter(s), s, courseHalfWidth(s), holeScratch) > 0) return false;
  const size = hash2(cellX, cellZ, SEED_RADIUS);
  const radius = ROCK_MIN_RADIUS + (ROCK_MAX_RADIUS - ROCK_MIN_RADIUS) * size * size;
  out.x = x;
  out.z = z;
  out.radius = radius;
  out.y = terrainHeight(x, z) - radius * ROCK_EMBED;
  out.look = hash2(cellX, cellZ, SEED_LOOK);
  return true;
}
