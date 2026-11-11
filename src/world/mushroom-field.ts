/**
 * Draws the collectibles near the player. Each biome grows its own kind:
 * snowballs on the ice, jelly mushrooms in the meadow, cacti in the dunes,
 * crystals in the scree, embers on the lava. A kind is one instanced mesh
 * with its own shape and finish; every instance carries its colours, look and
 * size as attributes, so one material per kind draws all its variety.
 *
 * Collectibles the jelly has touched are not simply removed: each stays in
 * the batch as a merge in progress, flying in, pressing against the jelly,
 * then sinking into it as it shrinks (see game/merge-timeline.ts). The jelly
 * mesh draws the other half of the blend.
 */
import * as THREE from 'three/webgpu';
import { attribute, cos, instancedDynamicBufferAttribute, mix, positionGeometry, positionLocal, sin, time, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIOME_COUNT, DUNES, ICE, LAVA, MEADOW, SCREE } from '../game/biomes.ts';
import { createMushroom, isMushroomTaken, mushroomCellIndex, mushroomInCell, type MushroomLedger } from '../game/mushrooms.ts';
import { smoothstep, valueNoise2 } from '../game/noise.ts';
import type { Merges } from '../game/merges.ts';
import { sproutScale, type SeedField } from '../game/seeds.ts';
import { courseCenter } from '../game/terrain.ts';
import {
  MAX_MERGES, MAX_PLANTED, MERGE_SQUASH, MUSHROOM_CELL, MUSHROOM_EDGE_MARGIN, MUSHROOM_REST_HEIGHT, VALLEY_HALF_WIDTH, VALLEY_HALF_WIDTH_SWING,
  WORLD_SEED,
} from '../game/tuning.ts';
import { sweetColor } from '../render/colors.ts';
import { lookShading } from '../render/jelly-looks.ts';
import { createJellyMaterial, type JellyOptions } from '../render/jelly-material.ts';

// --- Shapes ---------------------------------------------------------------------
// The physics treats every collectible as a sphere of radius 1 centred on the
// origin of its shape, resting with its base MUSHROOM_REST_HEIGHT radii below
// that centre. A `part` attribute marks what takes the instance's colours and
// look (1) and what keeps the kind's fixed trim colour (0).

const SEED_LUMPS = WORLD_SEED + 51;
const LUMP_DETAIL = 3;

/** A sphere pushed in and out by low-frequency noise: a packed snowball, a blob of ember. */
function lumpGeometry(frequency: number, amplitude: number, seed: number) {
  const sphere = new THREE.IcosahedronGeometry(1, LUMP_DETAIL);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geometry = mergeVertices(sphere);
  sphere.dispose();
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    // Three planar noise slices stand in for 3D noise on the unit sphere.
    const lump = (
      valueNoise2(vertex.x * frequency, vertex.y * frequency, seed) +
      valueNoise2(vertex.y * frequency, vertex.z * frequency, seed + 1) +
      valueNoise2(vertex.z * frequency, vertex.x * frequency, seed + 2)
    ) / 3;
    vertex.multiplyScalar(1 + amplitude * lump);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return withPart(geometry, 1);
}

/** Tags a whole geometry as coloured (1) or trim (0), and drops attributes the merge would trip on. */
function withPart(geometry: THREE.BufferGeometry, part: number) {
  geometry.deleteAttribute('uv');
  geometry.setAttribute('part', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(part), 1));
  return geometry;
}

/** Mushroom: a surface of revolution. Each point is [radius, height, isCap]. */
const MUSHROOM_STEM: readonly (readonly [number, number, number])[] = [
  [0, -MUSHROOM_REST_HEIGHT, 0], [0.34, -MUSHROOM_REST_HEIGHT, 0], [0.27, -0.62, 0], [0.22, -0.25, 0], [0.24, -0.02, 0],
  [0.62, -0.03, 0], [0.9, -0.07, 0], [1, 0, 1],
];
const MUSHROOM_CAP_BASE = 0.05;
const MUSHROOM_CAP_HEIGHT = 0.85;
const MUSHROOM_DOME_STEPS = 9;
const LATHE_SEGMENTS = 22;

function mushroomGeometry() {
  const profile = MUSHROOM_STEM.map(point => [...point]);
  for (let step = 1; step <= MUSHROOM_DOME_STEPS; step++) {
    const angle = (step / MUSHROOM_DOME_STEPS) * (Math.PI / 2);
    profile.push([Math.cos(angle), MUSHROOM_CAP_BASE + MUSHROOM_CAP_HEIGHT * Math.sin(angle), 1]);
  }
  const geometry = new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), LATHE_SEGMENTS);
  geometry.deleteAttribute('uv');
  // Lathe vertices are laid out ring by ring in profile order.
  const part = new Float32Array(geometry.attributes.position.count);
  for (let i = 0; i < part.length; i++) part[i] = profile[i % profile.length][2];
  geometry.setAttribute('part', new THREE.BufferAttribute(part, 1));
  return geometry;
}

/** Barrel cactus: a ribbed, slightly tall ball with a little flower on top. */
const CACTUS_RIBS = 9;
const CACTUS_RIB_DEPTH = 0.1;
const CACTUS_HEIGHT = 1.05;
const CACTUS_SEGMENTS = 36;
const CACTUS_RINGS = 18;
const FLOWER_RADIUS = 0.26;
const FLOWER_SEGMENTS = 10;

function cactusGeometry() {
  const body = new THREE.SphereGeometry(1, CACTUS_SEGMENTS, CACTUS_RINGS);
  const position = body.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const rib = 1 - CACTUS_RIB_DEPTH * (0.5 - 0.5 * Math.cos(Math.atan2(z, x) * CACTUS_RIBS));
    position.setXYZ(i, x * rib, y * CACTUS_HEIGHT, z * rib);
  }
  body.computeVertexNormals();
  const flower = new THREE.SphereGeometry(FLOWER_RADIUS, FLOWER_SEGMENTS, FLOWER_SEGMENTS);
  flower.translate(0, CACTUS_HEIGHT, 0);
  return mergeGeometries([withPart(body, 1), withPart(flower, 0)]);
}

/** Crystal: a cluster of six-sided shards, each [x, z, lean about x, lean about z, radius, length]. */
const CRYSTAL_SHARDS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 0.05, -0.04, 0.42, 1.25],
  [0.36, 0.1, 0.1, -0.5, 0.27, 0.85],
  [-0.3, 0.2, 0.3, 0.45, 0.24, 0.75],
  [-0.05, -0.36, -0.5, 0.05, 0.22, 0.7],
];
const CRYSTAL_SIDES = 6;
const CRYSTAL_TIP = 0.42;
const CRYSTAL_TAPER = 0.82;

function crystalGeometry() {
  const shards: THREE.BufferGeometry[] = [];
  for (const [x, z, leanX, leanZ, radius, length] of CRYSTAL_SHARDS) {
    const shaft = new THREE.CylinderGeometry(radius * CRYSTAL_TAPER, radius, length, CRYSTAL_SIDES);
    shaft.translate(0, length / 2, 0);
    const tip = new THREE.ConeGeometry(radius * CRYSTAL_TAPER, length * CRYSTAL_TIP, CRYSTAL_SIDES);
    tip.translate(0, length + (length * CRYSTAL_TIP) / 2, 0);
    for (const piece of [shaft, tip]) {
      piece.rotateX(leanX); piece.rotateZ(leanZ);
      piece.translate(x, -MUSHROOM_REST_HEIGHT, z);
      // Unshared vertices, so the flat-shaded facets stay crisp.
      shards.push(withPart(piece.toNonIndexed(), 1));
    }
  }
  const geometry = mergeGeometries(shards);
  geometry.computeVertexNormals();
  return geometry;
}

// --- Kinds ----------------------------------------------------------------------

type KindLook = {
  geometry: () => THREE.BufferGeometry;
  /** Colour of the parts that do not take the instance's colours (stem, flower). */
  trimTint: string;
  trimDeep: string;
  finish: JellyOptions;
  /** Self-light in the instance's own colour, and how much of it pulses. */
  glow: number;
  /** Idle squash-and-stretch depth; rigid things do not wobble. */
  breath: number;
  bothSides: boolean;
};

const KINDS: KindLook[] = [];
KINDS[ICE] = {
  geometry: () => lumpGeometry(1.6, 0.1, SEED_LUMPS), trimTint: '#ffffff', trimDeep: '#dcefff',
  finish: { transmission: 0.12, roughness: 0.55 }, glow: 0, breath: 0, bothSides: false,
};
KINDS[MEADOW] = {
  geometry: mushroomGeometry, trimTint: '#fff6e0', trimDeep: '#f3dfb4',
  finish: {}, glow: 0, breath: 0.07, bothSides: true,
};
KINDS[DUNES] = {
  geometry: cactusGeometry, trimTint: '#ff86bd', trimDeep: '#ff4f9a',
  finish: { transmission: 0.35, roughness: 0.3 }, glow: 0, breath: 0.04, bothSides: false,
};
KINDS[SCREE] = {
  geometry: crystalGeometry, trimTint: '#ffffff', trimDeep: '#e6ecff',
  finish: { transmission: 0.85, roughness: 0.03, flatShading: true }, glow: 0.12, breath: 0, bothSides: false,
};
KINDS[LAVA] = {
  geometry: () => lumpGeometry(1.15, 0.22, SEED_LUMPS + 10), trimTint: '#ffd23a', trimDeep: '#ff6a00',
  finish: { transmission: 0.3, roughness: 0.25 }, glow: 1.5, breath: 0.09, bothSides: false,
};

// --- Field ----------------------------------------------------------------------
/** Collectibles are drawn this far ahead, growing in from nothing over the last stretch. */
const VIEW_AHEAD = 220;
const GROW_IN_FROM = 0.72;
const CELLS_AHEAD = Math.ceil(VIEW_AHEAD / MUSHROOM_CELL);
const CELLS_BEHIND = 4;
const CELLS_ACROSS = Math.ceil((VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING - MUSHROOM_EDGE_MARGIN) / MUSHROOM_CELL) + 1;
/** Instances per kind. Only two kinds are ever in view at once, so this is roomy. */
const MAX_PER_KIND = 1536;
/** Each one is a little squatter or taller than the next. */
const HEIGHT_SCALE_MIN = 0.85;
const HEIGHT_SCALE_RANGE = 0.35;
const BREATH_RATE = 3.2;
const GLOW_PULSE = 0.35;
const GLOW_PULSE_RATE = 5;
const TAU = Math.PI * 2;
const VEC4 = 4;
/** Multipliers that turn one seed into unrelated-looking pattern turn and height values. */
const PATTERN_TURNS = 7;
const HEIGHT_HASH = 13;

// --- Merges: collectibles on their way into the jelly ----------------------------------
/** Instances kept free at the end of each batch for merges in progress and sprouted seeds. */
const MAX_STANDING = MAX_PER_KIND - MAX_MERGES - MAX_PLANTED;
const UP = new THREE.Vector3(0, 1, 0);

/** One kind's instanced mesh and the per-instance data that goes with it. */
class Batch {
  readonly mesh: THREE.InstancedMesh;
  /** Per instance: deep colour + look id, pattern colour + seed, tint + radius. */
  readonly deepLook = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_KIND * VEC4), VEC4);
  readonly deep2Seed = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_KIND * VEC4), VEC4);
  readonly tintRadius = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_KIND * VEC4), VEC4);
  /** Standing instances occupy the front of the list; slurps follow. */
  standing = 0;
  count = 0;
  dirty = false;
  private readonly kind: number;

  constructor(kind: number) {
    this.kind = kind;
    const look = KINDS[kind];
    const deepLook = instancedDynamicBufferAttribute(this.deepLook, 'vec4');
    const deep2Seed = instancedDynamicBufferAttribute(this.deep2Seed, 'vec4');
    const tintRadius = instancedDynamicBufferAttribute(this.tintRadius, 'vec4');
    const seed = deep2Seed.w as unknown as Node<'float'>;
    // By the time material nodes run, Three has already applied the instance
    // matrix to positionLocal, so the shape's own coordinates come from the
    // raw geometry (roughly unit radius, i.e. already "in radii"). Each
    // pattern is turned about the vertical by its seed so no two line up.
    const turn = seed.mul(TAU * PATTERN_TURNS);
    const own = positionGeometry;
    const q = vec3(
      own.x.mul(cos(turn)).add(own.z.mul(sin(turn))), own.y, own.z.mul(cos(turn)).sub(own.x.mul(sin(turn))),
    );
    const shading = lookShading(
      q as unknown as Node<'vec3'>, deepLook.w as unknown as Node<'float'>,
      deepLook.xyz as unknown as Node<'vec3'>, deep2Seed.xyz as unknown as Node<'vec3'>, seed,
    );
    const part = attribute('part', 'float');
    const trimTint = new THREE.Color(look.trimTint), trimDeep = new THREE.Color(look.trimDeep);
    const pulse = sin(time.mul(GLOW_PULSE_RATE).add(seed.mul(TAU))).mul(GLOW_PULSE).add(1 - GLOW_PULSE);
    const material = createJellyMaterial({
      radius: tintRadius.w as unknown as Node<'float'>,
      tint: mix(vec3(trimTint.r, trimTint.g, trimTint.b), tintRadius.xyz, part) as unknown as Node<'vec3'>,
      attenuation: mix(vec3(trimDeep.r, trimDeep.g, trimDeep.b), shading.attenuation, part) as unknown as Node<'vec3'>,
      bit: shading.bit.mul(part) as unknown as Node<'float'>,
      bitColor: shading.bitColor,
      glow: shading.glow.mul(part).add(shading.attenuation.mul(part).mul(pulse).mul(look.glow)) as unknown as Node<'vec3'>,
    }, look.finish);
    if (look.bothSides) material.side = THREE.DoubleSide;
    if (look.breath > 0) {
      // Idle wobble on each one's own phase, volume roughly kept. Added as an
      // offset in the shape's own axes (instances are not rotated), because
      // scaling the already-instanced position would fling it about. Height is
      // measured from the base so the foot stays planted.
      const breath = sin(time.mul(BREATH_RATE).add(seed.mul(TAU))).mul(look.breath);
      const stretch = vec3(breath.negate(), breath.mul(2), breath.negate());
      const fromBase = vec3(own.x, own.y.add(MUSHROOM_REST_HEIGHT), own.z);
      material.positionNode = positionLocal.add(fromBase.mul(stretch).mul(tintRadius.w));
    }
    this.mesh = new THREE.InstancedMesh(look.geometry(), material, MAX_PER_KIND);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    // Instances are spread along hundreds of metres; one item's bounds would cull them all.
    this.mesh.frustumCulled = false;
  }

  write(index: number, matrix: THREE.Matrix4, look: number, color: number, color2: number, seed: number, size: number) {
    this.mesh.setMatrixAt(index, matrix);
    const deepLook = this.deepLook.array as Float32Array;
    const deep2Seed = this.deep2Seed.array as Float32Array;
    const tintRadius = this.tintRadius.array as Float32Array;
    const sweet = sweetColor(this.kind, color), sweet2 = sweetColor(this.kind, color2);
    const o = index * VEC4;
    deepLook[o] = sweet.deep.r; deepLook[o + 1] = sweet.deep.g; deepLook[o + 2] = sweet.deep.b; deepLook[o + 3] = look;
    deep2Seed[o] = sweet2.deep.r; deep2Seed[o + 1] = sweet2.deep.g; deep2Seed[o + 2] = sweet2.deep.b; deep2Seed[o + 3] = seed;
    tintRadius[o] = sweet.tint.r; tintRadius[o + 1] = sweet.tint.g; tintRadius[o + 2] = sweet.tint.b; tintRadius[o + 3] = size;
  }

  /** Upload if anything changed since the last frame. */
  commit() {
    if (!this.dirty && this.mesh.count === this.count) return;
    this.dirty = false;
    this.mesh.count = this.count;
    // A kind with nothing in view is not drawn at all.
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.deepLook.needsUpdate = true; this.deep2Seed.needsUpdate = true; this.tintRadius.needsUpdate = true;
  }
}

export class MushroomField {
  readonly group = new THREE.Group();
  private readonly batches: Batch[] = [];
  private readonly mushroom = createMushroom();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  /** Turns a mushroom's cap toward the jelly as it merges (separate from `rotation`, which stays identity). */
  private readonly facing = new THREE.Quaternion();
  private readonly mergeRotation = new THREE.Quaternion();
  private readonly toward = new THREE.Vector3();
  private cellX = Number.NaN;
  private cellZ = Number.NaN;
  private originZ = Number.NaN;
  private taken = -1;

  constructor() {
    for (let kind = 0; kind < BIOME_COUNT; kind++) {
      const batch = new Batch(kind);
      this.batches.push(batch);
      this.group.add(batch.mesh);
    }
  }

  /**
   * Draw one of every kind, wherever it happens to be, so each kind's shader is
   * compiled behind the loading card. Call the returned function afterwards.
   */
  warmKinds() {
    for (const batch of this.batches) { batch.mesh.visible = true; batch.mesh.count = Math.max(1, batch.mesh.count); }
    return () => { for (const batch of this.batches) { batch.mesh.count = batch.count; batch.mesh.visible = batch.count > 0; } };
  }

  /** Number of collectibles currently drawn, of every kind. */
  get drawn() {
    let total = 0;
    for (const batch of this.batches) total += batch.count;
    return total;
  }

  /** Rebuild the standing lists when the jelly enters a new cell, merges something, or the origin hops. */
  /** Rebuild the collectibles on the next update. */
  invalidate() {
    this.cellX = Number.NaN;
  }

  update(worldX: number, worldZ: number, originZ: number, ledger: MushroomLedger) {
    const cellX = mushroomCellIndex(worldX), cellZ = mushroomCellIndex(worldZ);
    if (cellX === this.cellX && cellZ === this.cellZ && originZ === this.originZ && ledger.total === this.taken) return;
    this.cellX = cellX; this.cellZ = cellZ; this.originZ = originZ; this.taken = ledger.total;
    const { mushroom, matrix, position, rotation, scale } = this;
    for (const batch of this.batches) { batch.standing = 0; batch.dirty = true; }
    // Forward is -Z, so "ahead" is toward lower cell indices.
    for (let z = cellZ - CELLS_AHEAD; z <= cellZ + CELLS_BEHIND; z++) {
      const rowCentre = mushroomCellIndex(courseCenter(-(z + 0.5) * MUSHROOM_CELL));
      for (let x = rowCentre - CELLS_ACROSS; x <= rowCentre + CELLS_ACROSS; x++) {
        if (!mushroomInCell(x, z, mushroom) || isMushroomTaken(ledger, x, z)) continue;
        const batch = this.batches[mushroom.kind];
        if (batch.standing === MAX_STANDING) continue;
        const ahead = worldZ - mushroom.z;
        const size = mushroom.radius * (1 - smoothstep(VIEW_AHEAD * GROW_IN_FROM, VIEW_AHEAD, ahead));
        position.set(mushroom.x, mushroom.y, mushroom.z - originZ);
        const tall = HEIGHT_SCALE_MIN + HEIGHT_SCALE_RANGE * ((mushroom.seed * HEIGHT_HASH) % 1);
        scale.set(size, size * tall, size);
        matrix.compose(position, rotation, scale);
        batch.write(batch.standing++, matrix, mushroom.look, mushroom.color, mushroom.color2, mushroom.seed, size);
      }
    }
  }

  /**
   * Draw every merge in progress, relative to the jelly's centre in render space,
   * and upload whatever changed. Call once a frame, after update().
   */
  animate(merges: Merges, center: THREE.Vector3, seeds: SeedField, originZ: number) {
    const { matrix, position, scale } = this;
    for (const batch of this.batches) batch.count = batch.standing;
    // Collectibles grown from seeds: they pop up at the spot the seed landed.
    for (const planted of seeds.items) {
      if (!planted.alive) continue;
      const grown = sproutScale(planted);
      if (grown <= 0) continue;
      const batch = this.batches[planted.kind];
      if (batch.count >= MAX_PER_KIND) continue;
      const size = planted.radius * grown;
      const tall = HEIGHT_SCALE_MIN + HEIGHT_SCALE_RANGE * ((planted.seed * HEIGHT_HASH) % 1);
      position.set(planted.x, planted.y, planted.z - originZ);
      scale.set(size, size * tall, size);
      matrix.compose(position, this.rotation, scale);
      batch.write(batch.count++, matrix, planted.look, planted.color, planted.color2, planted.seed, size);
      batch.dirty = true;
    }
    for (const merge of merges.items) {
      if (!merge.active || merge.shape.size <= 0) continue;
      const shape = merge.shape;
      position.set(center.x + merge.dirX * shape.distance, center.y + merge.dirY * shape.distance, center.z + merge.dirZ * shape.distance);
      // Cap first: it turns to face the jelly, so the squash and the sinking are along its own axis.
      this.toward.set(-merge.dirX, -merge.dirY, -merge.dirZ);
      this.facing.setFromUnitVectors(UP, this.toward);
      this.mergeRotation.identity().slerp(this.facing, shape.tilt);
      const tall = HEIGHT_SCALE_MIN + HEIGHT_SCALE_RANGE * ((merge.seed * HEIGHT_HASH) % 1);
      // Pressed flat along its axis and fatter across, volume kept.
      const flat = 1 - MERGE_SQUASH * shape.squash;
      const wide = shape.size / Math.sqrt(flat);
      scale.set(wide, shape.size * tall * flat, wide);
      matrix.compose(position, this.mergeRotation, scale);
      const batch = this.batches[merge.kind];
      if (batch.count >= MAX_PER_KIND) continue;
      batch.write(batch.count++, matrix, merge.look, merge.color, merge.color2, merge.seed, shape.size);
      batch.dirty = true;
    }
    for (const batch of this.batches) batch.commit();
  }

  dispose() {
    for (const batch of this.batches) {
      batch.mesh.geometry.dispose();
      (batch.mesh.material as THREE.Material).dispose();
    }
  }
}
