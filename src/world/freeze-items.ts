/** The freeze ray power-up floating in the valley: a cluster of pale blue ice crystals, turning and bobbing, with a cold glow. */
import * as THREE from 'three/webgpu';
import { FREEZE_PICKUP } from '../game/pickup-kinds.ts';
import { PickupField } from './pickup-field.ts';

const ICE_COLOR = '#bfeaff';
const ICE_OPACITY = 0.78;
const ICE_GLOW = 0.9;
const GLOW_COLOR = '#9fdcff';
const GLOW_OPACITY = 0.18;
const GLOW_RADIUS = 1.5;
/** The big central crystal, and the smaller ones round it (height, radius, tilt from upright, direction round). */
const MAIN: readonly [number, number] = [1.5, 0.5];
const SPIKES: readonly (readonly [number, number, number, number])[] = [
  [1.0, 0.3, 0.7, 0], [0.9, 0.28, 0.8, 2.1], [1.1, 0.3, 0.65, 4.2],
];
/** Stretches drawn: the one the jelly is in and the next two. */
const POOL = 3;
const SIDES = 6;

function crystal(height: number, radius: number, material: THREE.Material): THREE.Mesh {
  // A six-sided point, like a quartz crystal: a prism with a pointed top.
  const geometry = new THREE.CylinderGeometry(0, radius, height, SIDES, 1);
  const prism = new THREE.CylinderGeometry(radius, radius, height * 0.6, SIDES, 1);
  prism.translate(0, -height * 0.2, 0);
  geometry.translate(0, height * 0.3, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.add(new THREE.Mesh(prism, material));
  return mesh;
}

export class FreezeItems extends PickupField {
  constructor() {
    const ice = new THREE.MeshStandardNodeMaterial({ color: ICE_COLOR, roughness: 0.08, metalness: 0, transparent: true, opacity: ICE_OPACITY, depthWrite: false });
    ice.emissive.set(ICE_COLOR).multiplyScalar(ICE_GLOW);
    const glow = new THREE.MeshBasicNodeMaterial({ color: GLOW_COLOR, transparent: true, opacity: GLOW_OPACITY, depthWrite: false });
    super(FREEZE_PICKUP, POOL, () => {
      const group = new THREE.Group();
      const main = crystal(MAIN[0], MAIN[1], ice);
      group.add(main);
      for (const [height, radius, tilt, round] of SPIKES) {
        const spike = crystal(height, radius, ice);
        spike.rotation.set(Math.sin(round) * tilt, 0, Math.cos(round) * tilt);
        spike.position.set(Math.cos(round) * radius * 1.2, -0.3, Math.sin(round) * radius * 1.2);
        group.add(spike);
      }
      group.add(new THREE.Mesh(new THREE.SphereGeometry(GLOW_RADIUS, 20, 20), glow));
      return group;
    });
  }
}
