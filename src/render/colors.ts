/**
 * Jelly colours, after piece 2 of xiuxiueig (web/src/colors.js): each sweet
 * gets a light surface tint and a deep, saturated colour for light that has
 * crossed the body. The deep colour is derived relative to the sweet's own
 * lightness, because a fixed dark turns yellow and orange brown.
 *
 * Every kind of collectible has its own jar of six colours; the jelly takes
 * them on as it merges.
 */
import * as THREE from 'three/webgpu';
import { DUNES, ICE, LAVA, MEADOW, SCREE } from '../game/biomes.ts';

const TINT_SATURATION_GAIN = 1.1;
const TINT_MIN_LIGHTNESS = 0.62;
const DEEP_LIGHTNESS_GAIN = 0.78;
const DEEP_MIN_LIGHTNESS = 0.4;

export type SweetColor = { readonly tint: THREE.Color; readonly deep: THREE.Color };

/** Tint and deep colour derived from one saturated hex colour. */
function sweet(hex: string): SweetColor {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
  const tint = new THREE.Color().setHSL(
    hsl.h, Math.min(1, hsl.s * TINT_SATURATION_GAIN), Math.max(TINT_MIN_LIGHTNESS, hsl.l), THREE.SRGBColorSpace,
  );
  const deep = new THREE.Color().setHSL(hsl.h, 1, Math.max(DEEP_MIN_LIGHTNESS, hsl.l * DEEP_LIGHTNESS_GAIN), THREE.SRGBColorSpace);
  return { tint, deep };
}

/** Tint and deep colour given outright, for pale colours the derivation above would turn garish. */
function pale(tintHex: string, deepHex: string): SweetColor {
  return { tint: new THREE.Color(tintHex), deep: new THREE.Color(deepHex) };
}

export const COLORS_PER_KIND = 6;
const JARS: SweetColor[][] = [];
/** Snowballs: whites and ice blues. */
JARS[ICE] = [
  pale('#ffffff', '#dcefff'), pale('#f4fbff', '#c4e3ff'), pale('#eaf6ff', '#a9d6ff'),
  pale('#ffffff', '#e9f5ff'), pale('#f0f8ff', '#b7dcff'), pale('#e4f2ff', '#93c9ff'),
];
/** Jelly mushrooms: strawberry, lime, blueberry, lemon, orange, grape. */
JARS[MEADOW] = ['#ff4d6d', '#62c934', '#3a5bff', '#ffc61a', '#ff8a2b', '#9b5cff'].map(sweet);
/** Cacti: greens. */
JARS[DUNES] = ['#3fae4c', '#7cb342', '#2e9d6a', '#9ccc65', '#43a047', '#5fbf8a'].map(sweet);
/** Crystals: amethyst, emerald, topaz, ruby, sapphire, quartz. */
JARS[SCREE] = [sweet('#b06cff'), sweet('#35d0a5'), sweet('#ffcf3a'), sweet('#ff4f7b'), sweet('#4f8dff'), pale('#ffffff', '#e6ecff')];
/** Embers: reds through yellow. */
JARS[LAVA] = ['#ff3b1f', '#ff6a00', '#ff9d00', '#ffd23a', '#ff2d55', '#ff7a3c'].map(sweet);

/** Tint and deep colour of colour `index` of a kind of collectible, in the renderer's linear working space. */
export function sweetColor(kind: number, index: number): SweetColor {
  return JARS[kind][index];
}

/** The colour a fresh jelly starts as: lime. */
export const START_COLOR: SweetColor = JARS[MEADOW][1];
