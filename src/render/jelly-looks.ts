/**
 * The jelly jar's looks, after piece 2 of xiuxiueig (scene.frag `layered` and
 * `findBit`): layered looks colour the light inside the jelly, bit looks
 * suspend opaque things in it. Piece 2 raymarches the interior; here the same
 * patterns are evaluated where the view ray meets the skin, in the jelly's own
 * coordinates, so they turn and wobble with it.
 *
 * One function serves every look: the look id selects its terms with masks,
 * so a single instanced material can draw the whole jar.
 */
import {
  abs, atan, cos, float, floor, fract, length, mix, mx_cell_noise_float, sin, smoothstep, step, vec3,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

/** Order is the look id used by mushrooms.ts and by the shaders. */
export const LOOKS = [
  'classic', 'zebra', 'spotty', 'stripy', 'swirly', 'sprinkle', 'checked', 'two-tone', 'glitter', 'rainbow', 'galaxy', 'golden',
] as const;
const LOOK = Object.fromEntries(LOOKS.map((name, id) => [name, id])) as Record<(typeof LOOKS)[number], number>;

const TAU = Math.PI * 2;
/** Half-width of the soft edge between pattern bands, in band units. */
const BAND_SOFTNESS = 0.06;
const INK = [0.03, 0.03, 0.035] as const;
const GALAXY_DEEP = [0.06, 0.03, 0.22] as const;
const AMBER_DEEP = [0.85, 0.42, 0.04] as const;
const RAINBOW_GREY = 0.15;
const RAINBOW_STRENGTH = 0.85;
const GALAXY_SWIRL = 0.45;

/** Per bit look: cells per radius, chance a cell holds a bit, bit radius in cells, colour, glow. */
const BITS = [
  { look: LOOK.spotty, density: 2.6, presence: 0.4, radius: 0.2, color: [0.09, 0.045, 0.02], glow: 0 },
  { look: LOOK.sprinkle, density: 4.5, presence: 0.55, radius: 0.13, color: null, glow: 0 },
  { look: LOOK.glitter, density: 8, presence: 0.3, radius: 0.11, color: [0.8, 0.83, 0.9], glow: 0.9 },
  { look: LOOK.galaxy, density: 7, presence: 0.3, radius: 0.07, color: [1, 0.97, 0.8], glow: 2.2 },
  { look: LOOK.golden, density: 2.2, presence: 0.55, radius: 0.24, color: [1, 0.72, 0.25], glow: 0.35 },
] as const;
/** Offsets that decorrelate the three jitter axes and the sprinkle hue from the presence hash. */
const JITTER_OFFSETS = [7.1, 13.7, 23.3] as const;
const HUE_OFFSET = 31.9;
const SEED_SPREAD = 17;
const BIT_EDGE = 0.75;

type F = Node<'float'>;
type V3 = Node<'vec3'>;

export type LookShading = {
  /** Colour of light that has crossed the jelly here. */
  attenuation: V3;
  /** 0..1 coverage of an opaque bit at this point, and its colour and glow. */
  bit: F;
  bitColor: V3;
  glow: V3;
};

function hue(h: F): V3 {
  return cos(vec3(0, 1 / 3, 2 / 3).add(h).mul(TAU)).mul(0.5).add(0.5) as unknown as V3;
}

/** Soft square wave: 0 for half of each unit of `x`, 1 for the other half. */
function band(x: F): F {
  const triangle = abs(fract(x).sub(0.5)).mul(2);
  return smoothstep(0.5 - BAND_SOFTNESS, 0.5 + BAND_SOFTNESS, triangle) as unknown as F;
}

/**
 * @param q     position in the jelly's own coordinates, in radii
 * @param look  look id (a float so it can come from an instance attribute)
 * @param deep  the jelly's deep colour; `deep2` is the colour of its pattern
 * @param seed  0..1, shifts the bits so no two jellies match
 */
export function lookShading(q: V3, look: F, deep: V3, deep2: V3, seed: F): LookShading {
  const is = (id: number) => step(abs(look.sub(id)), 0.5) as unknown as F;
  const angle = atan(q.y, q.x).div(TAU);
  const radial = length(q.xy);

  const zebra = band(q.x.mul(3.5).add(sin(q.y.mul(6)).mul(0.3)).add(q.z.mul(1.5)));
  const stripy = band(q.x.add(q.y).mul(3));
  const swirly = band(angle.mul(2).add(radial.mul(4)));
  const checked = floor(q.x.mul(3)).add(floor(q.y.mul(3))).add(floor(q.z.mul(3))).mod(2);
  const twoTone = smoothstep(-BAND_SOFTNESS, BAND_SOFTNESS, q.y.add(sin(q.x.mul(3)).mul(0.25)));
  const on = zebra.mul(is(LOOK.zebra)).add(stripy.mul(is(LOOK.stripy))).add(swirly.mul(is(LOOK.swirly)))
    .add(checked.mul(is(LOOK.checked))).add(twoTone.mul(is(LOOK['two-tone'])));
  const second = mix(deep2, vec3(...INK), is(LOOK.zebra));
  const layered = mix(deep, second, on);
  const rainbow = mix(vec3(RAINBOW_GREY), hue(q.y.mul(0.5).add(q.x.mul(0.2)).add(0.5) as unknown as F), RAINBOW_STRENGTH);
  const swirl = sin(angle.mul(TAU * 2).add(radial.mul(7))).mul(0.5).add(0.5);
  const galaxy = mix(vec3(...GALAXY_DEEP), deep, swirl.mul(GALAXY_SWIRL));
  let attenuation = mix(layered, rainbow, is(LOOK.rainbow));
  attenuation = mix(attenuation, galaxy, is(LOOK.galaxy));
  attenuation = mix(attenuation, vec3(...AMBER_DEEP), is(LOOK.golden));

  // Bits: a jittered cell grid in the jelly's own space. Density, size and
  // colour are picked by look; a look with no bits gets zero coverage.
  let density: F = float(0) as unknown as F, presence = density, radius = density, glowGain = density, hasBits = density;
  for (const bits of BITS) {
    const mask = is(bits.look);
    density = density.add(mask.mul(bits.density)) as unknown as F;
    presence = presence.add(mask.mul(bits.presence)) as unknown as F;
    radius = radius.add(mask.mul(bits.radius)) as unknown as F;
    glowGain = glowGain.add(mask.mul(bits.glow)) as unknown as F;
    hasBits = hasBits.add(mask) as unknown as F;
  }
  const p = q.mul(density).add(seed.mul(SEED_SPREAD));
  const cell = floor(p).add(0.5);
  const chance = mx_cell_noise_float(cell);
  const jitter = vec3(
    mx_cell_noise_float(cell.add(JITTER_OFFSETS[0])),
    mx_cell_noise_float(cell.add(JITTER_OFFSETS[1])),
    mx_cell_noise_float(cell.add(JITTER_OFFSETS[2])),
  ).sub(0.5).mul(radius.mul(2).oneMinus());
  const distance = length(fract(p).sub(0.5).sub(jitter));
  const bit = smoothstep(radius.mul(BIT_EDGE), radius, distance).oneMinus().mul(step(chance, presence)).mul(hasBits);
  let bitColor: V3 = vec3(0) as unknown as V3;
  for (const bits of BITS) {
    const color = bits.color ? vec3(...bits.color) : hue(mx_cell_noise_float(cell.add(HUE_OFFSET)) as unknown as F);
    bitColor = bitColor.add(color.mul(is(bits.look))) as unknown as V3;
  }
  return {
    attenuation: attenuation as unknown as V3,
    bit: bit as unknown as F,
    bitColor,
    glow: bitColor.mul(bit).mul(glowGain) as unknown as V3,
  };
}
