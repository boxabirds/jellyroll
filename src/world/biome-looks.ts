/**
 * How each biome looks: its ground, its light and its rocks. The simulation
 * side of a biome (wear, grip, terrain shape) is in game/biomes.ts; the two are
 * joined only by the biome's index.
 */
import * as THREE from 'three/webgpu';
import { BIOME_COUNT, DUNES, ICE, LAVA, MEADOW, SCREE, biomeBlend, biomeOfStretch, biomeStretch } from '../game/biomes.ts';

// --- Ground -------------------------------------------------------------------

export type GroundTextures = { base: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture; emission?: THREE.Texture };

export type GroundLook = {
  /** Folder under src/assets holding base.jpg, normal.jpg and roughness.jpg. */
  readonly folder: string;
  readonly hasEmission: boolean;
  /** Metres of ground one repeat of the texture covers. The render origin hop is a multiple of each. */
  readonly tile: number;
  /** Mean linear luminance of the albedo, so a second, much larger sample can be turned into a gain. */
  readonly meanLuma: number;
  /** How strongly that large sample breaks up the repeat. */
  readonly macroStrength: number;
  readonly normalStrength: number;
  /** Roughness is the map scaled by this and then kept above the floor. */
  readonly roughnessScale: number;
  readonly minRoughness: number;
  /** Albedo multipliers; the ground wanders between the two from place to place. */
  readonly tintA: readonly [number, number, number];
  readonly tintB: readonly [number, number, number];
  /** Bare ground of launch ramps. */
  readonly dirt: string;
  /** Glow from the emission map, where there is one. */
  readonly emissionGain: number;
};

const GROUND: GroundLook[] = [];
GROUND[ICE] = {
  folder: 'ground/snow', hasEmission: false, tile: 2.4, meanLuma: 0.83, macroStrength: 0.5, normalStrength: 0.7,
  roughnessScale: 0.55, minRoughness: 0.22, tintA: [0.84, 0.94, 1.1], tintB: [0.62, 0.82, 1.1], dirt: '#9fc4e6', emissionGain: 0,
};
GROUND[MEADOW] = {
  folder: 'grass_texture', hasEmission: false, tile: 0.6, meanLuma: 0.11, macroStrength: 0.55, normalStrength: 0.9,
  roughnessScale: 1, minRoughness: 0.62, tintA: [0.55, 0.86, 0.5], tintB: [0.95, 0.92, 0.5], dirt: '#8a6a48', emissionGain: 0,
};
GROUND[DUNES] = {
  folder: 'ground/sand', hasEmission: false, tile: 3, meanLuma: 0.26, macroStrength: 0.35, normalStrength: 1.1,
  roughnessScale: 1, minRoughness: 0.75, tintA: [1.75, 1.45, 0.95], tintB: [1.45, 1.1, 0.7], dirt: '#9a6e3c', emissionGain: 0,
};
GROUND[SCREE] = {
  folder: 'ground/gravel', hasEmission: false, tile: 2, meanLuma: 0.67, macroStrength: 0.6, normalStrength: 1.3,
  roughnessScale: 1.4, minRoughness: 0.7, tintA: [0.4, 0.4, 0.45], tintB: [0.56, 0.5, 0.48], dirt: '#3b3a40', emissionGain: 0,
};
GROUND[LAVA] = {
  folder: 'ground/lava', hasEmission: true, tile: 6, meanLuma: 0.12, macroStrength: 0.4, normalStrength: 1.2,
  roughnessScale: 1, minRoughness: 0.45, tintA: [0.1, 0.07, 0.07], tintB: [0.2, 0.1, 0.08], dirt: '#1c1516', emissionGain: 2.4,
};
export const GROUND_LOOKS: readonly GroundLook[] = GROUND;

const TEXTURE_ANISOTROPY = 8;
/** The meadow's maps predate the ground/ folders and use their own file names. */
const MEADOW_FILES = { base: 'grass_base.jpg', normal: 'grass_normal.jpg', roughness: 'grass_roughness.jpg' } as const;
const GROUND_FILES = import.meta.glob('../assets/{ground/*,grass_texture}/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function textureUrl(look: GroundLook, map: 'base' | 'normal' | 'roughness' | 'emission') {
  const file = look.folder === 'grass_texture' ? MEADOW_FILES[map as keyof typeof MEADOW_FILES] : `${map}.jpg`;
  const url = GROUND_FILES[`../assets/${look.folder}/${file}`];
  if (!url) throw new Error(`Missing ground texture ${look.folder}/${file}`);
  return url;
}

/** Loads every biome's ground maps. Indexed like BIOMES. */
export async function loadGroundTextures(): Promise<GroundTextures[]> {
  const loader = new THREE.TextureLoader();
  const load = async (look: GroundLook, map: 'base' | 'normal' | 'roughness' | 'emission', color: boolean) => {
    const texture = await loader.loadAsync(textureUrl(look, map));
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = TEXTURE_ANISOTROPY;
    return texture;
  };
  return Promise.all(GROUND_LOOKS.map(async look => {
    const [base, normal, roughness, emission] = await Promise.all([
      load(look, 'base', true), load(look, 'normal', false), load(look, 'roughness', false),
      look.hasEmission ? load(look, 'emission', true) : undefined,
    ]);
    return { base, normal, roughness, emission };
  }));
}

// --- Light and air --------------------------------------------------------------

export type Atmosphere = {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  /** Strength of the image-based light that fills the shadows. */
  ambient: number;
  exposure: number;
  /** Fog begins and is complete at these fractions of the drawn distance. */
  fogStart: number;
  fogEnd: number;
};

const air = (
  zenith: string, horizon: string, sun: string, sunIntensity: number, ambient: number, exposure: number, fogStart: number, fogEnd: number,
): Atmosphere => ({
  zenith: new THREE.Color(zenith), horizon: new THREE.Color(horizon), sun: new THREE.Color(sun),
  sunIntensity, ambient, exposure, fogStart, fogEnd,
});

const ATMOSPHERES: Atmosphere[] = [];
/** Ice: hard, cold, very bright; the snow throws light back into every shadow. */
ATMOSPHERES[ICE] = air('#2f86e0', '#dff1ff', '#e6f2ff', 2, 1, 1.08, 0.5, 0.97);
/** Meadow: a mild clear day. */
ATMOSPHERES[MEADOW] = air('#4d9bd6', '#d3ecf3', '#fff3df', 1.6, 0.75, 1.05, 0.5, 0.97);
/** Dunes: low gold sun in a dusty amber sky. */
ATMOSPHERES[DUNES] = air('#7da7c9', '#ffd49a', '#ffc47a', 2.5, 0.62, 1.02, 0.4, 0.94);
/** Scree: flat grey overcast, close mist. */
ATMOSPHERES[SCREE] = air('#5f6679', '#aeb2bf', '#d9deea', 0.8, 0.6, 0.98, 0.22, 0.8);
/** Lava: night under a red sky, lit from the ground. */
ATMOSPHERES[LAVA] = air('#1c0a10', '#a8391c', '#ff7a3c', 1.2, 0.3, 1.08, 0.2, 0.82);

/** Writes the light and air at course distance `s` into `out`, blending across a transition. */
export function atmosphereAt(s: number, out: Atmosphere): Atmosphere {
  const stretch = biomeStretch(s);
  const from = ATMOSPHERES[biomeOfStretch(stretch)], to = ATMOSPHERES[biomeOfStretch(stretch + 1)];
  const t = biomeBlend(s, stretch);
  out.zenith.copy(from.zenith).lerp(to.zenith, t);
  out.horizon.copy(from.horizon).lerp(to.horizon, t);
  out.sun.copy(from.sun).lerp(to.sun, t);
  out.sunIntensity = from.sunIntensity + (to.sunIntensity - from.sunIntensity) * t;
  out.ambient = from.ambient + (to.ambient - from.ambient) * t;
  out.exposure = from.exposure + (to.exposure - from.exposure) * t;
  out.fogStart = from.fogStart + (to.fogStart - from.fogStart) * t;
  out.fogEnd = from.fogEnd + (to.fogEnd - from.fogEnd) * t;
  return out;
}

export function createAtmosphere(): Atmosphere {
  return air('#000000', '#000000', '#000000', 0, 0, 1, 0, 1);
}

// --- Rocks ----------------------------------------------------------------------

const ROCKS: THREE.Color[] = [];
ROCKS[ICE] = new THREE.Color('#bcd9ee');
ROCKS[MEADOW] = new THREE.Color('#8d8a84');
ROCKS[DUNES] = new THREE.Color('#b48a58');
ROCKS[SCREE] = new THREE.Color('#5d5b60');
ROCKS[LAVA] = new THREE.Color('#241d1f');

/** Colour of a rock standing at course distance `s`. */
export function rockColorAt(s: number, out: THREE.Color): THREE.Color {
  const stretch = biomeStretch(s);
  return out.copy(ROCKS[biomeOfStretch(stretch)]).lerp(ROCKS[biomeOfStretch(stretch + 1)], biomeBlend(s, stretch));
}

if (GROUND.length !== BIOME_COUNT || ATMOSPHERES.length !== BIOME_COUNT || ROCKS.length !== BIOME_COUNT) {
  throw new Error('Every biome needs a ground look, an atmosphere and a rock colour');
}
