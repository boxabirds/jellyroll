/**
 * Draws the little jelly mushrooms near the player as one instanced,
 * translucent mesh. Each instance carries its colours, look and size as
 * attributes, so the whole jar (stripes, swirls, chips, glitter...) is a
 * single material. Mushrooms the jelly has just touched are not simply removed:
 * for a moment they are drawn again as "slurps", stretched and pulled in.
 */
import * as THREE from 'three/webgpu';
import { attribute, cos, instancedDynamicBufferAttribute, mix, positionGeometry, positionLocal, sin, time, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { createMushroom, isMushroomTaken, mushroomCellIndex, mushroomInCell, type MushroomLedger } from '../game/mushrooms.ts';
import { smoothstep } from '../game/noise.ts';
import type { Ball, Pickup } from '../game/physics.ts';
import { courseCenter } from '../game/terrain.ts';
import {
  MUSHROOM_CELL, MUSHROOM_EDGE_MARGIN, MUSHROOM_REST_HEIGHT, MUSHROOM_TOUCH, VALLEY_HALF_WIDTH, VALLEY_HALF_WIDTH_SWING,
} from '../game/tuning.ts';
import { SWEETS } from '../render/colors.ts';
import { lookShading } from '../render/jelly-looks.ts';
import { createJellyMaterial } from '../render/jelly-material.ts';

// --- Shape --------------------------------------------------------------------
/**
 * A mushroom is a surface of revolution. The physics treats each one as a
 * sphere of radius 1 centred on the origin of this shape, resting with its
 * base MUSHROOM_REST_HEIGHT radii below that centre.
 * Each point is [radius, height, isCap]: the cap takes the sweet's colour and
 * look; the stem and the underside stay cream.
 */
const STEM_PROFILE: readonly (readonly [number, number, number])[] = [
  [0, -MUSHROOM_REST_HEIGHT, 0], [0.34, -MUSHROOM_REST_HEIGHT, 0], [0.27, -0.62, 0], [0.22, -0.25, 0], [0.24, -0.02, 0],
  [0.62, -0.03, 0], [0.9, -0.07, 0], [1, 0, 1],
];
/** The cap is a quarter-ellipse dome starting this high and rising this much. */
const CAP_BASE = 0.05;
const CAP_HEIGHT = 0.85;
const DOME_STEPS = 9;
const LATHE_SEGMENTS = 22;
/** Stem and gills: a pale cream jelly. */
const STEM_TINT = new THREE.Color('#fff6e0');
const STEM_DEEP = new THREE.Color('#f3dfb4');

// --- Field --------------------------------------------------------------------
/** Mushrooms are drawn this far ahead, growing in from nothing over the last stretch. */
const VIEW_AHEAD = 220;
const GROW_IN_FROM = 0.72;
const CELLS_AHEAD = Math.ceil(VIEW_AHEAD / MUSHROOM_CELL);
const CELLS_BEHIND = 4;
const CELLS_ACROSS = Math.ceil((VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING - MUSHROOM_EDGE_MARGIN) / MUSHROOM_CELL) + 1;
const MAX_MUSHROOMS = 2048;
/** Each mushroom is a little squatter or taller than the next. */
const HEIGHT_SCALE_MIN = 0.85;
const HEIGHT_SCALE_RANGE = 0.35;
/** Idle wobble: squash-and-stretch depth and speed (rad/s). */
const BREATH_DEPTH = 0.07;
const BREATH_RATE = 3.2;
const TAU = Math.PI * 2;
const VEC4 = 4;
/** Multipliers that turn one seed into unrelated-looking pattern turn and height values. */
const PATTERN_TURNS = 7;
const HEIGHT_HASH = 13;

// --- Slurps: mushrooms on their way into the jelly --------------------------------
const MAX_SLURPS = 16;
const MAX_STANDING = MAX_MUSHROOMS - MAX_SLURPS;
export const SLURP_SECONDS = 0.3;
/** At the height of the slurp the mushroom is this much taller and thinner. */
const SLURP_STRETCH = 0.7;
const SLURP_PINCH = 0.35;
/** Fraction of its size the mushroom has lost by the time it reaches the jelly. */
const SLURP_SHRINK = 0.75;

function createMushroomGeometry() {
  const profile = STEM_PROFILE.map(point => [...point]);
  for (let step = 1; step <= DOME_STEPS; step++) {
    const angle = (step / DOME_STEPS) * (Math.PI / 2);
    profile.push([Math.cos(angle), CAP_BASE + CAP_HEIGHT * Math.sin(angle), 1]);
  }
  const geometry = new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), LATHE_SEGMENTS);
  // Lathe vertices are laid out ring by ring in profile order.
  const cap = new Float32Array(geometry.attributes.position.count);
  for (let i = 0; i < cap.length; i++) cap[i] = profile[i % profile.length][2];
  geometry.setAttribute('cap', new THREE.BufferAttribute(cap, 1));
  return geometry;
}

export class MushroomField {
  readonly mesh: THREE.InstancedMesh;
  private readonly mushroom = createMushroom();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  /** Per instance: deep colour + look id, pattern colour + seed, tint + radius. */
  private readonly deepLook = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MUSHROOMS * VEC4), VEC4);
  private readonly deep2Seed = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MUSHROOMS * VEC4), VEC4);
  private readonly tintRadius = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MUSHROOMS * VEC4), VEC4);
  private readonly slurps = Array.from({ length: MAX_SLURPS }, () => ({
    x: 0, y: 0, z: 0, radius: 0, look: 0, color: 0, color2: 0, seed: 0, age: SLURP_SECONDS,
  }));
  private nextSlurp = 0;
  /** Standing mushrooms occupy the front of the instance list; slurps follow. */
  private standing = 0;
  private dirty = false;
  private cellX = Number.NaN;
  private cellZ = Number.NaN;
  private originZ = Number.NaN;
  private taken = -1;

  constructor() {
    const deepLook = instancedDynamicBufferAttribute(this.deepLook, 'vec4');
    const deep2Seed = instancedDynamicBufferAttribute(this.deep2Seed, 'vec4');
    const tintRadius = instancedDynamicBufferAttribute(this.tintRadius, 'vec4');
    const seed = deep2Seed.w as unknown as Node<'float'>;
    // By the time material nodes run, Three has already applied the instance
    // matrix to positionLocal, so the mushroom's own coordinates come from the
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
    // Only the cap wears the sweet's colours; stem and gills are cream.
    const cap = attribute('cap', 'float');
    const material = createJellyMaterial({
      radius: tintRadius.w as unknown as Node<'float'>,
      tint: mix(vec3(STEM_TINT.r, STEM_TINT.g, STEM_TINT.b), tintRadius.xyz, cap) as unknown as Node<'vec3'>,
      attenuation: mix(vec3(STEM_DEEP.r, STEM_DEEP.g, STEM_DEEP.b), shading.attenuation, cap) as unknown as Node<'vec3'>,
      bit: shading.bit.mul(cap) as unknown as Node<'float'>,
      bitColor: shading.bitColor,
      glow: shading.glow.mul(cap) as unknown as Node<'vec3'>,
    });
    // Both faces are drawn so the gills show under the cap.
    material.side = THREE.DoubleSide;
    // Idle wobble: each mushroom bobs on its own phase, volume roughly kept.
    // Added as an offset in the mushroom's own axes (instances are not
    // rotated), because scaling the already-instanced position would fling it about.
    const breath = sin(time.mul(BREATH_RATE).add(seed.mul(TAU))).mul(BREATH_DEPTH);
    const stretch = vec3(breath.negate(), breath.mul(2), breath.negate());
    // Height is measured from the base so the foot stays planted while the cap bobs.
    const fromBase = vec3(own.x, own.y.add(MUSHROOM_REST_HEIGHT), own.z);
    material.positionNode = positionLocal.add(fromBase.mul(stretch).mul(tintRadius.w));
    this.mesh = new THREE.InstancedMesh(createMushroomGeometry(), material, MAX_MUSHROOMS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    // Instances are spread along hundreds of metres; one mushroom's bounds would cull them all.
    this.mesh.frustumCulled = false;
  }

  /** Rebuild the standing list when the jelly enters a new cell, merges a mushroom, or the origin hops. */
  update(worldX: number, worldZ: number, originZ: number, ledger: MushroomLedger) {
    const cellX = mushroomCellIndex(worldX), cellZ = mushroomCellIndex(worldZ);
    if (cellX === this.cellX && cellZ === this.cellZ && originZ === this.originZ && ledger.total === this.taken) return;
    this.cellX = cellX; this.cellZ = cellZ; this.originZ = originZ; this.taken = ledger.total;
    const { mushroom, matrix, position, rotation, scale, mesh } = this;
    let count = 0;
    // Forward is -Z, so "ahead" is toward lower cell indices.
    for (let z = cellZ - CELLS_AHEAD; z <= cellZ + CELLS_BEHIND && count < MAX_STANDING; z++) {
      const rowCentre = mushroomCellIndex(courseCenter(-(z + 0.5) * MUSHROOM_CELL));
      for (let x = rowCentre - CELLS_ACROSS; x <= rowCentre + CELLS_ACROSS && count < MAX_STANDING; x++) {
        if (!mushroomInCell(x, z, mushroom) || isMushroomTaken(ledger, x, z)) continue;
        const ahead = worldZ - mushroom.z;
        const size = mushroom.radius * (1 - smoothstep(VIEW_AHEAD * GROW_IN_FROM, VIEW_AHEAD, ahead));
        position.set(mushroom.x, mushroom.y, mushroom.z - originZ);
        const tall = HEIGHT_SCALE_MIN + HEIGHT_SCALE_RANGE * ((mushroom.seed * HEIGHT_HASH) % 1);
        scale.set(size, size * tall, size);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(count, matrix);
        this.writeLook(count, mushroom.look, mushroom.color, mushroom.color2, mushroom.seed, size);
        count++;
      }
    }
    this.standing = count;
    this.dirty = true;
  }

  /** Start sucking a just-merged mushroom into the jelly. */
  slurp(pickup: Pickup, ball: Ball) {
    const slurp = this.slurps[this.nextSlurp];
    this.nextSlurp = (this.nextSlurp + 1) % MAX_SLURPS;
    const reach = ball.radius + pickup.radius * MUSHROOM_TOUCH;
    slurp.x = ball.x + pickup.dx * reach; slurp.y = ball.y + pickup.dy * reach; slurp.z = ball.z + pickup.dz * reach;
    slurp.radius = pickup.radius; slurp.look = pickup.look; slurp.color = pickup.color; slurp.color2 = pickup.color2;
    slurp.seed = pickup.seed; slurp.age = 0;
  }

  /** Advance the slurps and upload whatever changed. Call once a frame, after update(). */
  animate(ball: Ball, originZ: number, dt: number) {
    const { matrix, position, rotation, scale, mesh } = this;
    let count = this.standing;
    for (const slurp of this.slurps) {
      if (slurp.age >= SLURP_SECONDS) continue;
      slurp.age += dt;
      const t = Math.min(1, slurp.age / SLURP_SECONDS);
      // Slow to start, then snatched in: the pull accelerates.
      const pull = t * t;
      const arc = Math.sin(Math.PI * t);
      position.set(
        slurp.x + (ball.x - slurp.x) * pull, slurp.y + (ball.y - slurp.y) * pull, slurp.z + (ball.z - slurp.z) * pull - originZ,
      );
      const size = slurp.radius * (1 - SLURP_SHRINK * pull);
      const wide = size * (1 - SLURP_PINCH * arc);
      scale.set(wide, size * (1 + SLURP_STRETCH * arc), wide);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(count, matrix);
      this.writeLook(count, slurp.look, slurp.color, slurp.color2, slurp.seed, size);
      count++;
      // The slot must be cleared on the frame after its last one, too.
      this.dirty = true;
    }
    if (!this.dirty && mesh.count === count) return;
    this.dirty = false;
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    this.deepLook.needsUpdate = true; this.deep2Seed.needsUpdate = true; this.tintRadius.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  private writeLook(index: number, look: number, color: number, color2: number, seed: number, size: number) {
    const deepLook = this.deepLook.array as Float32Array;
    const deep2Seed = this.deep2Seed.array as Float32Array;
    const tintRadius = this.tintRadius.array as Float32Array;
    const sweet = SWEETS[color], sweet2 = SWEETS[color2];
    const o = index * VEC4;
    deepLook[o] = sweet.deep.r; deepLook[o + 1] = sweet.deep.g; deepLook[o + 2] = sweet.deep.b; deepLook[o + 3] = look;
    deep2Seed[o] = sweet2.deep.r; deep2Seed[o + 1] = sweet2.deep.g; deep2Seed[o + 2] = sweet2.deep.b; deep2Seed[o + 3] = seed;
    tintRadius[o] = sweet.tint.r; tintRadius[o + 1] = sweet.tint.g; tintRadius[o + 2] = sweet.tint.b; tintRadius[o + 3] = size;
  }
}
