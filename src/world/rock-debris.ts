/**
 * The pieces of a rock the glass marble has smashed: a handful of rough chunks thrown out from the rock, tumbling,
 * falling and bouncing on the ground, then shrinking away. One instanced mesh; a fixed pool, nothing made while playing.
 */
import * as THREE from 'three/webgpu';
import { terrainHeight } from '../game/terrain.ts';
import { GRAVITY } from '../game/tuning.ts';
import { rockColorAt } from './biome-looks.ts';

const POOL = 96;
/** Chunks thrown per rock, at least this many however small, and more for a big one. */
const MIN_CHUNKS = 10;
const CHUNKS_PER_RADIUS = 8;
/** Chunk size as a share of the rock's radius (smallest and the spread above it). */
const SIZE_MIN = 0.05;
const SIZE_SPREAD = 0.11;
/** Throw speed: sideways (m/s per metre of rock radius, with a floor) and up, plus a share of the marble's own velocity. */
const THROW_SIDE = 2.4;
const THROW_SIDE_MIN = 3;
const THROW_UP = 3.5;
const THROW_UP_SPREAD = 4;
const INHERIT = 0.6;
const SPIN_RATE = 9;
const BOUNCE = 0.35;
const ROLL_KEEP = 0.7;
/** Lifetime, and how long the shrinking at the end takes. */
const LIFE_SECONDS = 2.6;
const SHRINK_SECONDS = 0.7;
const SHADE_MIN = 0.7;
const SHADE_RANGE = 0.5;
const ROUGHNESS = 0.92;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_TO_UNIT = 1 / 4294967296;

type Chunk = {
  alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  size: number; age: number; ax: number; ay: number; az: number; sx: number; sy: number; sz: number;
};

export class RockDebris {
  readonly mesh: THREE.InstancedMesh;
  private readonly chunks: Chunk[] = Array.from({ length: POOL }, () => ({
    alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, age: 0, ax: 0, ay: 0, az: 0, sx: 0, sy: 0, sz: 0,
  }));
  private next = 0;
  private seed = 0x9e3779b9;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor() {
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardNodeMaterial({ roughness: ROUGHNESS, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geometry, material, POOL);
    for (let i = 0; i < POOL; i++) this.mesh.setColorAt(i, this.color.setScalar(1));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return this.seed * UINT32_TO_UNIT;
  }

  /** A rock at (x, y, z) of `radius` broke while the marble was moving at (vx, vy, vz). */
  burst(x: number, y: number, z: number, radius: number, look: number, vx: number, vy: number, vz: number) {
    const count = Math.round(MIN_CHUNKS + CHUNKS_PER_RADIUS * radius);
    const shade = rockColorAt(-z, this.color).multiplyScalar(SHADE_MIN + SHADE_RANGE * look);
    for (let n = 0; n < count; n++) {
      const chunk = this.chunks[this.next];
      const slot = this.next;
      this.next = (this.next + 1) % POOL;
      const angle = this.random() * Math.PI * 2, reach = this.random() * radius * 0.8;
      chunk.x = x + Math.cos(angle) * reach; chunk.z = z + Math.sin(angle) * reach; chunk.y = y + radius * this.random();
      const side = Math.max(THROW_SIDE_MIN, THROW_SIDE * radius) * (0.4 + this.random());
      chunk.vx = Math.cos(angle) * side + vx * INHERIT; chunk.vz = Math.sin(angle) * side + vz * INHERIT;
      chunk.vy = THROW_UP + THROW_UP_SPREAD * this.random() + vy * INHERIT;
      chunk.size = radius * (SIZE_MIN + SIZE_SPREAD * this.random());
      chunk.sx = 1 + 0.6 * this.random(); chunk.sy = 0.6 + 0.5 * this.random(); chunk.sz = 0.8 + 0.5 * this.random();
      chunk.ax = (this.random() - 0.5) * SPIN_RATE; chunk.ay = (this.random() - 0.5) * SPIN_RATE; chunk.az = (this.random() - 0.5) * SPIN_RATE;
      chunk.age = 0; chunk.alive = true;
      this.mesh.setColorAt(slot, shade);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Move every chunk on, and pose the live ones (world z is shifted by `originZ` for drawing). */
  update(originZ: number, dt: number) {
    let any = false;
    const { matrix, position, quaternion, euler, scale } = this;
    for (let i = 0; i < POOL; i++) {
      const chunk = this.chunks[i];
      if (!chunk.alive) { scale.setScalar(0); position.set(0, 0, 0); matrix.compose(position, quaternion.identity(), scale); this.mesh.setMatrixAt(i, matrix); continue; }
      any = true;
      chunk.age += dt;
      if (chunk.age >= LIFE_SECONDS) { chunk.alive = false; continue; }
      chunk.vy -= GRAVITY * dt;
      chunk.x += chunk.vx * dt; chunk.y += chunk.vy * dt; chunk.z += chunk.vz * dt;
      const floor = terrainHeight(chunk.x, chunk.z) + chunk.size * chunk.sy;
      if (chunk.y < floor) {
        chunk.y = floor;
        if (chunk.vy < 0) chunk.vy *= -BOUNCE;
        chunk.vx *= ROLL_KEEP; chunk.vz *= ROLL_KEEP;
        chunk.ax *= ROLL_KEEP; chunk.ay *= ROLL_KEEP; chunk.az *= ROLL_KEEP;
      }
      const shrink = Math.min(1, (LIFE_SECONDS - chunk.age) / SHRINK_SECONDS);
      position.set(chunk.x, chunk.y, chunk.z - originZ);
      euler.set(chunk.ax * chunk.age, chunk.ay * chunk.age, chunk.az * chunk.age);
      quaternion.setFromEuler(euler);
      scale.set(chunk.size * chunk.sx * shrink, chunk.size * chunk.sy * shrink, chunk.size * chunk.sz * shrink);
      matrix.compose(position, quaternion, scale);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = any ? POOL : 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (const chunk of this.chunks) chunk.alive = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
