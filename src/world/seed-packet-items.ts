/**
 * The floating seed packets: a paper packet with a green label and a seed on
 * it, turning slowly and bobbing above the grass. As with the magnets, only
 * the next few stretches of course can hold one in view.
 */
import * as THREE from 'three/webgpu';
import type { Ball } from '../game/physics.ts';
import { createSeedPacket, seedPacketInSegment, seedPacketSegment } from '../game/seed-packets.ts';
import { SEED_PACKET_SPACING } from '../game/tuning.ts';
import { VIEW_DISTANCE } from './terrain-mesh.ts';

/** Enough to cover everything in view: one per slot out to the drawing distance, and one spare. */
const POOL = Math.ceil(VIEW_DISTANCE / SEED_PACKET_SPACING) + 1;
const PAPER_COLOR = '#f6ecd2';
const FLAP_COLOR = '#e2d2a6';
const LABEL_COLOR = '#43a047';
const SEED_COLOR = '#b9722f';
const LEAF_COLOR = '#9be06a';
const PAPER_ROUGHNESS = 0.8;
const GLOW = 0.22;
const SPIN_RATE = 1.3;
const BOB_RATE = 2;
const BOB_HEIGHT = 0.2;
const TILT = 0.18;
const SIZE = 1.9;
/** Packet body, in metres before SIZE: width, height, thickness. */
const BODY = [0.8, 1.1, 0.1] as const;
const FLAP = [0.84, 0.16, 0.16] as const;
const LABEL = [0.62, 0.52, 0.02] as const;
const SEED_SEGMENTS = 14;

function createPacket(paper: THREE.Material, flap: THREE.Material, label: THREE.Material, seed: THREE.Material, leaf: THREE.Material) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(...BODY), paper));
  const top = new THREE.Mesh(new THREE.BoxGeometry(...FLAP), flap);
  top.position.y = BODY[1] / 2;
  group.add(top);
  // The label and the picture on it, on both faces so it reads as it turns.
  for (const face of [1, -1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(...LABEL), label);
    panel.position.set(0, -0.08, face * (BODY[2] / 2 + LABEL[2] / 2));
    const kernel = new THREE.Mesh(new THREE.SphereGeometry(0.11, SEED_SEGMENTS, SEED_SEGMENTS), seed);
    kernel.scale.set(0.8, 1.15, 0.45);
    kernel.position.set(0, -0.18, face * (BODY[2] / 2 + LABEL[2] + 0.02));
    const sprout = new THREE.Mesh(new THREE.SphereGeometry(0.09, SEED_SEGMENTS, SEED_SEGMENTS), leaf);
    sprout.scale.set(1.3, 0.55, 0.3);
    sprout.position.set(0.07, 0.0, face * (BODY[2] / 2 + LABEL[2] + 0.02));
    sprout.rotation.z = 0.5;
    group.add(panel, kernel, sprout);
  }
  const holder = new THREE.Group();
  holder.add(group);
  group.rotation.z = TILT;
  holder.scale.setScalar(SIZE);
  return holder;
}

export class SeedPacketItems {
  readonly group = new THREE.Group();
  private readonly items: THREE.Group[] = [];
  private readonly packet = createSeedPacket();
  private readonly materials = [
    new THREE.MeshStandardNodeMaterial({ color: PAPER_COLOR, roughness: PAPER_ROUGHNESS }),
    new THREE.MeshStandardNodeMaterial({ color: FLAP_COLOR, roughness: PAPER_ROUGHNESS }),
    new THREE.MeshStandardNodeMaterial({ color: LABEL_COLOR, roughness: PAPER_ROUGHNESS }),
    new THREE.MeshStandardNodeMaterial({ color: SEED_COLOR, roughness: 0.5 }),
    new THREE.MeshStandardNodeMaterial({ color: LEAF_COLOR, roughness: 0.5 }),
  ] as const;

  constructor() {
    for (const material of this.materials) material.emissive.copy(material.color).multiplyScalar(GLOW);
    for (let i = 0; i < POOL; i++) {
      const item = createPacket(...this.materials);
      this.items.push(item);
      this.group.add(item);
    }
  }

  /** @param time seconds of play, for the spin and bob */
  update(ball: Ball, originZ: number, time: number) {
    const current = seedPacketSegment(-ball.z);
    for (let i = 0; i < POOL; i++) {
      const item = this.items[i];
      const segment = current + i;
      item.visible = segment !== ball.seedTakenSegment && seedPacketInSegment(segment, this.packet);
      if (!item.visible) continue;
      item.position.set(this.packet.x, this.packet.y + Math.sin(time * BOB_RATE + segment) * BOB_HEIGHT, this.packet.z - originZ);
      item.rotation.y = time * SPIN_RATE + segment;
    }
  }

  dispose() {
    this.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    for (const material of this.materials) material.dispose();
  }
}
