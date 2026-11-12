/**
 * What a splash throws up. Five things, all water, none of them a plain white ball:
 *  - droplets: clear, glossy, bright at the rim, drawn as streaks along their path; they fall back in and make ripples
 *    of their own where they land (and a few finer drops of their own)
 *  - a crown: the thin sheet of water that rises round the point of impact, with a ragged, fingered rim, then collapses
 *  - a jet: the column that shoots up in the middle just after, and throws its own drops from the top
 *  - mist: a soft haze that hangs over the splash and thins away
 *  - foam and ripples, written into the simulation (see sim.ts)
 * Everything is a fixed pool; nothing is made while playing.
 */
import * as THREE from 'three/webgpu';
import {
  attribute, clamp, cos, float, mix, mx_noise_float, normalView, positionViewDirection, pow, sin, smoothstep, uniform, uv, vec3,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { waterSettings } from './params.ts';
import type { WaterSim } from './sim.ts';
import type { Quality } from './quality.ts';

const MAX_DROPS = 600;
const MAX_MIST = 90;
const POOL_CROWNS = 5;
const POOL_JETS = 5;
const EARTH_GRAVITY = 9.81;
/** Drawn after the water surface (which is order 2), so the spray is seen over it and not behind it. */
const SPRAY_ORDER = 5;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

type Drop = { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; radius: number; level: number; fine: boolean };
type Puff = { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; age: number; life: number; alpha: number };
type Sheet = { wx: number; wz: number; mesh: THREE.Mesh; t: ReturnType<typeof uniform<number>>; r: ReturnType<typeof uniform<number>>; h: ReturnType<typeof uniform<number>>; seed: ReturnType<typeof uniform<number>>; age: number; life: number; delay: number; alive: boolean };
type Event = { at: number; run: () => void };

const num = (key: string) => waterSettings.num(key) as unknown as Node<'float'>;
const col = (key: string) => waterSettings.col(key) as unknown as Node<'vec3'>;

export class WaterSpray {
  readonly group = new THREE.Group();
  private readonly drops: Drop[] = Array.from({ length: MAX_DROPS }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0, level: 0, fine: false }));
  private readonly puffs: Puff[] = Array.from({ length: MAX_MIST }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, age: 0, life: 1, alpha: 0 }));
  private readonly crowns: Sheet[] = [];
  private readonly jets: Sheet[] = [];
  private readonly events: Event[] = [];
  private readonly droplets: THREE.InstancedMesh;
  private readonly mist: THREE.InstancedMesh;
  private nextDrop = 0;
  private nextPuff = 0;
  private nextCrown = 0;
  private nextJet = 0;
  private clock = 0;
  private state = 12345;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly sim: WaterSim;
  private quality: Quality;
  /** What the last update spent on the CPU (ms), and how many droplets and puffs were drawn (for the cost readout). */
  lastMilliseconds = 0;
  drawnDrops = 0;
  private idle = true;

  constructor(sim: WaterSim, quality: Quality) {
    this.sim = sim;
    this.quality = quality;
    // Droplets.
    const dropMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.04, metalness: 0, transparent: true, depthWrite: false });
    const facing = normalView.dot(positionViewDirection).abs();
    const rim = float(1).sub(facing);
    dropMaterial.colorNode = col('dropletTint');
    dropMaterial.emissiveNode = col('dropletTint').mul(pow(rim, 2.2)).mul(0.9);
    dropMaterial.opacityNode = clamp(num('dropletOpacity').mul(float(0.4).add(pow(rim, 1.4).mul(1.3))), 0, 1);
    dropMaterial.specularIntensityNode = float(1.5) as unknown as Node<'float'>;
    this.droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), dropMaterial, MAX_DROPS);
    // Mist.
    const mistMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const fromCentre = uv().sub(0.5).length().mul(2);
    mistMaterial.colorNode = vec3(0.92, 0.96, 1);
    const cloud = mx_noise_float(vec3(uv().mul(3.5), 1.3)).mul(0.5).add(0.5);
    mistMaterial.opacityNode = float(1).sub(smoothstep(0, 1, fromCentre)).pow(2.4).mul(cloud.mul(0.8).add(0.1)).mul(0.045);
    this.mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mistMaterial, MAX_MIST);
    for (const mesh of [this.droplets, this.mist]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = SPRAY_ORDER;
      mesh.count = 0;
      this.group.add(mesh);
    }
    const crownGeometry = sheetGeometry(96, 10);
    const jetGeometry = sheetGeometry(20, 14);
    for (let i = 0; i < POOL_CROWNS; i++) this.crowns.push(this.makeSheet(crownGeometry, crownMaterial));
    for (let i = 0; i < POOL_JETS; i++) this.jets.push(this.makeSheet(jetGeometry, jetMaterial));
  }

  /** The quality changed: spray beyond what it allows is let go. */
  apply(quality: Quality) {
    this.quality = quality;
    for (let i = quality.dropletCap; i < MAX_DROPS; i++) this.drops[i].alive = false;
    if (this.nextDrop >= quality.dropletCap) this.nextDrop = 0;
    if (!quality.crown) for (const sheet of this.crowns) { sheet.alive = false; sheet.mesh.visible = false; }
    if (!quality.jet) for (const sheet of this.jets) { sheet.alive = false; sheet.mesh.visible = false; }
    if (!quality.mist) for (const puff of this.puffs) puff.alive = false;
  }

  private makeSheet(geometry: THREE.BufferGeometry, build: (u: SheetUniforms) => THREE.Material): Sheet {
    const u = { t: uniform(0), r: uniform(0.5), h: uniform(1), seed: uniform(0) };
    const mesh = new THREE.Mesh(geometry, build(u));
    mesh.frustumCulled = false;
    mesh.renderOrder = SPRAY_ORDER;
    mesh.visible = false;
    this.group.add(mesh);
    return { wx: 0, wz: 0, mesh, ...u, age: 0, life: 1, delay: 0, alive: false };
  }

  private random() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  /** A splash. `strength` 0..1; (vx, vz) the thing that fell in; `radius` its size in metres. */
  splash(x: number, z: number, level: number, strength: number, vx: number, vz: number, radius: number) {
    const v = waterSettings.values;
    const s = Math.max(0.05, Math.min(1, strength));
    // Droplets: most from the crown (up and out in a ring), the rest straight up from the middle.
    const q = this.quality;
    this.idle = false;
    const count = Math.min(q.dropletCap - 4, Math.round(v.sprayAmount * q.dropletScale * (14 + 110 * s) * (0.5 + radius)));
    for (let i = 0; i < count; i++) {
      const crown = this.random() < 0.7;
      const angle = this.random() * TAU;
      const rimRadius = crown ? radius * (0.7 + 0.5 * this.random()) : radius * 0.25 * this.random();
      const elevation = crown ? (0.9 + 0.5 * this.random()) : (1.25 + 0.3 * this.random());
      const launch = v.launchSpeed * (0.2 + 0.8 * Math.pow(this.random(), 1.4)) * (0.35 + 0.65 * s);
      const horizontal = Math.cos(elevation) * launch * v.spread;
      const size = v.dropletSize * (0.3 + v.dropletVariety * Math.pow(this.random(), 2.2) * 1.8) * (0.6 + 0.6 * s);
      this.spawnDrop(x + Math.cos(angle) * rimRadius, level + 0.03, z + Math.sin(angle) * rimRadius,
        Math.cos(angle) * horizontal + vx * 0.4, Math.sin(elevation) * launch, Math.sin(angle) * horizontal + vz * 0.4, size, level, false);
    }
    // The crown, and (a moment later) the jet.
    if (q.crown && v.crownAmount > 0.01) {
      const crown = this.crowns[this.nextCrown]; this.nextCrown = (this.nextCrown + 1) % POOL_CROWNS;
      this.startSheet(crown, x, level, z, radius * 0.8, radius * v.crownHeight * v.crownAmount * (0.55 + 1.1 * s), 0.5 + 0.35 * s, 0);
    }
    if (q.jet && v.jetAmount > 0.01 && s > 0.25) {
      const jet = this.jets[this.nextJet]; this.nextJet = (this.nextJet + 1) % POOL_JETS;
      const height = radius * v.jetHeight * v.jetAmount * (0.6 + 1.7 * s);
      const life = 0.55 + 0.3 * s, delay = 0.1;
      this.startSheet(jet, x, level, z, radius * 0.11, height, life, delay);
      // When the jet is at the top, it lets go of a few big drops.
      this.events.push({ at: this.clock + delay + life * 0.42, run: () => {
        for (let i = 0; i < 2 + Math.round(3 * s * v.sprayAmount); i++) {
          const angle = this.random() * TAU, out = 0.4 + 1.6 * this.random();
          this.spawnDrop(x, level + height * 0.85, z, Math.cos(angle) * out + vx * 0.2, 1 + 2.2 * this.random(), Math.sin(angle) * out + vz * 0.2, v.dropletSize * (1.4 + 1.2 * this.random()), level, false);
        }
      } });
    }
    // Mist.
    const puffs = q.mist ? Math.round(v.mist * (3 + 14 * s)) : 0;
    for (let i = 0; i < puffs; i++) {
      const puff = this.puffs[this.nextPuff]; this.nextPuff = (this.nextPuff + 1) % MAX_MIST;
      const angle = this.random() * TAU, out = radius * (0.2 + 1.1 * this.random());
      puff.x = x + Math.cos(angle) * out; puff.z = z + Math.sin(angle) * out; puff.y = level + 0.1 + 0.4 * this.random();
      puff.vx = Math.cos(angle) * 0.5 + vx * 0.1; puff.vz = Math.sin(angle) * 0.5 + vz * 0.1; puff.vy = 0.5 + 1.1 * this.random();
      puff.size = (0.9 + 1.0 * this.random()) * (0.5 + radius); puff.age = 0; puff.life = 0.6 + 0.8 * this.random(); puff.alpha = (0.25 + 0.35 * s) * Math.min(1, v.mist); puff.alive = true;
    }
  }

  /** A single raindrop hitting the surface: a tiny crown and a couple of droplets. */
  drip(x: number, z: number, level: number) {
    const v = waterSettings.values;
    this.idle = false;
    for (let i = 0; i < 3; i++) {
      const angle = this.random() * TAU, out = 0.4 + 0.7 * this.random();
      this.spawnDrop(x, level + 0.01, z, Math.cos(angle) * out, 1.2 + 1.2 * this.random(), Math.sin(angle) * out, v.dropletSize * 0.3, level, true);
    }
  }

  private startSheet(sheet: Sheet, x: number, level: number, z: number, radius: number, height: number, life: number, delay: number) {
    sheet.wx = x; sheet.wz = z;
    sheet.mesh.position.set(x, level, z);
    sheet.r.value = radius; sheet.h.value = height; sheet.seed.value = this.random() * 100;
    sheet.age = 0; sheet.life = life; sheet.delay = delay; sheet.alive = true; sheet.t.value = 0;
    sheet.mesh.visible = delay <= 0;
  }

  private spawnDrop(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number, level: number, fine: boolean) {
    const drop = this.drops[this.nextDrop];
    this.nextDrop = (this.nextDrop + 1) % this.quality.dropletCap;
    drop.x = x; drop.y = y; drop.z = z; drop.vx = vx; drop.vy = vy; drop.vz = vz; drop.radius = radius; drop.level = level; drop.fine = fine; drop.alive = true;
  }

  /** @param originZ the render origin: everything is kept in world coordinates and shifted by this to be drawn */
  update(dt: number, originZ = 0) {
    this.clock += dt;
    // Nothing in the air and nothing waiting: nothing to do (the common case, and free).
    if (this.idle) { this.lastMilliseconds = 0; return; }
    const started = performance.now();
    const v = waterSettings.values, q = this.quality;
    const gravity = EARTH_GRAVITY * v.gravity;
    const { matrix, position, direction, quaternion, scale } = this;
    // Events (the jet letting go of its drops).
    for (let i = this.events.length - 1; i >= 0; i--) if (this.clock >= this.events[i].at) { this.events[i].run(); this.events.splice(i, 1); }
    // Droplets: only the live ones are written, packed at the front, and only those are drawn.
    let live = 0;
    for (let i = 0; i < q.dropletCap; i++) {
      const drop = this.drops[i];
      if (!drop.alive) continue;
      drop.vy -= gravity * dt;
      drop.x += drop.vx * dt; drop.y += drop.vy * dt; drop.z += drop.vz * dt;
      if (drop.vy < 0 && drop.y <= drop.level) {
        drop.alive = false;
        // Where it lands: a ripple and a fleck of foam, and from a big one a few finer drops.
        if (q.landingRipples) {
          const w = Math.min(1, drop.radius / 0.08);
          this.sim.drop(drop.x, drop.z, 0.12 + drop.radius * 4, -0.004 * (0.3 + w * 2.2));
          this.sim.addFoam(drop.x, drop.z, 0.1 + drop.radius * 3, (0.3 + 0.5 * w) * Math.min(1.5, v.foamAmount));
        }
        if (q.fineDrops && !drop.fine && drop.radius > v.dropletSize * 1.3) {
          for (let k = 0; k < 3; k++) {
            const angle = this.random() * TAU, out = 0.5 + 0.8 * this.random();
            this.spawnDrop(drop.x, drop.level + 0.01, drop.z, Math.cos(angle) * out, 0.8 + 1.2 * this.random(), Math.sin(angle) * out, drop.radius * 0.28, drop.level, true);
          }
        }
        continue;
      }
      const speed = Math.hypot(drop.vx, drop.vy, drop.vz);
      direction.set(drop.vx, drop.vy, drop.vz).divideScalar(speed || 1);
      quaternion.setFromUnitVectors(UP, direction);
      // A streak along its path: longer the faster it goes.
      scale.set(drop.radius, drop.radius + v.stretch * speed * 0.5, drop.radius);
      position.set(drop.x, drop.y, drop.z - originZ);
      matrix.compose(position, quaternion, scale);
      this.droplets.setMatrixAt(live++, matrix);
    }
    this.droplets.count = live;
    if (live > 0) this.droplets.instanceMatrix.needsUpdate = true;
    this.drawnDrops = live;
    // Mist.
    let mist = 0;
    for (let i = 0; i < MAX_MIST; i++) {
      const puff = this.puffs[i];
      if (!puff.alive) continue;
      puff.age += dt;
      if (puff.age >= puff.life) { puff.alive = false; continue; }
      puff.x += puff.vx * dt; puff.y += puff.vy * dt; puff.z += puff.vz * dt;
      const slow = Math.exp(-0.9 * dt);
      puff.vy *= slow; puff.vx *= slow; puff.vz *= slow;
      const t = puff.age / puff.life;
      position.set(puff.x, puff.y, puff.z - originZ);
      // The fade rides on the size of the quad (its colour is fixed), so a puff thins as it dies by shrinking.
      scale.setScalar(puff.size * (0.5 + t) * Math.sqrt(puff.alpha * (1 - t) * Math.min(1, t * 6 + 0.2)) * 1.6);
      matrix.compose(position, quaternion.identity(), scale);
      this.mist.setMatrixAt(mist++, matrix);
    }
    this.mist.count = mist;
    if (mist > 0) this.mist.instanceMatrix.needsUpdate = true;
    // Crowns and jets.
    let sheets = 0;
    for (const sheet of this.crowns) sheets += this.advanceSheet(sheet, dt, originZ);
    for (const sheet of this.jets) sheets += this.advanceSheet(sheet, dt, originZ);
    if (live === 0 && mist === 0 && sheets === 0 && this.events.length === 0) this.idle = true;
    this.lastMilliseconds = performance.now() - started;
  }

  /** Age one crown or jet; 1 if it is still going. */
  private advanceSheet(sheet: Sheet, dt: number, originZ: number): number {
    if (!sheet.alive) return 0;
    sheet.age += dt;
    sheet.mesh.position.z = sheet.wz - originZ;
    if (sheet.age < sheet.delay) return 1;
    sheet.mesh.visible = true;
    const t = (sheet.age - sheet.delay) / sheet.life;
    if (t >= 1) { sheet.alive = false; sheet.mesh.visible = false; return 0; }
    sheet.t.value = t;
    return 1;
  }

  reset() {
    for (const drop of this.drops) drop.alive = false;
    for (const puff of this.puffs) puff.alive = false;
    this.idle = true; this.droplets.count = 0; this.mist.count = 0;
    for (const sheet of [...this.crowns, ...this.jets]) { sheet.alive = false; sheet.mesh.visible = false; }
    this.events.length = 0;
  }
}

type SheetUniforms = { t: ReturnType<typeof uniform<number>>; r: ReturnType<typeof uniform<number>>; h: ReturnType<typeof uniform<number>>; seed: ReturnType<typeof uniform<number>> };

/** An open tube: `cuv.x` is the way round (0..1) and `cuv.y` the way up (0..1); the shape is made in the shader. */
function sheetGeometry(columns: number, rows: number) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const cuv = new Float32Array((columns + 1) * (rows + 1) * 2);
  const indices: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const k = j * (columns + 1) + i;
      cuv[k * 2] = i / columns; cuv[k * 2 + 1] = j / rows;
      if (i < columns && j < rows) {
        const a = k, b = k + 1, c = k + columns + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('cuv', new THREE.BufferAttribute(cuv, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** The sheet of water round the impact: flares out and up with a ragged, fingered rim, then falls back. */
function crownMaterial(u: SheetUniforms): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const cuv = attribute('cuv', 'vec2') as unknown as Node<'vec2'>;
  const way = cuv.x.mul(TAU), up = cuv.y;
  const t = u.t as unknown as Node<'float'>, radius = u.r as unknown as Node<'float'>, height = u.h as unknown as Node<'float'>, seed = u.seed as unknown as Node<'float'>;
  const fingers = num('crownFingers');
  // How tall the sheet is now: up fast, then slowly back down.
  const rise = float(1).sub(float(1).sub(clamp(t.mul(2.4), 0, 1)).pow(2));
  const fall = float(1).sub(smoothstep(0.5, 1, t));
  const now = height.mul(rise).mul(fall);
  // The rim is in fingers, higher in some places than others.
  const around = mx_noise_float(vec3(cuv.x.mul(fingers), seed, 0.5)).mul(0.5).add(0.5);
  const shape = mix(float(1), around.mul(0.6).add(0.55), up.pow(2));
  const lift = up.mul(now).mul(shape);
  // A tulip: nearly upright at the foot, curling outward toward the rim.
  const reach = radius.mul(float(1).add(t.mul(0.9))).add(now.mul(up.mul(0.12).add(up.pow(2.4).mul(0.55))));
  material.positionNode = vec3(cos(way).mul(reach), lift, sin(way).mul(reach));
  const streaks = mx_noise_float(vec3(cuv.x.mul(fingers.mul(3.2)), up.mul(2), seed)).mul(0.5).add(0.5);
  const ragged = smoothstep(0.62, 1, up.add(around.sub(0.5).mul(0.5)));
  const tint = col('dropletTint');
  material.colorNode = mix(tint.mul(0.85), vec3(1), up.mul(0.7).add(streaks.mul(0.2)));
  material.opacityNode = num('crownOpacity').mul(float(1).sub(t).pow(1.1)).mul(float(1).sub(ragged)).mul(streaks.mul(0.5).add(0.5)).mul(smoothstep(0, 0.08, up).add(0.1).min(1));
  return material;
}

/** The column that rises in the middle: thin, with a round head, breaking into drops at the top. */
function jetMaterial(u: SheetUniforms): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const cuv = attribute('cuv', 'vec2') as unknown as Node<'vec2'>;
  const way = cuv.x.mul(TAU), up = cuv.y;
  const t = u.t as unknown as Node<'float'>, radius = u.r as unknown as Node<'float'>, height = u.h as unknown as Node<'float'>, seed = u.seed as unknown as Node<'float'>;
  const rise = sin(clamp(t, 0, 1).mul(Math.PI)).pow(0.7);
  const now = height.mul(rise);
  const head = float(0.55).mul(float(1).sub(up.sub(0.9).div(0.09).pow(2)).max(0));
  const thin = radius.mul(float(1).sub(up.mul(0.6)).add(head)).mul(float(1).add(float(1).sub(t).mul(0.6)));
  material.positionNode = vec3(cos(way).mul(thin), up.mul(now), sin(way).mul(thin));
  const grain = mx_noise_float(vec3(up.mul(6), cuv.x.mul(4), seed)).mul(0.5).add(0.5);
  material.colorNode = mix(col('dropletTint').mul(0.9), vec3(1), up.mul(0.5));
  const strands = mx_noise_float(vec3(cuv.x.mul(7), up.mul(9), seed)).mul(0.5).add(0.5);
  material.opacityNode = num('crownOpacity').mul(1.25).mul(strands.mul(0.55).add(0.5)).mul(float(1).sub(smoothstep(0.7, 1, t))).mul(float(1).sub(smoothstep(0.85, 1, up.add(grain.sub(0.5).mul(0.3)))).max(0.0));
  return material;
}
