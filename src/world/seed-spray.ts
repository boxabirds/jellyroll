/**
 * Seeds in the air: small tumbling seeds in the colour of what they will
 * become, thrown in an arc down the valley. When one lands it stops being
 * drawn here and the mushroom field draws the collectible it sprouted into.
 */
import * as THREE from 'three/webgpu';
import { inFlight, seedPosition, type SeedField } from '../game/seeds.ts';
import { MAX_PLANTED } from '../game/tuning.ts';
import { sweetColor } from '../render/colors.ts';

const SEED_RADIUS = 0.13;
const SEED_SQUASH = 0.55;
const SEED_SEGMENTS = 10;
const TUMBLE_RATE = 9;
/** Seeds are a mix of the collectible's colour and seed-brown, so they read as seeds first. */
const SEED_BROWN = new THREE.Color('#9a6a3a');
const BROWN_SHARE = 0.45;
const GLOSS = 0.4;

export class SeedSpray {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, SEED_SQUASH, 1);
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly where = { x: 0, y: 0, z: 0 };

  constructor() {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: GLOSS, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(SEED_RADIUS, SEED_SEGMENTS, SEED_SEGMENTS), material, MAX_PLANTED);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PLANTED; i++) this.mesh.setColorAt(i, this.color.setScalar(1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  update(seeds: SeedField, originZ: number) {
    let count = 0;
    for (const item of seeds.items) {
      if (!item.alive || !inFlight(item)) continue;
      seedPosition(item, this.where);
      this.position.set(this.where.x, this.where.y, this.where.z - originZ);
      this.euler.set(item.age * TUMBLE_RATE, item.seed * 6.28, item.age * TUMBLE_RATE * 0.7);
      this.rotation.setFromEuler(this.euler);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(count, this.matrix);
      const tint = sweetColor(item.kind, item.color).deep;
      this.mesh.setColorAt(count, this.color.copy(tint).lerp(SEED_BROWN, BROWN_SHARE));
      count++;
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
