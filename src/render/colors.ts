/**
 * Jelly colours, after piece 2 of xiuxiueig (web/src/colors.js): each sweet
 * gets a light surface tint and a deep, saturated colour for light that has
 * crossed the body. The deep colour is derived relative to the sweet's own
 * lightness, because a fixed dark turns yellow and orange brown.
 */
import * as THREE from 'three/webgpu';

const TINT_SATURATION_GAIN = 1.1;
const TINT_MIN_LIGHTNESS = 0.62;
const DEEP_LIGHTNESS_GAIN = 0.78;
const DEEP_MIN_LIGHTNESS = 0.4;

/** The sweet jar: strawberry, lime, blueberry, lemon, orange, grape. */
export const SWEET_PALETTE = ['#ff4d6d', '#62c934', '#3a5bff', '#ffc61a', '#ff8a2b', '#9b5cff'] as const;
/** Index of the colour a fresh jelly starts as. */
export const START_SWEET = 1;

export type SweetColor = { readonly tint: THREE.Color; readonly deep: THREE.Color };

function sweetColor(hex: string): SweetColor {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
  const tint = new THREE.Color().setHSL(
    hsl.h, Math.min(1, hsl.s * TINT_SATURATION_GAIN), Math.max(TINT_MIN_LIGHTNESS, hsl.l), THREE.SRGBColorSpace,
  );
  const deep = new THREE.Color().setHSL(hsl.h, 1, Math.max(DEEP_MIN_LIGHTNESS, hsl.l * DEEP_LIGHTNESS_GAIN), THREE.SRGBColorSpace);
  return { tint, deep };
}

/** Tint and deep colour of every sweet, in the renderer's linear working space. */
export const SWEETS: readonly SweetColor[] = SWEET_PALETTE.map(sweetColor);
