/**
 * The things standing in the holes: ice shards in the ice, plumes of steam
 * above the vents, bubbles breaking on lava. The holes themselves are the
 * ground's own shading (terrain-mesh.ts); this only adds the solid parts.
 *
 * The list of holes near the jelly is rebuilt when it crosses into a new grid
 * cell; steam and bubbles are re-posed every frame from the game clock, so
 * they pulse in step with what the vents do to the jelly.
 */
import * as THREE from 'three/webgpu';
import { ICE, LAVA, SCREE } from '../game/biomes.ts';
import { createHazardSample, createHoleDisc, hazardAt, holeCellIndex, holeInCell, isLiquidKind } from '../game/hazards.ts';
import { hash2 } from '../game/noise.ts';
import { courseCenter, courseHalfWidth, holeEffectAt, holeLevel, terrainHeight } from '../game/terrain.ts';
import {
  HAZARD_CELL,
  HAZARD_VENT_DUTY,
  HAZARD_VENT_HEIGHT,
  HAZARD_VENT_PHASE_PER_METRE,
  HAZARD_VENT_RATE,
  RIDGE_DISTANCE,
  VALLEY_HALF_WIDTH,
  VALLEY_HALF_WIDTH_SWING,
  WORLD_SEED,
} from '../game/tuning.ts';
import { createJaggedShard } from './ice-shard-geometry.ts';
import { VIEW_DISTANCE } from './terrain-mesh.ts';

const TAU = Math.PI * 2;
const SEED_PLACE_U = WORLD_SEED + 71;
const SEED_PLACE_S = WORLD_SEED + 72;
const SEED_SIZE = WORLD_SEED + 73;
const SEED_LEAN = WORLD_SEED + 74;

/** Props are only made this far (metres) ahead of the jelly and this far behind: fog hides the rest. */
const AHEAD = 190;
const BEHIND = 30;
const CELLS_AHEAD = Math.ceil(AHEAD / HAZARD_CELL);
const CELLS_BEHIND = Math.ceil(BEHIND / HAZARD_CELL);
const CELLS_ACROSS = Math.ceil((VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING + RIDGE_DISTANCE) / HAZARD_CELL) + 1;
/** A prop is placed only where the ground really is this deep in a hole. */
const PLACE_DEPTH = 0.85;
const MAX_SHARDS = 3600;
const MAX_PUFFS = 420;
const MAX_BUBBLES = 320;

// ice shards
/** Different jagged shapes of shard, each its own instanced mesh. */
const SHARD_SHAPES = 6;
const SHARDS_BASE = 10;
const SHARDS_PER_METRE_OF_RADIUS = 6;
/** Shards are small, so they are only made this far (metres) ahead of the jelly. */
const SHARD_AHEAD = 120;
const SHARD_HEIGHT_MIN = 0.7;
const SHARD_HEIGHT_RANGE = 1.1;
const SHARD_WIDTH = 0.3;
const SHARD_LEAN = 0.3;
const SHARD_COLOR = '#bfe8ff';
const SHARD_ROUGHNESS = 0.08;
const SHARD_GLOW = 0.18;
/** Shards stand this far inside the hole's edge, as a fraction of its radius. */
const SHARD_REACH = 0.85;

// steam
const PUFF_SEGMENTS = 10;
const PUFFS_PER_VENT = 5;
const PUFFS_PER_METRE_OF_RADIUS = 0.6;
const PUFF_RADIUS = 1.1;
const PUFF_GROWTH = 2.3;
const PUFF_STAGGER = 0.05;
const PUFF_COLOR = '#f2f4f7';
const PUFF_OPACITY = 0.32;
/** A plume lives this long after its vent starts a pulse, as a share of the pulse period, and its puffs rise this much higher than the lift column. */
const PUFF_LIFE = 0.8;
const PUFF_RISE = 1.15;

// lava bubbles
const BUBBLE_SEGMENTS = 10;
const BUBBLES_PER_METRE_OF_RADIUS = 1.5;
const BUBBLES_BASE = 2;
const BUBBLE_RADIUS_MIN = 0.25;
const BUBBLE_RADIUS_RANGE = 0.5;
const BUBBLE_RATE = 0.55;
const BUBBLE_COLOR = '#d9400a';
/** A bubble swells to full size and pops over its cycle; it is up only for this share of it. */
const BUBBLE_UP_SHARE = 0.7;
const BUBBLE_FLATTEN = 0.55;

type Hole = { x: number; z: number; y: number; radius: number; kind: number; seed: number; u: number; s: number };
type Prop = { x: number; y: number; z: number; size: number; phase: number; lean: number };

type Row = { shards: { shape: number; elements: number[] }[]; puffs: Prop[]; bubbles: Prop[] };
/** Rows of holes worked out per frame as they come into range. */
const ROWS_PER_UPDATE = 2;

export class HazardProps {
  readonly group = new THREE.Group();
  private readonly shards: THREE.InstancedMesh[] = [];
  private readonly shardCounts: number[] = new Array<number>(SHARD_SHAPES).fill(0);
  private readonly puffs: THREE.InstancedMesh;
  private readonly bubbles: THREE.InstancedMesh;
  private readonly puffProps: Prop[] = [];
  private readonly bubbleProps: Prop[] = [];
  private readonly rows = new Map<number, Row>();
  private row: Row = { shards: [], puffs: [], bubbles: [] };
  private rowsPerUpdate = Number.POSITIVE_INFINITY;
  private cellS = Number.NaN;
  private cellU = Number.NaN;
  private originZ = Number.NaN;
  private readonly disc = createHoleDisc();
  private readonly sample = createHazardSample();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly hole: Hole = { x: 0, z: 0, y: 0, radius: 0, kind: 0, seed: 0, u: 0, s: 0 };

  constructor() {
    const shardMaterial = new THREE.MeshStandardNodeMaterial({ color: SHARD_COLOR, roughness: SHARD_ROUGHNESS, metalness: 0 });
    shardMaterial.emissive.set(SHARD_COLOR).multiplyScalar(SHARD_GLOW);
    for (let shape = 0; shape < SHARD_SHAPES; shape++) this.shards.push(new THREE.InstancedMesh(createJaggedShard(shape), shardMaterial, MAX_SHARDS));
    const puffMaterial = new THREE.MeshBasicNodeMaterial({ color: PUFF_COLOR, transparent: true, opacity: PUFF_OPACITY, depthWrite: false });
    this.puffs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, PUFF_SEGMENTS, PUFF_SEGMENTS), puffMaterial, MAX_PUFFS);
    const bubbleMaterial = new THREE.MeshBasicNodeMaterial({ color: BUBBLE_COLOR });
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, BUBBLE_SEGMENTS, BUBBLE_SEGMENTS), bubbleMaterial, MAX_BUBBLES);
    for (const mesh of [...this.shards, this.puffs, this.bubbles]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  /** Rebuild the nearby holes if the jelly has moved to a new cell, then pose the moving parts for game time `clock`. */
  update(worldX: number, worldZ: number, originZ: number, clock: number) {
    const s = -worldZ;
    const cellS = holeCellIndex(s), cellU = holeCellIndex(worldX - courseCenter(s));
    void cellU;
    // Each row of holes is worked out once and kept (finding where its shards, vents and bubbles stand needs the ground's
    // height at each, which is the costly part); rows coming into range are worked out a couple a frame, nearest first.
    let dirty = originZ !== this.originZ;
    this.originZ = originZ;
    if (cellS !== this.cellS) {
      this.cellS = cellS;
      for (const j of this.rows.keys()) if (j < cellS - CELLS_BEHIND || j > cellS + CELLS_AHEAD) this.rows.delete(j);
      dirty = true;
    }
    let made = 0;
    for (let j = cellS - CELLS_BEHIND; j <= cellS + CELLS_AHEAD && made < this.rowsPerUpdate; j++) {
      if (this.rows.has(j)) continue;
      this.rows.set(j, this.buildRow(j));
      made++; dirty = true;
    }
    this.rowsPerUpdate = ROWS_PER_UPDATE;
    if (dirty) this.assemble(cellS, originZ);
    this.animate(originZ, clock);
  }

  /** Rebuild the props on the next update. */
  invalidate() {
    this.rows.clear();
    this.cellS = Number.NaN;
    // After a jump somewhere new everything is made at once: the world is being redrawn anyway.
    this.rowsPerUpdate = Number.POSITIVE_INFINITY;
  }

  dispose() {
    for (const mesh of [...this.shards, this.puffs, this.bubbles]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  /** Everything standing in the holes of one row of cells, in world coordinates. */
  private buildRow(j: number): Row {
    const { disc, hole } = this;
    const row: Row = { shards: [], puffs: [], bubbles: [] };
    this.row = row;
    // Holes sit in valley coordinates, so the cells across are counted from the valley's centre line at each distance.
    for (let i = -CELLS_ACROSS; i <= CELLS_ACROSS; i++) {
      if (!holeInCell(i, j, disc)) continue;
      const kind = disc.kind;
      if (kind !== ICE && kind !== SCREE && kind !== LAVA) continue;
      hole.s = disc.s; hole.u = disc.u; hole.radius = disc.radius; hole.kind = kind; hole.seed = disc.seed;
      hole.x = courseCenter(disc.s) + disc.u; hole.z = -disc.s;
      hole.y = terrainHeight(hole.x, hole.z);
      if (kind === ICE) this.placeShards(hole, 0, this.matrix, this.position, this.rotation, this.euler, this.scale);
      else if (kind === SCREE) this.placePuffs(hole);
      else this.placeBubbles(hole);
    }
    return row;
  }

  /** Lay the rows in range into the meshes. Shards are only drawn for the nearer rows. */
  private assemble(cellS: number, originZ: number) {
    this.shardCounts.fill(0);
    this.puffProps.length = 0;
    this.bubbleProps.length = 0;
    let shardCount = 0;
    const { matrix } = this;
    for (const [j, row] of this.rows) {
      if ((j - cellS) * HAZARD_CELL <= SHARD_AHEAD) {
        for (const shard of row.shards) {
          if (shardCount >= MAX_SHARDS) break;
          matrix.fromArray(shard.elements);
          matrix.elements[14] -= originZ;
          this.shards[shard.shape].setMatrixAt(this.shardCounts[shard.shape]++, matrix);
          shardCount++;
        }
      }
      for (const prop of row.puffs) if (this.puffProps.length < MAX_PUFFS) this.puffProps.push(prop);
      for (const prop of row.bubbles) if (this.bubbleProps.length < MAX_BUBBLES) this.bubbleProps.push(prop);
    }
    this.shards.forEach((mesh, shape) => { mesh.count = this.shardCounts[shape]; mesh.instanceMatrix.needsUpdate = true; });
  }

  /** A random spot inside the hole where the ground is properly in it; false if a few tries find none. */
  private spot(hole: Hole, index: number, salt: number, out: { x: number; z: number; y: number }): boolean {
    for (let attempt = 0; attempt < 3; attempt++) {
      const angle = hash2(index, attempt, SEED_PLACE_U + salt + Math.floor(hole.seed * 1e6)) * TAU;
      const distance = Math.sqrt(hash2(index, attempt, SEED_PLACE_S + salt + Math.floor(hole.seed * 1e6))) * hole.radius * SHARD_REACH;
      const u = hole.u + Math.cos(angle) * distance, s = hole.s + Math.sin(angle) * distance;
      const halfWidth = courseHalfWidth(s);
      if (hazardAt(u, s, halfWidth, this.sample) < PLACE_DEPTH) continue;
      out.x = courseCenter(s) + u; out.z = -s;
      // Liquids are only there where the ground is below the surface.
      if (holeEffectAt(out.x, out.z, this.sample) < PLACE_DEPTH) continue;
      // Lava bubbles break its flat surface, not the floor under it.
      out.y = isLiquidKind(this.sample.kind) ? holeLevel(this.sample) : terrainHeight(out.x, out.z);
      return true;
    }
    return false;
  }

  private readonly point = { x: 0, z: 0, y: 0 };

  private placeShards(hole: Hole, originZ: number, matrix: THREE.Matrix4, position: THREE.Vector3, rotation: THREE.Quaternion, euler: THREE.Euler, scale: THREE.Vector3) {
    const count = Math.round(SHARDS_BASE + SHARDS_PER_METRE_OF_RADIUS * hole.radius);
    for (let n = 0; n < count; n++) {
      if (!this.spot(hole, n, 0, this.point)) continue;
      const size = hash2(n, 1, SEED_SIZE + Math.floor(hole.seed * 1e6));
      const height = SHARD_HEIGHT_MIN + SHARD_HEIGHT_RANGE * size * size;
      euler.set((hash2(n, 2, SEED_LEAN) - 0.5) * 2 * SHARD_LEAN, hash2(n, 3, SEED_LEAN) * TAU, (hash2(n, 4, SEED_LEAN) - 0.5) * 2 * SHARD_LEAN);
      rotation.setFromEuler(euler);
      position.set(this.point.x, this.point.y - height * 0.08, this.point.z - originZ);
      scale.set(SHARD_WIDTH * (0.7 + 0.6 * size), height, SHARD_WIDTH * (0.7 + 0.6 * size));
      matrix.compose(position, rotation, scale);
      const shape = Math.floor(hash2(n, 5, SEED_LEAN + Math.floor(hole.seed * 1e6)) * SHARD_SHAPES);
      this.row.shards.push({ shape, elements: matrix.toArray() });
    }
  }

  private placePuffs(hole: Hole) {
    const vents = Math.max(1, Math.round(hole.radius * PUFFS_PER_METRE_OF_RADIUS / PUFFS_PER_VENT));
    for (let v = 0; v < vents; v++) {
      if (!this.spot(hole, v, 10, this.point)) continue;
      for (let n = 0; n < PUFFS_PER_VENT; n++) {
        this.row.puffs.push({ x: this.point.x, y: this.point.y, z: this.point.z, size: PUFF_RADIUS * (0.8 + 0.4 * hash2(v, n, SEED_SIZE)), phase: n * PUFF_STAGGER, lean: hash2(v, n, SEED_LEAN) - 0.5 });
      }
    }
  }

  private placeBubbles(hole: Hole) {
    const count = Math.round(BUBBLES_BASE + BUBBLES_PER_METRE_OF_RADIUS * hole.radius);
    for (let n = 0; n < count; n++) {
      if (!this.spot(hole, n, 20, this.point)) continue;
      const size = hash2(n, 5, SEED_SIZE + Math.floor(hole.seed * 1e6));
      this.row.bubbles.push({ x: this.point.x, y: this.point.y, z: this.point.z, size: BUBBLE_RADIUS_MIN + BUBBLE_RADIUS_RANGE * size, phase: hash2(n, 6, SEED_LEAN + Math.floor(hole.seed * 1e6)), lean: 0 });
    }
  }

  private animate(originZ: number, clock: number) {
    const { matrix, position, rotation, scale, puffs, bubbles } = this;
    rotation.identity();
    let count = 0;
    for (const prop of this.puffProps) {
      // The same pulse the vent's physics runs on, so a plume rises when the jelly would be thrown.
      const phase = clock * HAZARD_VENT_RATE + (-prop.z) * HAZARD_VENT_PHASE_PER_METRE;
      const age = (phase - Math.floor(phase) - prop.phase + 1) % 1;
      const life = age / PUFF_LIFE;
      if (life >= 1) continue;
      const rise = Math.min(1, age / HAZARD_VENT_DUTY);
      position.set(prop.x + prop.lean * life * 2, prop.y + rise * HAZARD_VENT_HEIGHT * PUFF_RISE * (0.4 + 0.6 * life), prop.z - originZ);
      scale.setScalar(prop.size * (0.4 + PUFF_GROWTH * life) * (1 - life * life));
      matrix.compose(position, rotation, scale);
      puffs.setMatrixAt(count++, matrix);
    }
    puffs.count = count;
    puffs.instanceMatrix.needsUpdate = true;
    count = 0;
    for (const prop of this.bubbleProps) {
      const cycle = clock * BUBBLE_RATE + prop.phase;
      const t = (cycle - Math.floor(cycle)) / BUBBLE_UP_SHARE;
      if (t >= 1) continue;
      // Swells quickly, holds, and is gone: a bubble breaking.
      const size = prop.size * Math.sin(Math.min(1, t) * Math.PI) ** 0.5;
      position.set(prop.x, prop.y, prop.z - originZ);
      scale.set(size, size * BUBBLE_FLATTEN, size);
      matrix.compose(position, rotation, scale);
      bubbles.setMatrixAt(count++, matrix);
    }
    bubbles.count = count;
    bubbles.instanceMatrix.needsUpdate = true;
  }
}
