/**
 * What the ground needs to know about the jelly and the key light. One set of
 * uniforms shared by every surface the jelly can cast its coloured shadow on.
 * The ball position is in render space (see render-origin.ts).
 */
import * as THREE from 'three/webgpu';
import { abs, exp, float, fract, mix, positionWorld, smoothstep, step, time, uniform, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { START_RADIUS } from '../game/tuning.ts';

/** Shadow edge, as fractions of the ball radius, before height softening. */
const SHADOW_INNER = 0.55;
const SHADOW_OUTER = 1.15;
/** Penumbra growth per metre between the ball and the ground it shades. */
const PENUMBRA_PER_METRE = 0.12;
/** The shadow has faded out entirely once the ball is this far from the ground. */
const SHADOW_FADE_DISTANCE = 30;
/** How much jelly-coloured light makes it through the body. */
const SHADOW_TRANSMISSION = 0.34;
/** Focused light in the middle of the shadow: size (radii) and brightness. */
const CAUSTIC_RADIUS = 0.34;
const CAUSTIC_GAIN = 1.1;
/** Darkening where the body nearly touches the ground. */
const CONTACT_REACH = 0.55;
const CONTACT_STRENGTH = 0.5;
/** The magnet's reach, drawn on the ground: a ring at its edge and ripples running inward. */
const MAGNET_RING_WIDTH = 0.35;
const MAGNET_RIPPLE_WIDTH = 0.6;
const MAGNET_RIPPLE_RATE = 0.9;
const MAGNET_RIPPLE_STRENGTH = 0.55;
const MAGNET_BRIGHTEN = 0.9;
const MAGNET_COLOR = new THREE.Color('#bfe9ff');

export type GroundLighting = {
  readonly ballCenter: { value: THREE.Vector3 };
  readonly ballCenterNode: Node<'vec3'>;
  /** The jelly grows and wears, so its shadow does too. */
  readonly ballRadius: { value: number };
  readonly ballRadiusNode: Node<'float'>;
  /** Follows the mix of colours the jelly has absorbed. */
  readonly jellyTint: { value: THREE.Color };
  /** Reach of an active magnet from the jelly's centre, and how strongly to draw it (0 when off). */
  readonly magnetReach: { value: number };
  readonly magnetStrength: { value: number };
  readonly magnetReachNode: Node<'float'>;
  readonly magnetStrengthNode: Node<'float'>;
  readonly toLightNode: Node<'vec3'>;
  readonly jellyTintNode: Node<'color'>;
};

export function createGroundLighting(toLight: THREE.Vector3, jellyTint: THREE.Color): GroundLighting {
  const ballCenterNode = uniform(new THREE.Vector3());
  const ballRadiusNode = uniform(START_RADIUS);
  const jellyTintNode = uniform(jellyTint.clone());
  const magnetReachNode = uniform(1);
  const magnetStrengthNode = uniform(0);
  return {
    magnetReach: magnetReachNode,
    magnetStrength: magnetStrengthNode,
    magnetReachNode: magnetReachNode as unknown as Node<'float'>,
    magnetStrengthNode: magnetStrengthNode as unknown as Node<'float'>,
    ballCenter: ballCenterNode,
    ballRadius: ballRadiusNode,
    ballRadiusNode: ballRadiusNode as unknown as Node<'float'>,
    jellyTint: jellyTintNode,
    ballCenterNode: ballCenterNode as unknown as Node<'vec3'>,
    toLightNode: uniform(toLight.clone()) as unknown as Node<'vec3'>,
    jellyTintNode: jellyTintNode as unknown as Node<'color'>,
  };
}

/** Multiplies an albedo by the jelly's tinted shadow, its caustic and contact shade. */
export function shadeUnderJelly(albedo: Node<'vec3'>, lighting: GroundLighting): Node<'vec3'> {
  const toBall = lighting.ballCenterNode.sub(positionWorld);
  // Walk from this fragment toward the light; how close does that ray pass the ball?
  const along = toBall.dot(lighting.toLightNode);
  const miss = toBall.sub(lighting.toLightNode.mul(along)).length();
  const spread = along.max(0).mul(PENUMBRA_PER_METRE);
  const fade = along.div(SHADOW_FADE_DISTANCE).oneMinus().clamp(0, 1);
  const radius = lighting.ballRadiusNode;
  const shadow = smoothstep(radius.mul(SHADOW_INNER).sub(spread), radius.mul(SHADOW_OUTER).add(spread), miss)
    .oneMinus().mul(step(0, along)).mul(fade);
  const tint = vec3(lighting.jellyTintNode);
  const focus = miss.div(radius.mul(CAUSTIC_RADIUS));
  const caustic = exp(focus.mul(focus).negate()).mul(CAUSTIC_GAIN);
  const transmitted = tint.mul(float(SHADOW_TRANSMISSION).add(caustic));
  const gap = toBall.length().sub(radius);
  const contact = smoothstep(0, radius.mul(CONTACT_REACH), gap).oneMinus().mul(CONTACT_STRENGTH);
  const shaded = albedo.mul(mix(vec3(1), transmitted, shadow)).mul(contact.oneMinus());
  // Magnet field: a ring where its reach ends, and a ripple sweeping in toward the jelly.
  const away = toBall.length();
  const reach = lighting.magnetReachNode;
  const ring = smoothstep(0, MAGNET_RING_WIDTH, abs(away.sub(reach))).oneMinus();
  const sweep = reach.mul(fract(time.mul(MAGNET_RIPPLE_RATE)).oneMinus());
  const ripple = smoothstep(0, MAGNET_RIPPLE_WIDTH, abs(away.sub(sweep))).oneMinus().mul(MAGNET_RIPPLE_STRENGTH);
  const field = ring.add(ripple).mul(lighting.magnetStrengthNode).mul(MAGNET_BRIGHTEN);
  const fieldColor = vec3(MAGNET_COLOR.r, MAGNET_COLOR.g, MAGNET_COLOR.b);
  return mix(shaded, shaded.add(fieldColor), field.clamp(0, 1)) as unknown as Node<'vec3'>;
}
