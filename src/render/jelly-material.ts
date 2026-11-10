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
import { float, mix, normalView, positionViewDirection, vec3 } from 'three/tsl';
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
};

/** Departures from the standard jelly, for things that are not quite jelly (snow, crystal). */
export type JellyOptions = {
  /** Share of light let through; the rest is scattered back as the body's own colour. */
  transmission?: number;
  roughness?: number;
  /** Faceted rather than smooth. */
  flatShading?: boolean;
};

export function createJellyMaterial(nodes: JellyNodes, options: JellyOptions = {}) {
  const transmission = options.transmission ?? JELLY_TRANSMISSION;
  const material = new THREE.MeshPhysicalNodeMaterial({
    roughness: options.roughness ?? JELLY_ROUGHNESS, metalness: 0, transmission: 1,
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
  const body = mix(nodes.tint, nodes.attenuation, BODY_COLOR_DEPTH);
  if (nodes.bit && nodes.bitColor) {
    material.colorNode = mix(body, nodes.bitColor, nodes.bit);
    material.transmissionNode = nodes.bit.mul(BIT_OPACITY).oneMinus().mul(transmission);
    if (nodes.glow) material.emissiveNode = nodes.glow as unknown as Node<'color'>;
  } else {
    material.colorNode = body;
    material.transmissionNode = float(transmission);
  }
  return material;
}
