/**
 * Floating power-ups placed by game/pickups.ts: a few meshes are re-posed as the jelly moves on, each turning slowly
 * and bobbing above the ground. Only the next few stretches of course can hold one in view.
 */
import * as THREE from 'three/webgpu';
import { createSpot, pickupInSegment, pickupSegment, type PickupSpec } from '../game/pickups.ts';

const SPIN_RATE = 1.4;
const BOB_RATE = 2.1;
const BOB_HEIGHT = 0.18;

export class PickupField {
  readonly group = new THREE.Group();
  private readonly items: THREE.Object3D[] = [];
  private readonly spot = createSpot();

  /** @param poolSize stretches drawn: the one the jelly is in and the ones ahead that can be in view; @param make builds one item */
  constructor(private readonly spec: PickupSpec, poolSize: number, make: () => THREE.Object3D) {
    for (let i = 0; i < poolSize; i++) {
      const item = make();
      this.items.push(item);
      this.group.add(item);
    }
  }

  /**
   * @param taken the stretch whose item was last picked up (it is no longer there)
   * @param hidden true to show none at all (for example a bee that cannot be taken)
   * @param time seconds of play, for the spin and bob
   * @param onItem called for each visible item with its stretch, so a caller can dress it
   */
  update(ballZ: number, originZ: number, taken: number, hidden: boolean, time: number, onItem?: (item: THREE.Object3D, segment: number, s: number) => void) {
    const current = pickupSegment(this.spec, -ballZ);
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const segment = current + i;
      item.visible = !hidden && segment !== taken && pickupInSegment(this.spec, segment, this.spot);
      if (!item.visible) continue;
      item.position.set(this.spot.x, this.spot.y + Math.sin(time * BOB_RATE + segment) * BOB_HEIGHT, this.spot.z - originZ);
      item.rotation.y = time * SPIN_RATE + segment;
      onItem?.(item, segment, -this.spot.z);
    }
  }

  dispose() {
    const done = new Set<unknown>();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = object.material as THREE.Material;
      if (!done.has(material)) { done.add(material); material.dispose(); }
    });
  }
}
