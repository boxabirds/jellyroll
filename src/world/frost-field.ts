/**
 * What the freeze ray leaves and throws: the patches of ice, black crust and cooled ground it has made (drawn as thin discs laid on the
 * lake or the ground, soft at the edge so they blend in), the ice that sprays out ahead of the jelly when it fires, and the steam that
 * rises from lava and hot ground as they cool.
 */
import * as THREE from 'three/webgpu';
import { float, smoothstep, uv } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { frostPatches, type Frost, type FrostKind } from '../game/frost-store.ts';
import type { Ball } from '../game/physics.ts';
import { terrainHeight } from '../game/terrain.ts';

// --- Patches --------------------------------------------------------------------
const RINGS = 7;
const SEGMENTS = 28;
/** The disc lies this far above the surface it covers, so it does not fight with it. */
const LIFT = 0.07;
/** Where across the disc (0 centre, 0.5 edge) it starts to fade out. */
const FADE_FROM = 0.34;
const ICE_COLOR = '#e6f7ff';
const ICE_ROUGHNESS = 0.12;
const CRUST_COLOR = '#0c0a09';
const COOL_COLOR = '#1b1512';

function material(kind: FrostKind): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: kind === 'ice' ? ICE_COLOR : kind === 'crust' ? CRUST_COLOR : COOL_COLOR,
    roughness: kind === 'ice' ? ICE_ROUGHNESS : 0.95, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  if (kind === 'ice') mat.emissive.set(ICE_COLOR).multiplyScalar(0.18);
  const edge = uv().sub(0.5).length() as unknown as Node<'float'>;
  mat.opacityNode = float(1).sub(smoothstep(FADE_FROM, 0.5, edge)).mul(kind === 'ice' ? 0.92 : 0.96) as unknown as Node<'float'>;
  return mat;
}

/** A disc of radius `radius` whose points follow the ground (for hot ground), or lie flat at `level` (for lakes). Centred on the origin. */
function disc(patch: Frost): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const flat = patch.kind !== 'cool';
  positions.push(0, flat ? patch.level + LIFT : terrainHeight(patch.x, patch.z) + LIFT, 0); uvs.push(0.5, 0.5);
  for (let ring = 1; ring <= RINGS; ring++) {
    const r = (ring / RINGS) * patch.radius;
    for (let k = 0; k < SEGMENTS; k++) {
      const angle = (k / SEGMENTS) * Math.PI * 2, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      positions.push(x, flat ? patch.level + LIFT : terrainHeight(patch.x + x, patch.z + z) + LIFT, z);
      uvs.push(0.5 + (x / patch.radius) * 0.5, 0.5 + (z / patch.radius) * 0.5);
    }
  }
  for (let k = 0; k < SEGMENTS; k++) indices.push(0, 1 + ((k + 1) % SEGMENTS), 1 + k);
  for (let ring = 1; ring < RINGS; ring++) {
    const inner = 1 + (ring - 1) * SEGMENTS, outer = 1 + ring * SEGMENTS;
    for (let k = 0; k < SEGMENTS; k++) {
      const k2 = (k + 1) % SEGMENTS;
      indices.push(inner + k, inner + k2, outer + k, inner + k2, outer + k2, outer + k);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// --- Spray and steam ---------------------------------------------------------------
/**
 * The ray itself is a jet of dense foam, like a fire extinguisher's: for JET_SECONDS it pours out of the jelly's front, thick and
 * bright, billowing wider and slower as it goes, and the lumps of it overlap into one white stream.
 */
const FOAM_LUMPS = 360;
const JET_SECONDS = 1.1;
/** Lumps made a second while it runs. */
const FOAM_RATE = 260;
const FOAM_SPEED = 84;
const FOAM_SPEED_SPREAD = 20;
/** The jet is aimed at the ground this far ahead (metres), so it hits the floor in front of the jelly, as a hose would. */
const AIM_DISTANCE = 9;
/** How steeply it may point: down to this slope, up to a little above level. */
const AIM_DOWN = -0.7;
const AIM_UP = 0.1;
/** Foam hitting the ground gives back this share of its downward speed, loses this share of its forward speed, and splashes sideways this much (m/s). */
const REBOUND = 0.38;
const SKID = 0.72;
const SPLASH = 5;
/** A lump bounces at most this many times. */
const MAX_BOUNCES = 2;
/** Sideways and up spread, as a share of the forward speed: a narrow, hard cone. */
const FOAM_CONE = 0.13;
const FOAM_DRAG = 1.8;
const FOAM_LIFE = 0.85;
const FOAM_LIFE_SPREAD = 0.25;
const FOAM_SIZE_FROM = 0.22;
const FOAM_SIZE_TO = 1.15;
/** Foam keeps rising a little as it billows. */
const FOAM_RISE = 1.4;
const FOAM_WHITE = '#ffffff';
const FOAM_COLD = '#a8dcff';
const FOAM_GLOW = 0.55;
const STEAM_PUFFS = 56;
const STEAM_LIFE = 2.6;
const STEAM_RISE = 2.4;
const STEAM_SIZE_FROM = 1;
const STEAM_SIZE_TO = 3.2;
const STEAM_OPACITY = 0.26;
const STEAM_PER_PATCH = 4;

interface Lump { alive: boolean; age: number; life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; grow: number; bounces: number }
interface Puff { alive: boolean; age: number; delay: number; x: number; y: number; z: number; drift: number; sprite: THREE.Sprite }

function puffTexture(): THREE.Texture {
  const size = 64, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!, gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class FrostField {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly materials: Record<FrostKind, THREE.MeshStandardNodeMaterial> = { ice: material('ice'), crust: material('crust'), cool: material('cool') };
  private readonly lumps: Lump[] = Array.from({ length: FOAM_LUMPS }, () => ({ alive: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grow: 1, bounces: 0 }));
  private readonly foam: THREE.InstancedMesh;
  private readonly foamColor = new THREE.Color();
  private readonly white = new THREE.Color(FOAM_WHITE);
  private readonly cold = new THREE.Color(FOAM_COLD);
  /** The jet while it runs: seconds left and the way it points. */
  private jet = { left: 0, dirX: 0, dirZ: -1 };
  private owed = 0;
  private readonly puffs: Puff[] = [];
  private readonly texture = puffTexture();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private nextLump = 0;
  private nextPuff = 0;
  /** How many patches there were last frame: a drop means a new run, and the old discs go. */
  private seen = 0;

  constructor() {
    const foamMaterial = new THREE.MeshStandardNodeMaterial({ color: FOAM_WHITE, roughness: 0.85, metalness: 0 });
    foamMaterial.emissive.set(FOAM_WHITE).multiplyScalar(FOAM_GLOW);
    this.foam = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), foamMaterial, FOAM_LUMPS);
    this.foam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FOAM_LUMPS; i++) this.foam.setColorAt(i, this.white);
    this.foam.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.foam.frustumCulled = false;
    this.foam.count = 0;
    this.group.add(this.foam);
    for (let i = 0; i < STEAM_PUFFS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, color: '#ffffff', transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({ alive: false, age: 0, delay: 0, x: 0, y: 0, z: 0, drift: 0, sprite });
    }
  }

  /** The freeze ray goes off: a jet of foam pours out ahead of the jelly (see `update`, which makes it). */
  spray(dirX: number, dirZ: number) {
    const length = Math.hypot(dirX, dirZ) || 1;
    this.jet.left = JET_SECONDS; this.jet.dirX = dirX / length; this.jet.dirZ = dirZ / length;
    this.owed = 0;
  }

  /** Steam rises from a patch that has gone cold. */
  steam(patch: Frost) {
    for (let i = 0; i < STEAM_PER_PATCH; i++) {
      const puff = this.puffs[this.nextPuff]; this.nextPuff = (this.nextPuff + 1) % STEAM_PUFFS;
      const angle = Math.random() * Math.PI * 2, reach = Math.random() * patch.radius * 0.8;
      puff.alive = true; puff.age = 0; puff.delay = Math.random() * 0.9;
      puff.x = patch.x + Math.cos(angle) * reach; puff.z = patch.z + Math.sin(angle) * reach; puff.y = patch.level + 0.2;
      puff.drift = (Math.random() - 0.5) * 0.8;
    }
  }

  update(dt: number, originZ: number, ball: Ball) {
    // Patches: add what is new, drop what has gone (a new run clears them all).
    if (frostPatches.length < this.seen || frostPatches.length === 0) this.clearMissing();
    this.seen = frostPatches.length;
    const live = new Set<number>();
    for (const patch of frostPatches) {
      live.add(patch.id);
      let mesh = this.meshes.get(patch.id);
      if (!mesh) {
        mesh = new THREE.Mesh(disc(patch), this.materials[patch.kind]);
        mesh.frustumCulled = false; mesh.renderOrder = 3;
        this.meshes.set(patch.id, mesh); this.group.add(mesh);
      }
      mesh.position.set(patch.x, 0, patch.z - originZ);
    }
    for (const [id, mesh] of this.meshes) if (!live.has(id)) { this.group.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(id); }
    // The jet: lumps of foam made at the jelly's front while it runs, thrown forward in a narrow cone.
    if (this.jet.left > 0) {
      this.jet.left -= dt;
      this.owed += FOAM_RATE * dt;
      const { dirX, dirZ } = this.jet, rightX = -dirZ, rightZ = dirX;
      // Aimed at the ground AIM_DISTANCE ahead of the nozzle, wherever the ground is.
      const nozzleX = ball.x + dirX * ball.radius * 0.9, nozzleZ = ball.z + dirZ * ball.radius * 0.9, nozzleY = ball.y + ball.radius * 0.1;
      const slope = Math.min(AIM_UP, Math.max(AIM_DOWN, (terrainHeight(nozzleX + dirX * AIM_DISTANCE, nozzleZ + dirZ * AIM_DISTANCE) - nozzleY) / AIM_DISTANCE));
      const aim = 1 / Math.hypot(1, slope);
      while (this.owed >= 1) {
        this.owed -= 1;
        const lump = this.lumps[this.nextLump]; this.nextLump = (this.nextLump + 1) % FOAM_LUMPS;
        const speed = FOAM_SPEED + (Math.random() - 0.5) * 2 * FOAM_SPEED_SPREAD, side = (Math.random() - 0.5) * 2 * FOAM_CONE * speed, up = (Math.random() - 0.4) * FOAM_CONE * speed;
        // Made a little along its path already, so a frame's worth does not come out as a clump.
        const ahead = Math.random() * dt * speed;
        lump.alive = true; lump.age = 0; lump.life = FOAM_LIFE + (Math.random() - 0.5) * 2 * FOAM_LIFE_SPREAD; lump.grow = 0.7 + Math.random() * 0.6;
        lump.x = nozzleX + dirX * ahead; lump.z = nozzleZ + dirZ * ahead; lump.y = nozzleY + slope * ahead;
        lump.vx = ball.vx + dirX * speed * aim + rightX * side; lump.vz = ball.vz + dirZ * speed * aim + rightZ * side; lump.vy = speed * aim * slope + up;
        lump.bounces = 0;
      }
    }
    let shown = 0;
    for (const lump of this.lumps) {
      if (!lump.alive) continue;
      lump.age += dt;
      if (lump.age >= lump.life) { lump.alive = false; continue; }
      const drag = Math.exp(-FOAM_DRAG * dt);
      lump.vx *= drag; lump.vz *= drag; lump.vy = lump.vy * drag + FOAM_RISE * dt;
      lump.x += lump.vx * dt; lump.y += lump.vy * dt; lump.z += lump.vz * dt;
      // Foam that hits the floor skids on and some of it bounces up and splashes out sideways.
      const floor = terrainHeight(lump.x, lump.z);
      if (lump.y < floor + FOAM_SIZE_FROM) {
        lump.y = floor + FOAM_SIZE_FROM;
        if (lump.vy < 0 && lump.bounces < MAX_BOUNCES) {
          lump.vy = -lump.vy * REBOUND; lump.vx *= SKID; lump.vz *= SKID; lump.bounces++;
          lump.vx += (Math.random() - 0.5) * 2 * SPLASH; lump.vz += (Math.random() - 0.5) * 2 * SPLASH;
        } else lump.vy = Math.max(0, lump.vy);
      }
      const t = lump.age / lump.life;
      // It swells fast to full size and then thins away.
      const size = (FOAM_SIZE_FROM + (FOAM_SIZE_TO - FOAM_SIZE_FROM) * Math.sqrt(t)) * lump.grow * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      this.position.set(lump.x, lump.y, lump.z - originZ);
      this.scale.setScalar(Math.max(0.01, size));
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.foam.setMatrixAt(shown, this.matrix);
      this.foam.setColorAt(shown, this.foamColor.copy(this.white).lerp(this.cold, t * 0.7));
      shown++;
    }
    this.foam.count = shown;
    this.foam.instanceMatrix.needsUpdate = true;
    if (this.foam.instanceColor) this.foam.instanceColor.needsUpdate = true;
    // Steam.
    for (const puff of this.puffs) {
      if (!puff.alive) continue;
      if (puff.delay > 0) { puff.delay -= dt; puff.sprite.visible = false; continue; }
      puff.age += dt;
      if (puff.age >= STEAM_LIFE) { puff.alive = false; puff.sprite.visible = false; continue; }
      const t = puff.age / STEAM_LIFE;
      puff.sprite.visible = true;
      puff.sprite.position.set(puff.x + puff.drift * puff.age, puff.y + STEAM_RISE * puff.age, puff.z - originZ);
      puff.sprite.scale.setScalar(STEAM_SIZE_FROM + (STEAM_SIZE_TO - STEAM_SIZE_FROM) * t);
      (puff.sprite.material as THREE.SpriteMaterial).opacity = STEAM_OPACITY * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.5);
    }
  }

  private clearMissing() {
    for (const [, mesh] of this.meshes) { this.group.remove(mesh); mesh.geometry.dispose(); }
    this.meshes.clear();
  }

  dispose() {
    this.clearMissing();
    for (const material of Object.values(this.materials)) material.dispose();
    this.foam.geometry.dispose(); (this.foam.material as THREE.Material).dispose();
    for (const puff of this.puffs) (puff.sprite.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
