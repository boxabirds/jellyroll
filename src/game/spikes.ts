/**
 * The cave's stalagmites (standing on the ground) and stalactites (hanging over it). Like the rocks they are never
 * stored: each cell answers from a hash whether it holds one, and what it is like. They exist only where the ground is
 * cave, thinning out across the transitions. Some stalactites fall when the jelly comes near (physics.ts decides when).
 */
import { caveAt } from './biomes.ts';
import { ceilingHeight, insideCave } from './cave.ts';
import { createHazardSample, hazardAt } from './hazards.ts';
import { hash2 } from './noise.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';
import {
  SPIKE_BANK_REACH, SPIKE_CELL, STALACTITE_CHANCE, STALACTITE_FALL_CHANCE, STALACTITE_MAX_LENGTH, STALACTITE_MAX_RADIUS, 
  STALACTITE_MIN_LENGTH, STALACTITE_MIN_RADIUS, STALACTITE_MIN_TIP, STALAGMITE_CHANCE, STALAGMITE_MAX_ASPECT, STALAGMITE_MAX_RADIUS,
  STALAGMITE_MIN_ASPECT, STALAGMITE_MIN_RADIUS, WORLD_SEED,
} from './tuning.ts';

const SEED_GROUND = WORLD_SEED + 201;
const SEED_HANGING = WORLD_SEED + 221;
const EXISTS = 0, OFFSET_X = 1, OFFSET_Z = 2, SIZE = 3, SHAPE = 4, FALLS = 6, LOOK = 7;

const holeScratch = createHazardSample();
/** A stalactite cut short by a low roof is kept down to this share of the shortest length. */
const SHORTEST_SHARE = 0.5;

export type Spike = {
  /** Where it stands, or hangs over: `y` is the ground there. */
  x: number; y: number; z: number;
  /** Radius of its base and its length (a stalagmite's height). */
  radius: number; length: number;
  /** A stalactite's tip is this far above the ground (0 for a stalagmite). */
  tip: number;
  /** A stalactite that falls when the jelly comes near. */
  falls: boolean;
  /** 0..1, for turning and shaping it. */
  look: number;
};

export function createSpike(): Spike {
  return { x: 0, y: 0, z: 0, radius: 0, length: 0, tip: 0, falls: false, look: 0 };
}

export function spikeCellIndex(coordinate: number): number {
  return Math.floor(coordinate / SPIKE_CELL);
}

function place(cellX: number, cellZ: number, seed: number, chance: number, out: Spike): boolean {
  const z = (cellZ + hash2(cellX, cellZ, seed + OFFSET_Z)) * SPIKE_CELL;
  const s = -z;
  const cave = caveAt(s);
  if (cave === 0 || hash2(cellX, cellZ, seed + EXISTS) >= chance * cave) return false;
  const x = (cellX + hash2(cellX, cellZ, seed + OFFSET_X)) * SPIKE_CELL;
  if (Math.abs(x - courseCenter(s)) > courseHalfWidth(s) + SPIKE_BANK_REACH) return false;
  out.x = x; out.z = z;
  out.look = hash2(cellX, cellZ, seed + LOOK);
  return true;
}

/** Fills `out` with the stalagmite of cell (cellX, cellZ); false when the cell has none. */
export function stalagmiteInCell(cellX: number, cellZ: number, out: Spike): boolean {
  if (!place(cellX, cellZ, SEED_GROUND, STALAGMITE_CHANCE, out)) return false;
  const s = -out.z;
  // None stand in the pools.
  if (hazardAt(out.x - courseCenter(s), s, courseHalfWidth(s), holeScratch) > 0) return false;
  const size = hash2(cellX, cellZ, SEED_GROUND + SIZE);
  out.radius = STALAGMITE_MIN_RADIUS + (STALAGMITE_MAX_RADIUS - STALAGMITE_MIN_RADIUS) * size * size;
  out.length = out.radius * (STALAGMITE_MIN_ASPECT + (STALAGMITE_MAX_ASPECT - STALAGMITE_MIN_ASPECT) * hash2(cellX, cellZ, SEED_GROUND + SHAPE));
  out.y = terrainHeight(out.x, out.z);
  out.tip = 0; out.falls = false;
  return true;
}

/** Fills `out` with the stalactite of cell (cellX, cellZ); false when the cell has none. */
export function stalactiteInCell(cellX: number, cellZ: number, out: Spike): boolean {
  if (!place(cellX, cellZ, SEED_HANGING, STALACTITE_CHANCE, out)) return false;
  out.radius = STALACTITE_MIN_RADIUS + (STALACTITE_MAX_RADIUS - STALACTITE_MIN_RADIUS) * hash2(cellX, cellZ, SEED_HANGING + SIZE);
  out.length = STALACTITE_MIN_LENGTH + (STALACTITE_MAX_LENGTH - STALACTITE_MIN_LENGTH) * hash2(cellX, cellZ, SEED_HANGING + SHAPE);
  // They hang from the roof, so there are none outside it; one that would reach too near the floor is shorter, or is not there.
  if (!insideCave(-out.z)) return false;
  out.y = terrainHeight(out.x, out.z);
  const room = ceilingHeight(out.x, -out.z) - out.y;
  out.length = Math.min(out.length, room - STALACTITE_MIN_TIP);
  if (out.length < STALACTITE_MIN_LENGTH * SHORTEST_SHARE) return false;
  out.tip = room - out.length;
  out.falls = hash2(cellX, cellZ, SEED_HANGING + FALLS) < STALACTITE_FALL_CHANCE;
  return true;
}
