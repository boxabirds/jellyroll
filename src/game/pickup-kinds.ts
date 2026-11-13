/** The two power-ups placed with pickups.ts: the glass marble and the bee. */
import { BIOME_LENGTH, loopStart } from './biomes.ts';
import type { PickupSpec } from './pickups.ts';
import {
  BEE_CHANCE, BEE_FLOAT_HEIGHT, BEE_FREE_UNTIL, BEE_LATERAL_FRACTION, BEE_MARGIN,
  FREEZE_FLOAT_HEIGHT, FREEZE_LATERAL_FRACTION,
  GLASS_FLOAT_HEIGHT, GLASS_FREE_UNTIL, GLASS_LATERAL_FRACTION, GLASS_MARGIN, GLASS_PER_BIOME_MAX, GLASS_PER_BIOME_MIN, GLASS_SLOTS, WORLD_SEED,
} from './tuning.ts';

const GLASS_SALT = WORLD_SEED + 106;
/** Chosen so the very first stretch has a bee: the first one is met in the meadow, not thousands of metres in (the chance per stretch is still 1 in 2). */
const BEE_SALT = WORLD_SEED + 123;

/** Marbles: a biome's length is GLASS_SLOTS stretches, and two to four of them hold one. */
export const GLASS_PICKUP: PickupSpec = {
  salt: GLASS_SALT, spacing: BIOME_LENGTH / GLASS_SLOTS, chance: 0, margin: GLASS_MARGIN,
  lateral: GLASS_LATERAL_FRACTION, height: GLASS_FLOAT_HEIGHT, freeUntil: GLASS_FREE_UNTIL,
  group: { slots: GLASS_SLOTS, min: GLASS_PER_BIOME_MIN, max: GLASS_PER_BIOME_MAX },
};

const FREEZE_SALT = WORLD_SEED + 211;

/** Freeze ray crystals: as many as there are marbles, but only from the second loop of the course (Meadow, Scree, Ice) onwards. */
export const FREEZE_PICKUP: PickupSpec = {
  salt: FREEZE_SALT, spacing: BIOME_LENGTH / GLASS_SLOTS, chance: 0, margin: GLASS_MARGIN,
  lateral: FREEZE_LATERAL_FRACTION, height: FREEZE_FLOAT_HEIGHT, freeUntil: loopStart(1) * BIOME_LENGTH,
  group: { slots: GLASS_SLOTS, min: GLASS_PER_BIOME_MIN, max: GLASS_PER_BIOME_MAX },
};

/** One stretch per biome slot of the course: at most one bee to find in each. */
export const BEE_PICKUP: PickupSpec = {
  salt: BEE_SALT, spacing: BIOME_LENGTH, chance: BEE_CHANCE, margin: BEE_MARGIN,
  lateral: BEE_LATERAL_FRACTION, height: BEE_FLOAT_HEIGHT, freeUntil: BEE_FREE_UNTIL,
};
