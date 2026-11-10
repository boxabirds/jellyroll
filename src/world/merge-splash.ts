/**
 * Droplets flung off when a mushroom merges into the jelly: a small pooled
 * burst in the mushroom's colours that arcs away and shrinks to nothing.
 */
import * as THREE from 'three/webgpu';
import type { Ball, Pickup } from '../game/physics.ts';
import { GRAVITY, MUSHROOM_MAX_RADIUS } from '../game/tuning.ts';
import { SWEETS } from '../render/colors.ts';

const MAX_DROPLETS = 96;
const DROPLETS_PER_MERGE = 8;
const DROPLET_SEGMENTS = 8;
const DROPLET_SECONDS = 0.75;
/** Droplet radius for the largest mushroom; smaller mushrooms throw smaller drops. */
const DROPLET_RADIUS = 0.11;
const DROPLET_RADIUS_SPREAD = 0.5;
/** Speeds (m/s) away from the contact point, upward, and sideways scatter. */
const BURST_OUT = 3.2;
const BURST_UP = 4.2;
const BURST_SCATTER = 2.6;
const DROPLET_ROUGHNESS = 0.18;
/** Droplets glow a little in their own colour so they read against the grass. */
const DROPLET_GLOW = 0.35;
/** Linear congruential generator constants (Numerical Recipes). */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_TO_UNIT = 1 / 4294967296;

type Droplet = { x: number; y: number; z: number; vx: number; vy: number; vz: number; radius: number; age: number };

export class MergeSplash {
  readonly mesh: THREE.InstancedMesh;
  private readonly droplets: Droplet[] = Array.from({ length: MAX_DROPLETS }, () => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0, age: DROPLET_SECONDS,
  }));
  private next = 0;
  private state = 1;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor() {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: DROPLET_ROUGHNESS, metalness: 0 });
    material.emissive.setScalar(DROPLET_GLOW);
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, DROPLET_SEGMENTS, DROPLET_SEGMENTS), material, MAX_DROPLETS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Every slot needs a colour before the first draw.
    for (let i = 0; i < MAX_DROPLETS; i++) this.mesh.setColorAt(i, this.color.setScalar(1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Burst droplets from where the mushroom touched the jelly. */
  spawn(pickup: Pickup, ball: Ball) {
    const sizeScale = pickup.radius / MUSHROOM_MAX_RADIUS;
    for (let i = 0; i < DROPLETS_PER_MERGE; i++) {
      const index = this.next;
      const droplet = this.droplets[index];
      this.next = (this.next + 1) % MAX_DROPLETS;
      droplet.x = ball.x + pickup.dx * ball.radius;
      droplet.y = ball.y + pickup.dy * ball.radius;
      droplet.z = ball.z + pickup.dz * ball.radius;
      // They inherit the jelly's motion, so the burst travels with it.
      droplet.vx = ball.vx + pickup.dx * BURST_OUT + (this.random() - 0.5) * 2 * BURST_SCATTER;
      droplet.vy = ball.vy + BURST_UP * (0.5 + this.random());
      droplet.vz = ball.vz + pickup.dz * BURST_OUT + (this.random() - 0.5) * 2 * BURST_SCATTER;
      droplet.radius = DROPLET_RADIUS * sizeScale * (1 - DROPLET_RADIUS_SPREAD * this.random());
      droplet.age = 0;
      // Alternate the mushroom's two colours.
      const sweet = SWEETS[i % 2 === 0 ? pickup.color : pickup.color2];
      this.mesh.setColorAt(index, this.color.copy(sweet.deep).lerp(sweet.tint, this.random()));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(originZ: number, dt: number) {
    const { matrix, position, rotation, scale, mesh } = this;
    let live = 0;
    for (let i = 0; i < MAX_DROPLETS; i++) {
      const droplet = this.droplets[i];
      if (droplet.age < DROPLET_SECONDS) {
        droplet.age += dt;
        droplet.vy -= GRAVITY * dt;
        droplet.x += droplet.vx * dt; droplet.y += droplet.vy * dt; droplet.z += droplet.vz * dt;
        live++;
      }
      const life = Math.min(1, droplet.age / DROPLET_SECONDS);
      // Dead slots collapse to zero size rather than being compacted away.
      scale.setScalar(droplet.radius * (1 - life * life));
      position.set(droplet.x, droplet.y, droplet.z - originZ);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    if (live === 0 && mesh.count === 0) return;
    mesh.count = live === 0 ? 0 : MAX_DROPLETS;
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  private random() {
    this.state = (Math.imul(this.state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return this.state * UINT32_TO_UNIT;
  }
}
