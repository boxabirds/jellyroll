/**
 * The floating glass marble power-up: a clear glass ball with a twist of
 * colour inside, turning and bobbing above the grass.
 */
import * as THREE from 'three/webgpu';
import { GLASS_PICKUP } from '../game/pickup-kinds.ts';
import { PickupField } from './pickup-field.ts';

const SIZE = 0.95;
const GLASS_COLOR = '#cfeaff';
const GLASS_OPACITY = 0.6;
const GLASS_ROUGHNESS = 0.04;
const GLASS_GLOW = 0.7;
const SWIRL_COLORS = ['#ff4d6d', '#3a8bff', '#ffc61a'];
const SWIRL_RADIUS = 0.34;
const SWIRL_TUBE = 0.07;
const SWIRL_TILT = 0.9;
const SEGMENTS = 32;
/** Stretches drawn: the one the jelly is in and the next two. */
const POOL = 3;

function createMarble(glass: THREE.Material, swirls: readonly THREE.Material[]) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(SIZE, SEGMENTS, SEGMENTS), glass));
  // A few rings of colour at different angles, like the twist inside a marble.
  swirls.forEach((material, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(SWIRL_RADIUS * SIZE / 0.8 * (1 - i * 0.12), SWIRL_TUBE, 10, 36), material);
    ring.rotation.set(SWIRL_TILT * (i + 1), i * 1.7, 0);
    group.add(ring);
  });
  return group;
}

export class GlassItems extends PickupField {
  constructor() {
    const glass = new THREE.MeshStandardNodeMaterial({ color: GLASS_COLOR, roughness: GLASS_ROUGHNESS, metalness: 0, transparent: true, opacity: GLASS_OPACITY, depthWrite: false });
    glass.emissive.set(GLASS_COLOR).multiplyScalar(GLASS_GLOW);
    const swirls = SWIRL_COLORS.map(color => {
      const material = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.3 });
      material.emissive.set(color).multiplyScalar(GLASS_GLOW);
      return material;
    });
    super(GLASS_PICKUP, POOL, () => createMarble(glass, swirls));
  }
}
