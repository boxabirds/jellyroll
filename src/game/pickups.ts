/**
 * Where a kind of floating power-up is: at most one per stretch of the course,
 * chosen by hash like everything else in the world, hovering above the valley
 * floor. (The magnet and the seed packet have their own copies of this.)
 */
import { hash2 } from './noise.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';

export type PickupSpec = {
  /** Distinguishes one kind from another: any integer that nothing else uses. */
  salt: number;
  /** Metres of course per stretch. */
  spacing: number;
  /** Chance a stretch holds one. */
  chance: number;
  /** Kept this far from either end of its stretch. */
  margin: number;
  /** Within this fraction of the valley half width of the centre line. */
  lateral: number;
  /** Height of its centre above the ground. */
  height: number;
  /** None before this course distance. */
  freeUntil: number;
  /**
   * When set, each run of `slots` consecutive stretches (a biome's worth) has between `min` and `max` of them hold one, a
   * different set in each run, and `chance` is not used.
   */
  group?: { slots: number; min: number; max: number };
};

export type Spot = { x: number; y: number; z: number };

export function createSpot(): Spot {
  return { x: 0, y: 0, z: 0 };
}

/** Which stretch holds course distance `s`. */
export function pickupSegment(spec: PickupSpec, s: number): number {
  return Math.floor(s / spec.spacing);
}

/** Whether this stretch holds one: by chance, or as one of the `count` used out of a group's slots. */
function isUsed(spec: PickupSpec, segment: number): boolean {
  const group = spec.group;
  if (!group) return hash2(segment, 0, spec.salt) < spec.chance;
  const first = segment - (segment % group.slots), run = first / group.slots;
  const count = group.min + Math.floor(hash2(run, 9, spec.salt) * (group.max - group.min + 1));
  // The slots are put in a hashed order; this one is used if it comes among the first `count`.
  const mine = hash2(segment, 0, spec.salt);
  let before = 0;
  for (let slot = first; slot < first + group.slots; slot++) if (hash2(slot, 0, spec.salt) < mine) before++;
  return before < count;
}

/** Fills `out` with the spot of `segment`; false when that stretch has none. */
export function pickupInSegment(spec: PickupSpec, segment: number, out: Spot): boolean {
  if (segment < 0 || !isUsed(spec, segment)) return false;
  const s = segment * spec.spacing + spec.margin + hash2(segment, 1, spec.salt) * (spec.spacing - 2 * spec.margin);
  if (s < spec.freeUntil) return false;
  const offset = (hash2(segment, 2, spec.salt) * 2 - 1) * courseHalfWidth(s) * spec.lateral;
  out.x = courseCenter(s) + offset;
  out.z = -s;
  out.y = terrainHeight(out.x, out.z) + spec.height;
  return true;
}
