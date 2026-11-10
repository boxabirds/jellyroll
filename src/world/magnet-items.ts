/**
 * The floating magnet power-ups: a red horseshoe with silver tips, turning
 * slowly and bobbing above the grass. Only the next few stretches of course
 * can hold one in view, so a tiny pool of meshes is re-posed as the jelly
 * moves on.
 */
import * as THREE from 'three/webgpu';
import { createMagnet, magnetInSegment, magnetSegment } from '../game/magnets.ts';
import type { Ball } from '../game/physics.ts';

/** Stretches drawn: the one the jelly is in and the next two (the view reaches about 430 m). */
const POOL = 3;
/** Horseshoe: radius of the bend, thickness of the bar, length of the straight legs, and of their tips. */
const BEND_RADIUS = 0.5;
const BAR_RADIUS = 0.17;
const LEG_LENGTH = 0.42;
const TIP_LENGTH = 0.24;
const RADIAL_SEGMENTS = 12;
const BEND_SEGMENTS = 24;
const BODY_COLOR = '#e8323c';
const TIP_COLOR = '#eef1f5';
const BODY_ROUGHNESS = 0.3;
const TIP_ROUGHNESS = 0.25;
const TIP_METALNESS = 0.6;
/** A little self-light so it reads from far down the valley. */
const GLOW = 0.35;
const SPIN_RATE = 1.6;
const BOB_RATE = 2.2;
const BOB_HEIGHT = 0.18;
const TILT = 0.35;
const SIZE = 1.7;

function createHorseshoe(body: THREE.Material, tip: THREE.Material) {
  const group = new THREE.Group();
  // The bend is the top half of a ring; the legs hang from its ends.
  group.add(new THREE.Mesh(new THREE.TorusGeometry(BEND_RADIUS, BAR_RADIUS, RADIAL_SEGMENTS, BEND_SEGMENTS, Math.PI), body));
  const leg = new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, LEG_LENGTH, RADIAL_SEGMENTS);
  const end = new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, TIP_LENGTH, RADIAL_SEGMENTS);
  for (const side of [-1, 1]) {
    const legMesh = new THREE.Mesh(leg, body);
    legMesh.position.set(side * BEND_RADIUS, -LEG_LENGTH / 2, 0);
    const tipMesh = new THREE.Mesh(end, tip);
    tipMesh.position.set(side * BEND_RADIUS, -LEG_LENGTH - TIP_LENGTH / 2, 0);
    group.add(legMesh, tipMesh);
  }
  // Centre the whole shape on its own origin, where the physics expects it.
  const lift = (LEG_LENGTH + TIP_LENGTH - BEND_RADIUS) / 2;
  for (const child of group.children) child.position.y += lift;
  const holder = new THREE.Group();
  holder.add(group);
  group.rotation.z = TILT;
  holder.scale.setScalar(SIZE);
  return holder;
}

export class MagnetItems {
  readonly group = new THREE.Group();
  private readonly items: THREE.Group[] = [];
  private readonly magnet = createMagnet();
  private readonly body = new THREE.MeshStandardNodeMaterial({ color: BODY_COLOR, roughness: BODY_ROUGHNESS, metalness: 0 });
  private readonly tip = new THREE.MeshStandardNodeMaterial({ color: TIP_COLOR, roughness: TIP_ROUGHNESS, metalness: TIP_METALNESS });

  constructor() {
    this.body.emissive.set(BODY_COLOR).multiplyScalar(GLOW);
    this.tip.emissive.set(TIP_COLOR).multiplyScalar(GLOW);
    for (let i = 0; i < POOL; i++) {
      const item = createHorseshoe(this.body, this.tip);
      this.items.push(item);
      this.group.add(item);
    }
  }

  /** @param time seconds of play, for the spin and bob */
  update(ball: Ball, originZ: number, time: number) {
    const current = magnetSegment(-ball.z);
    for (let i = 0; i < POOL; i++) {
      const item = this.items[i];
      const segment = current + i;
      item.visible = segment !== ball.magnetTakenSegment && magnetInSegment(segment, this.magnet);
      if (!item.visible) continue;
      // Phase by segment so two in view do not move in step.
      item.position.set(this.magnet.x, this.magnet.y + Math.sin(time * BOB_RATE + segment) * BOB_HEIGHT, this.magnet.z - originZ);
      item.rotation.y = time * SPIN_RATE + segment;
    }
  }

  dispose() {
    this.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    this.body.dispose();
    this.tip.dispose();
  }
}
