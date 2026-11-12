/**
 * A bee, built from a few shapes: a yellow striped body, a dark head and sting, and two wings that beat.
 * It faces -z, like everything else that moves. Materials are shared, so one set serves every bee.
 */
import * as THREE from 'three/webgpu';

const BODY_COLOR = '#ffc61a';
const DARK_COLOR = '#2b2118';
const WING_COLOR = '#e8f6ff';
const WING_OPACITY = 0.6;
const GLOW = 0.3;
/** Half-lengths of the body along x, y and z (metres at scale 1: a little under 30 cm long). */
const BODY = [0.09, 0.09, 0.14] as const;
const SEGMENTS = 14;
const STRIPES = [-0.025, 0.065] as const;
const STRIPE_TUBE = 0.022;
const HEAD_RADIUS = 0.062;
const HEAD_OFFSET = -0.15;
const STING_LENGTH = 0.07;
const WING_SPAN = 0.15;
const WING_CHORD = 0.07;
const WING_BASE = 0.075;
const WING_REST_ANGLE = 0.35;
const WING_BEAT_RATE = 70;
const WING_BEAT_AMPLITUDE = 0.55;

export type BeeMaterials = { body: THREE.Material; dark: THREE.Material; wing: THREE.Material };

export function createBeeMaterials(): BeeMaterials {
  const body = new THREE.MeshStandardNodeMaterial({ color: BODY_COLOR, roughness: 0.55 });
  body.emissive.set(BODY_COLOR).multiplyScalar(GLOW);
  const dark = new THREE.MeshStandardNodeMaterial({ color: DARK_COLOR, roughness: 0.6 });
  const wing = new THREE.MeshStandardNodeMaterial({ color: WING_COLOR, roughness: 0.2, transparent: true, opacity: WING_OPACITY, side: THREE.DoubleSide, depthWrite: false });
  wing.emissive.set(WING_COLOR).multiplyScalar(GLOW);
  return { body, dark, wing };
}

/** The wings hang off two pivots; `beat` swings them. */
export type BeeModel = THREE.Group & { userData: { wings: THREE.Object3D[] } };

export function createBee(materials: BeeMaterials): BeeModel {
  const group = new THREE.Group() as BeeModel;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, SEGMENTS, SEGMENTS), materials.body);
  body.scale.set(...BODY);
  group.add(body);
  for (const z of STRIPES) {
    // A ring round the body where it is as wide as the ellipsoid is there.
    const across = Math.sqrt(Math.max(0, 1 - (z / BODY[2]) ** 2));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BODY[0] * across, STRIPE_TUBE, 8, SEGMENTS * 2), materials.dark);
    ring.position.z = z;
    group.add(ring);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, SEGMENTS, SEGMENTS), materials.dark);
  head.position.z = HEAD_OFFSET;
  group.add(head);
  const sting = new THREE.Mesh(new THREE.ConeGeometry(STRIPE_TUBE, STING_LENGTH, 8), materials.dark);
  sting.rotation.x = Math.PI / 2;
  sting.position.z = BODY[2] + STING_LENGTH / 2 - 0.01;
  group.add(sting);
  const wingGeometry = new THREE.CircleGeometry(1, 16);
  const wings: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.02, BODY[1] * 0.8, -0.01);
    const wing = new THREE.Mesh(wingGeometry, materials.wing);
    // A flat ellipse lying out sideways from the pivot.
    wing.rotation.x = -Math.PI / 2;
    wing.scale.set(WING_SPAN / 2, WING_CHORD, 1);
    wing.position.x = side * WING_BASE;
    pivot.add(wing);
    pivot.userData.side = side;
    group.add(pivot);
    wings.push(pivot);
  }
  group.userData.wings = wings;
  return group;
}

/** Flap a bee's wings; `time` in seconds, `phase` so a flock does not beat in step. */
export function beatWings(bee: BeeModel, time: number, phase: number): void {
  const swing = WING_REST_ANGLE + Math.sin(time * WING_BEAT_RATE + phase) * WING_BEAT_AMPLITUDE;
  for (const pivot of bee.userData.wings) pivot.rotation.z = (pivot.userData.side as number) * swing;
}
