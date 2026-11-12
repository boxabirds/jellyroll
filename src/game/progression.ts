/**
 * What collecting earns. Each biome's collectibles fill that biome's shield:
 * enough of them and the shield levels up, taking a share of that biome's wear
 * away. Bees level up the same way, on the collectibles they bring in. The
 * thresholds are lists of steps, each on top of the last (100, then 200 more,
 * then 300 more ...), so the effort per level grows.
 */
import { BIOME_COUNT, biomeBlend, biomeOfStretch, biomeStretch } from './biomes.ts';
import { BEE_STEPS, SHIELD_REDUCTION, SHIELD_STEPS } from './tuning.ts';

export const SHIELD_MAX_LEVEL = SHIELD_STEPS.length;
export const BEE_MAX_LEVEL = BEE_STEPS.length;
if (SHIELD_REDUCTION.length !== SHIELD_STEPS.length) throw new Error('SHIELD_REDUCTION needs one entry per shield level');

/** The level reached with `count` collected, given the cost of each step. */
export function levelFor(count: number, steps: readonly number[]): number {
  let level = 0, needed = 0;
  for (const step of steps) {
    needed += step;
    if (count < needed) break;
    level++;
  }
  return level;
}

/** How far through the current level's step `count` is: collected so far in it, and what the step costs (0 at the top level). */
export function stepProgress(count: number, steps: readonly number[]): { into: number; cost: number } {
  let spent = 0;
  for (const step of steps) {
    if (count < spent + step) return { into: count - spent, cost: step };
    spent += step;
  }
  return { into: 0, cost: 0 };
}

/** A fresh set of counts, one per biome (indexed by the biome's own index, like a collectible's kind). */
export function createShieldCounts(): number[] {
  return Array.from({ length: BIOME_COUNT }, () => 0);
}

export const shieldLevel = (count: number) => levelFor(count, SHIELD_STEPS);
export const beeLevel = (delivered: number) => levelFor(delivered, BEE_STEPS);
/** How many collectibles a bee of this experience carries per trip. */
export const beeCapacity = (delivered: number) => beeLevel(delivered) + 1;

/** Share of wear that gets through a shield of `level`. */
export function wearGetsThrough(level: number): number {
  return 1 - (level > 0 ? SHIELD_REDUCTION[level - 1] : 0);
}

/** The share of wear that gets through at course distance `s`, blending the two shields across a transition like the biomes themselves. */
export function shieldFactorAt(s: number, levels: readonly number[]): number {
  const stretch = biomeStretch(s);
  const from = wearGetsThrough(levels[biomeOfStretch(stretch)]), to = wearGetsThrough(levels[biomeOfStretch(stretch + 1)]);
  return from + (to - from) * biomeBlend(s, stretch);
}
