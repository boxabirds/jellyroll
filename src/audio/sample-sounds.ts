/**
 * Which recorded sounds play for which game event, as data. A "variant" is a
 * little recipe of layers (a file, how fast to play it, how loud, and how long
 * after the start). Each time the event happens one variant is chosen at
 * random, then nudged in pitch, so repeats are never identical.
 *
 * Events with no recipe here (the jump, the magnet, the seed packet and the
 * lava ember) still use the synthesised sounds in sfx-sounds.ts, and so do the
 * holes' sounds until their files have loaded.
 */
import { DUNES, ICE, MEADOW, SCREE } from '../game/biomes.ts';

export type SampleLayer = { readonly file: string; readonly rate: number; readonly gain: number; readonly delay: number };
export type SampleVariant = readonly SampleLayer[];

const layer = (file: string, rate = 1, gain = 1, delay = 0): SampleLayer => ({ file, rate, gain, delay });
const one = (file: string): SampleVariant => [layer(file)];

// File names are `<pack>-<original name>` (see samples/CREDITS.md).
const SQUISH_POP = 'oga-squish-squishpop.mp3';
const SQUISH_3 = 'oga-squish-squish_03.mp3';
const SQUISH_4 = 'oga-squish-squish_04.mp3';
const SQUISH_5 = 'oga-squish-squish_05.mp3';
const SPLAT = 'oga-squish-squishsplat_impact.mp3';
const BUBBLE_2 = 'oga-water-slime-bubble_02.ogg';
const SLIME_3 = 'oga-water-slime-slime_03.ogg';
const POP_2 = 'oga-pops-pop2.ogg';
const MUD = (n: number) => `oga-mud-mud_${String(n).padStart(2, '0')}.ogg`;
const IMPACT = (name: string) => `kenney-impact-${name}.ogg`;
const INTERFACE = (name: string) => `kenney-interface-${name}.ogg`;
const SNOW = (n: number) => IMPACT(`footstep_snow_00${n}`);
const GRASS = (n: number) => IMPACT(`footstep_grass_00${n}`);
const GLASS_IMPACTS = ['impactGlass_light_000', 'impactGlass_light_002', 'impactGlass_medium_000', 'impactGlass_medium_001'];
const GLASS_TONES = ['glass_001', 'glass_003', 'glass_005'];

/** Jelly mushroom: a wet pop. Three layered combinations. */
const MUSHROOM: readonly SampleVariant[] = [
  [layer(SQUISH_POP), layer(BUBBLE_2, 1.25, 0.5, 0.07)],
  [layer(POP_2), layer(SLIME_3, 1, 0.55, 0.04)],
  [layer(SQUISH_3, 1, 0.9), layer(IMPACT('impactSoft_medium_001'), 1.1, 0.5)],
];

/** Snowball: any of the five snow crunches. */
const SNOWBALL: readonly SampleVariant[] = [0, 1, 2, 3, 4].map(n => one(SNOW(n)));

/** Cactus: a wet crunch, a dry crunch laid over something wet. */
const CACTUS: readonly SampleVariant[] = [
  [layer(GRASS(0)), layer(MUD(3), 1, 0.7, 0.01)],
  [layer(GRASS(2), 1.1), layer(MUD(7), 1, 0.7, 0.01)],
  [layer(SNOW(3), 0.9), layer(SQUISH_5, 1, 0.6, 0.02)],
  [layer(SNOW(1), 1.05), layer(MUD(12), 1, 0.7)],
];

/** Crystal: a glass impact, a glass tone, or an impact with a tone on top. No bell or bong. */
const CRYSTAL: readonly SampleVariant[] = [
  ...GLASS_IMPACTS.map(name => one(IMPACT(name))),
  ...GLASS_TONES.map(name => one(INTERFACE(name))),
  [layer(IMPACT('impactGlass_light_000')), layer(INTERFACE('glass_003'), 1, 0.6, 0.02)],
];

const MERGE_VARIANTS: Record<number, readonly SampleVariant[]> = {
  [MEADOW]: MUSHROOM, [ICE]: SNOWBALL, [DUNES]: CACTUS, [SCREE]: CRYSTAL,
};

/** The recipes for a kind of collectible merging, or undefined if that kind has no recorded sound. */
export function mergeVariants(kind: number): readonly SampleVariant[] | undefined {
  return MERGE_VARIANTS[kind];
}

const LAND_SOFT: readonly SampleVariant[] = [
  [layer(IMPACT('impactSoft_medium_000')), layer(SQUISH_4, 1, 0.5, 0.02)],
];
const LAND_HARD: readonly SampleVariant[] = [
  [layer(IMPACT('impactSoft_heavy_000')), layer(SPLAT, 1, 0.8, 0.01)],
  [layer(IMPACT('impactSoft_heavy_002')), layer(SPLAT, 1, 0.8, 0.01)],
];

/** Landings at or above this strength (0..1) use the hard recipes. */
export const HARD_LANDING_FROM = 0.4;

export function landingVariants(strength: number): readonly SampleVariant[] {
  return strength >= HARD_LANDING_FROM ? LAND_HARD : LAND_SOFT;
}

// --- Holes ---------------------------------------------------------------------
const SPLASH = (n: number) => `oga-water-slime-splash_${String(n).padStart(2, '0')}.ogg`;
const SPLASH_NUMBERS = [2, 3, 6, 8, 12, 13, 14];
const WATER_BUBBLE = (n: number) => `oga-water-slime-bubble_${String(n).padStart(2, '0')}.ogg`;
const STEAM = (n: number) => `oga-steam-hiss_${n}.ogg`;
const CRACKLE = 'oga-fire-crackle.ogg';
const GLASS_HEAVY = (n: number) => IMPACT(`impactGlass_heavy_00${n}`);

/** Falling into a pond or an oasis: any of seven real splashes, a few with a deep plunge under them. */
const SPLASH_VARIANTS: readonly SampleVariant[] = [
  ...SPLASH_NUMBERS.map(n => one(SPLASH(n))),
  [layer(SPLASH(8)), layer(IMPACT('impactSoft_heavy_002'), 0.9, 0.5)],
  [layer(SPLASH(13)), layer(IMPACT('impactSoft_heavy_000'), 0.9, 0.5), layer(WATER_BUBBLE(1), 1, 0.4, 0.12)],
];
/** Rolling on through the water: smaller sloshes, played now and then. */
const WADE_VARIANTS: readonly SampleVariant[] = [3, 6, 14].map(n => [layer(SPLASH(n), 1.15)]);

/** An ice shard going in: heavy glass, with a crunch of snow or a second shard under it. */
const STAB_VARIANTS: readonly SampleVariant[] = [
  [layer(GLASS_HEAVY(0)), layer(SNOW(3), 1, 0.8, 0.01)],
  [layer(GLASS_HEAVY(1)), layer(IMPACT('impactGlass_light_002'), 1.1, 0.6, 0.02)],
  [layer(IMPACT('impactGlass_medium_000')), layer(SNOW(1), 1, 0.8, 0.01), layer(GLASS_HEAVY(0), 1.2, 0.5, 0.03)],
  [layer(GLASS_HEAVY(1), 0.9), layer(SNOW(0), 1, 0.8, 0.01)],
];

/** A steam vent letting go: five real hisses. */
const HISS_VARIANTS: readonly SampleVariant[] = [1, 2, 3, 4, 5].map(n => one(STEAM(n)));

/** Lava: fire crackling over a bubble, with a low thud for the heat. */
const LAVA_VARIANTS: readonly SampleVariant[] = [
  [layer(CRACKLE), layer(WATER_BUBBLE(1), 0.8, 0.7, 0.04), layer(IMPACT('impactSoft_heavy_000'), 0.8, 0.4)],
  [layer(CRACKLE, 1.1), layer(WATER_BUBBLE(3), 0.8, 0.7, 0.06)],
];
/** Lava bubbling as the jelly rolls on through it. */
const BLOOP_VARIANTS: readonly SampleVariant[] = [
  [layer(WATER_BUBBLE(1), 0.8, 0.8)],
  [layer(WATER_BUBBLE(3), 0.8, 0.8)],
  [layer(WATER_BUBBLE(2), 0.75, 0.8)],
];

export type HoleSound = 'splash' | 'wade' | 'stab' | 'hiss' | 'lava' | 'bloop';
const HOLE_VARIANTS: Record<HoleSound, readonly SampleVariant[]> = {
  splash: SPLASH_VARIANTS, wade: WADE_VARIANTS, stab: STAB_VARIANTS, hiss: HISS_VARIANTS, lava: LAVA_VARIANTS, bloop: BLOOP_VARIANTS,
};

export function holeVariants(sound: HoleSound): readonly SampleVariant[] {
  return HOLE_VARIANTS[sound];
}

/** Every file the recipes use, once each. */
export function allSampleFiles(): string[] {
  const files = new Set<string>();
  const sets = [...Object.values(MERGE_VARIANTS), LAND_SOFT, LAND_HARD, ...Object.values(HOLE_VARIANTS)];
  for (const set of sets) for (const variant of set) for (const item of variant) files.add(item.file);
  return [...files];
}
