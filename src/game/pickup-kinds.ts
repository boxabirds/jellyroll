/** The two power-ups placed with pickups.ts: the glass marble and the bee. */
import { BIOME_LENGTH } from './biomes.ts';
import type { PickupSpec } from './pickups.ts';
import {
  BEE_CHANCE, BEE_FLOAT_HEIGHT, BEE_FREE_UNTIL, BEE_LATERAL_FRACTION, BEE_MARGIN,
  GLASS_FLOAT_HEIGHT, GLASS_FREE_UNTIL, GLASS_LATERAL_FRACTION, GLASS_MARGIN, GLASS_ODDS, WORLD_SEED,
} from './tuning.ts';

/** Chosen so the first marble is in the second biome (the first has none), not several biomes in; the chance per biome is still 1 in GLASS_ODDS. */
const GLASS_SALT = WORLD_SEED + 106;
/** Chosen so the very first stretch has a bee: the first one is met in the meadow, not thousands of metres in (the chance per stretch is still 1 in 2). */
const BEE_SALT = WORLD_SEED + 123;

export const GLASS_PICKUP: PickupSpec = {
  salt: GLASS_SALT, spacing: BIOME_LENGTH, chance: 1 / GLASS_ODDS, margin: GLASS_MARGIN,
  lateral: GLASS_LATERAL_FRACTION, height: GLASS_FLOAT_HEIGHT, freeUntil: GLASS_FREE_UNTIL,
};

/** One stretch per biome slot of the course: at most one bee to find in each. */
export const BEE_PICKUP: PickupSpec = {
  salt: BEE_SALT, spacing: BIOME_LENGTH, chance: BEE_CHANCE, margin: BEE_MARGIN,
  lateral: BEE_LATERAL_FRACTION, height: BEE_FLOAT_HEIGHT, freeUntil: BEE_FREE_UNTIL,
};
