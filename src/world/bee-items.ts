/** The bee you can find floating above the valley: one in about half of the biome stretches. Rolling through it gives you a bee. */
import * as THREE from 'three/webgpu';
import type { Ball } from '../game/physics.ts';
import { BEE_PICKUP } from '../game/pickup-kinds.ts';
import { BEE_MAX } from '../game/tuning.ts';
import { beatWings, createBee, createBeeMaterials } from './bee-model.ts';
import { PickupField } from './pickup-field.ts';

/** Drawn a good deal larger than a bee flying beside you, so it can be seen from far down the valley. */
const SIZE = 5;
const HALO_COLOR = '#ffe27a';
const HALO_OPACITY = 0.22;
const HALO_RADIUS = 0.34;
/** Stretches drawn: the one the jelly is in and the next. */
const POOL = 2;
const BEAT_PHASE = 1.3;

export class BeeItems extends PickupField {
  private readonly bees: ReturnType<typeof createBee>[] = [];

  constructor() {
    const materials = createBeeMaterials();
    const bees: ReturnType<typeof createBee>[] = [];
    super(BEE_PICKUP, POOL, () => {
      const holder = new THREE.Group();
      const bee = createBee(materials);
      bee.scale.setScalar(SIZE);
      holder.add(bee);
      // A soft glow so it reads from far away.
      const halo = new THREE.Mesh(new THREE.SphereGeometry(HALO_RADIUS * SIZE, 20, 20), new THREE.MeshBasicNodeMaterial({ color: HALO_COLOR, transparent: true, opacity: HALO_OPACITY, depthWrite: false }));
      holder.add(halo);
      bees.push(bee);
      return holder;
    });
    this.bees = bees;
  }

  /** Not shown once the flock is full: there is nothing to gain from it. */
  frame(ball: Ball, originZ: number, time: number) {
    this.update(ball.z, originZ, ball.beeTakenSegment, ball.flock.count >= BEE_MAX, time);
    for (let i = 0; i < this.bees.length; i++) beatWings(this.bees[i], time, i * BEAT_PHASE);
  }
}
