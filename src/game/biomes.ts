/**
 * The run is a sequence of biomes, each BIOME_LENGTH of course, each harder on
 * the jelly than the last. Everything a biome changes about the simulation is
 * a number here; how each one looks is the renderer's business
 * (world/biome-looks.ts). After the last biome the sequence starts again with
 * every wear rate raised.
 *
 * Nothing changes at a line. Around each boundary the two neighbours blend
 * over BIOME_TRANSITION metres, so terrain shape, wear, and what grows there
 * all slide from one to the next.
 */
import { smoothstep } from './noise.ts';

export const BIOME_LENGTH = 1500;
export const BIOME_TRANSITION = 200;
/** Each time round the whole sequence, every biome wears this much harder again (fraction of its base rate). */
export const LOOP_WEAR_GAIN = 0.5;

export type Biome = {
  readonly name: string;
  /** Multiplier on wear per metre. */
  readonly wear: number;
  /** Multiplier on steering strength: below 1 is slippery. */
  readonly steer: number;
  /** Multipliers on the broad hills, on the rough small bumps, and on valley width. */
  readonly hills: number;
  readonly moguls: number;
  readonly width: number;
  /** Multipliers on how many rocks and how many collectibles there are. */
  readonly rocks: number;
  readonly collectibles: number;
};

/** In course order. A collectible's kind is the index of the biome it grows in. */
export const BIOMES: readonly Biome[] = [
  { name: 'Meadow', wear: 1, steer: 1, hills: 1, moguls: 1, width: 1, rocks: 1, collectibles: 1 },
  { name: 'Ice', wear: 1.25, steer: 0.65, hills: 0.8, moguls: 0.45, width: 1.15, rocks: 0.5, collectibles: 0.95 },
  { name: 'Dunes', wear: 1.6, steer: 0.9, hills: 1.7, moguls: 0.3, width: 1.2, rocks: 0.3, collectibles: 0.85 },
  { name: 'Scree', wear: 2.2, steer: 1, hills: 1, moguls: 1.6, width: 0.82, rocks: 2.2, collectibles: 0.75 },
  { name: 'Lava', wear: 3.2, steer: 1, hills: 1.2, moguls: 1.3, width: 0.78, rocks: 1.3, collectibles: 0.7 },
];
export const BIOME_COUNT = BIOMES.length;
export const MEADOW = 0;
export const ICE = 1;
export const DUNES = 2;
export const SCREE = 3;
export const LAVA = 4;

const HALF_TRANSITION = BIOME_TRANSITION / 2;

/**
 * Which stretch of the sequence `s` belongs to, counting from 0 and never
 * wrapping. Stretch `j` runs from the end of one transition to the end of the
 * next, so within it the ground goes from purely biome `j` to purely `j + 1`.
 */
export function biomeStretch(s: number): number {
  return Math.max(0, Math.floor((s - HALF_TRANSITION) / BIOME_LENGTH));
}

/** How far stretch `stretch` has turned into the next biome at `s`: 0 until the transition, 1 after it. */
export function biomeBlend(s: number, stretch = biomeStretch(s)): number {
  const boundary = (stretch + 1) * BIOME_LENGTH;
  return smoothstep(boundary - HALF_TRANSITION, boundary + HALF_TRANSITION, s);
}

/** Index into BIOMES of a stretch's starting biome. */
export function biomeOfStretch(stretch: number): number {
  return stretch % BIOME_COUNT;
}

/** How many times the whole sequence has been completed by the time stretch `stretch` starts. */
export function loopOfStretch(stretch: number): number {
  return Math.floor(stretch / BIOME_COUNT);
}

/** The biome the course is mostly in at `s` (for names and labels). */
export function dominantBiome(s: number): number {
  const stretch = biomeStretch(s);
  return biomeOfStretch(biomeBlend(s, stretch) < 0.5 ? stretch : stretch + 1);
}

function blended(s: number, pick: (biome: Biome) => number): number {
  const stretch = biomeStretch(s);
  const from = pick(BIOMES[biomeOfStretch(stretch)]);
  const to = pick(BIOMES[biomeOfStretch(stretch + 1)]);
  return from + (to - from) * biomeBlend(s, stretch);
}

const pickSteer = (biome: Biome) => biome.steer;
const pickHills = (biome: Biome) => biome.hills;
const pickMoguls = (biome: Biome) => biome.moguls;
const pickWidth = (biome: Biome) => biome.width;
const pickRocks = (biome: Biome) => biome.rocks;
const pickCollectibles = (biome: Biome) => biome.collectibles;

export const steerScale = (s: number) => blended(s, pickSteer);
export const hillScale = (s: number) => blended(s, pickHills);
export const mogulScale = (s: number) => blended(s, pickMoguls);
export const widthScale = (s: number) => blended(s, pickWidth);
export const rockScale = (s: number) => blended(s, pickRocks);
export const collectibleScale = (s: number) => blended(s, pickCollectibles);

/** Wear multiplier at `s`, including the extra for each completed loop of the sequence. */
export function wearScale(s: number): number {
  const stretch = biomeStretch(s);
  const of = (index: number) => BIOMES[biomeOfStretch(index)].wear * (1 + LOOP_WEAR_GAIN * loopOfStretch(index));
  const from = of(stretch), to = of(stretch + 1);
  return from + (to - from) * biomeBlend(s, stretch);
}

/**
 * The kind of collectible growing at `s`. Inside a transition the two
 * neighbours' kinds are mixed, more of the next the further in; `chance` is a
 * 0..1 hash for the individual collectible.
 */
export function collectibleKind(s: number, chance: number): number {
  const stretch = biomeStretch(s);
  return biomeOfStretch(chance < biomeBlend(s, stretch) ? stretch + 1 : stretch);
}
