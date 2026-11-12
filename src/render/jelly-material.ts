/*
 * Adapted from Jelly Baby by Scott Sun (https://github.com/scottstts/Jelly-Baby),
 * src/graphics/character/baby.ts. GPL-3.0-only; see LICENSE and NOTICE.md.
 * Changes: the transmissive jelly material is lifted out of the Baby class and
 * made size-independent (radius is a node, so one material serves a growing
 * player and hundreds of instanced mushrooms); the optical thickness is the
 * analytic chord of a sphere instead of a traced attribute; colour, absorption
 * and suspended bits come from nodes (see jelly-looks.ts).
 */
import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, normalView, normalWorld, positionLocal, positionViewDirection, transformNormalToView, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

const JELLY_ROUGHNESS = 0.085;
const JELLY_IOR = 1.35;
const JELLY_DISPERSION = 0.025;
const JELLY_CLEARCOAT = 0.42;
const JELLY_CLEARCOAT_ROUGHNESS = 0.05;
const JELLY_ENV_INTENSITY = 1.05;
/** The silhouette never reads as zero thickness, so rim refraction stays alive. */
const MIN_CHORD_FRACTION = 0.12;
/**
 * Pure transmission only filters what is behind the jelly, so a red sweet on
 * green grass goes black. Part of the light is therefore scattered back as the
 * jelly's own colour (piece 2's "inner glow"), and the filter is lightened.
 */
const JELLY_TRANSMISSION = 0.6;
/** The body's own colour sits this far from the pale tint toward the deep colour. */
const BODY_COLOR_DEPTH = 0.55;
/** How far the transmitted-light filter is lifted toward white. */
const ATTENUATION_LIFT = 0.3;
/**
 * Packed snow is matte powder: opaque, rough, with no shine, and a grainy surface. It takes over from the glossy jelly
 * as the amount of snow rises, using a procedural noise (stuck to the jelly) for its bumps and grain.
 */
const POWDER_ROUGHNESS = 0.97;
const POWDER_SPECULAR = 0.04;
/** Frequency of the bumps (per unit of the unit sphere the jelly is mapped on), how much they tilt the surface, and how much they speckle the colour. */
const POWDER_BUMP_SCALE = 9;
const POWDER_FINE_SCALE = 26;
const POWDER_BUMP = 0.9;
const POWDER_GRAIN = 0.16;
const POWDER_OFFSET_Y = 7.1;
const POWDER_OFFSET_Z = 13.7;
/** Glass keeps this much of the jelly's roughness: almost none, so it is a polished marble. */
const GLASS_ROUGHNESS_KEEP = 0.1;
/** Glints: how fine the grain is, how fast they change with the viewing angle, how few and sharp they are, and how much of their light is the thing's own colour. */
const SPARKLE_GRAIN = 14;
const SPARKLE_TURN = 9;
const SPARKLE_SHARPNESS = 9;
const SPARKLE_OWN_COLOR = 0.6;
/** How solid a suspended bit is; a little light still gets through. */
const BIT_OPACITY = 0.92;

export type JellyNodes = {
  /** World-space radius of the body being shaded. */
  radius: Node<'float'>;
  /** Light surface colour. */
  tint: Node<'vec3'>;
  /** Colour of light after crossing one diameter of jelly. */
  attenuation: Node<'vec3'>;
  /** Optional opaque bits suspended in the jelly. */
  bit?: Node<'float'>;
  bitColor?: Node<'vec3'>;
  glow?: Node<'vec3'>;
  /** 0 (clean jelly) to 1 (a full coat of powder), by place on the surface. */
  snow?: Node<'float'>;
  /** 0..1: how much of a clear glass marble this is: polished, fully transmissive, no suspended bits. */
  glass?: Node<'float'>;
  /** Where on the jelly this is, in the jelly's own rolling frame (a point on the unit sphere), so the powder turns with it. */
  snowCoord?: Node<'vec3'>;
};

/** Departures from the standard jelly, for things that are not quite jelly (snow, crystal). */
export type JellyOptions = {
  /** Share of light let through; the rest is scattered back as the body's own colour. */
  transmission?: number;
  roughness?: number;
  /** Faceted rather than smooth. */
  flatShading?: boolean;
  /** Metal (0..1): it mirrors the sky and the light in its own colour, as gold and silver do. */
  metalness?: number;
  /** Glints: tiny bright points that come and go as it is seen from a changing angle (0 for none). */
  sparkle?: number;
};

export function createJellyMaterial(nodes: JellyNodes, options: JellyOptions = {}) {
  const transmission = options.transmission ?? JELLY_TRANSMISSION;
  const material = new THREE.MeshPhysicalNodeMaterial({
    roughness: options.roughness ?? JELLY_ROUGHNESS, metalness: options.metalness ?? 0, transmission: 1,
    ior: JELLY_IOR, dispersion: JELLY_DISPERSION,
    clearcoat: JELLY_CLEARCOAT, clearcoatRoughness: JELLY_CLEARCOAT_ROUGHNESS, envMapIntensity: JELLY_ENV_INTENSITY,
    transparent: false, side: THREE.FrontSide, flatShading: options.flatShading ?? false,
  });
  const diameter = nodes.radius.mul(2);
  // A view ray through a sphere travels a chord of 2R·cos(angle to the normal).
  const facing = normalView.dot(positionViewDirection).max(MIN_CHORD_FRACTION);
  material.thicknessNode = diameter.mul(facing);
  // One diameter absorbs down to the deep colour, whatever the size.
  material.attenuationDistanceNode = diameter;
  material.attenuationColorNode = mix(nodes.attenuation, vec3(1), ATTENUATION_LIFT) as unknown as Node<'color'>;
  const snow = nodes.snow;
  let body = mix(nodes.tint, nodes.attenuation, BODY_COLOR_DEPTH) as unknown as Node<'vec3'>;
  if (snow) {
    const coord = nodes.snowCoord ?? positionLocal;
    const p = coord.mul(POWDER_BUMP_SCALE), q = coord.mul(POWDER_FINE_SCALE);
    const bump = vec3(
      mx_noise_float(p).add(mx_noise_float(q).mul(0.5)),
      mx_noise_float(p.add(POWDER_OFFSET_Y)).add(mx_noise_float(q.add(POWDER_OFFSET_Y)).mul(0.5)),
      mx_noise_float(p.add(POWDER_OFFSET_Z)).add(mx_noise_float(q.add(POWDER_OFFSET_Z)).mul(0.5)),
    );
    const bumpy = transformNormalToView(normalWorld.add(bump.mul(POWDER_BUMP)).normalize());
    material.normalNode = mix(normalView, bumpy, snow).normalize() as unknown as Node<'vec3'>;
    material.roughnessNode = mix(float(options.roughness ?? JELLY_ROUGHNESS), float(POWDER_ROUGHNESS), snow);
    material.clearcoatNode = float(JELLY_CLEARCOAT).mul(snow.oneMinus());
    material.specularIntensityNode = mix(float(1), float(POWDER_SPECULAR), snow);
    // Grain in the colour, so a flat white does not read as a plain sphere.
    body = body.mul(float(1).add(mx_noise_float(q).mul(POWDER_GRAIN).mul(snow))) as unknown as Node<'vec3'>;
  }
  const glass = nodes.glass;
  const solid = snow ? snow.oneMinus() : float(1);
  if (glass) {
    // Glass is polished: the roughness and the powder's matteness give way to it.
    const matte = material.roughnessNode ?? float(options.roughness ?? JELLY_ROUGHNESS);
    material.roughnessNode = (matte as unknown as Node<'float'>).mul(glass.oneMinus().add(glass.mul(GLASS_ROUGHNESS_KEEP)));
    material.clearcoatNode = (material.clearcoatNode ?? float(JELLY_CLEARCOAT)) as unknown as Node<'float'>;
  }
  if (nodes.bit && nodes.bitColor) {
    const bitShown = glass ? nodes.bit.mul(glass.oneMinus()) : nodes.bit;
    material.colorNode = mix(body, nodes.bitColor, bitShown);
    material.transmissionNode = mix(bitShown.mul(BIT_OPACITY).oneMinus().mul(transmission).mul(solid), float(1), glass ?? float(0));
    if (nodes.glow) material.emissiveNode = nodes.glow as unknown as Node<'color'>;
  } else {
    material.colorNode = body;
    material.transmissionNode = mix(float(transmission).mul(solid), float(1), glass ?? float(0));
  }
  if (options.sparkle) {
    // Glints sit on the surface and depend on the angle it is seen from, so they twinkle as it or the camera moves.
    const grain = mx_noise_float(positionLocal.mul(SPARKLE_GRAIN).add(positionViewDirection.mul(SPARKLE_TURN))).mul(0.5).add(0.5);
    const glint = grain.pow(SPARKLE_SHARPNESS).mul(options.sparkle);
    const lit = body.mul(SPARKLE_OWN_COLOR).add(vec3(1 - SPARKLE_OWN_COLOR)).mul(glint) as unknown as Node<'vec3'>;
    material.emissiveNode = (material.emissiveNode ? (material.emissiveNode as unknown as Node<'vec3'>).add(lit) : lit) as unknown as Node<'color'>;
  }
  return material;
}
