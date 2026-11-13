/**
 * Draws the cave's stalagmites and stalactites: two instanced meshes of one rough stone spike, rebuilt from the hash when
 * the jelly moves to a new cell (or one is destroyed, or falls). The ones in motion are separate: a stalactite on its
 * way down, and a stalagmite the marble has hit, which is simply gone (the debris that bursts from it is the stalagmite breaking up; see rock-debris.ts).
 */
import * as THREE from 'three/webgpu';
import { valueNoise2 } from '../game/noise.ts';
import type { Ball } from '../game/physics.ts';
import { isRockBroken } from '../game/rocks.ts';
import { createSpike, spikeCellIndex, stalactiteInCell, stalagmiteInCell } from '../game/spikes.ts';
import { courseCenter } from '../game/terrain.ts';
import { MAX_FALLERS, RIDGE_DISTANCE, SPIKE_CELL, VALLEY_HALF_WIDTH, VALLEY_HALF_WIDTH_SWING, WORLD_SEED } from '../game/tuning.ts';

const AHEAD = 150;
const BEHIND = 18;
const CELLS_AHEAD = Math.ceil(AHEAD / SPIKE_CELL);
const CELLS_BEHIND = Math.ceil(BEHIND / SPIKE_CELL);
const CELLS_ACROSS = Math.ceil((VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING + RIDGE_DISTANCE) / SPIKE_CELL);
const MAX_SPIKES = 900;
/** The spike: a cone of this many sides and rings, roughened, a little bulged low down like dripstone. */
const SIDES = 9;
const RINGS = 7;
const ROUGHNESS_AMOUNT = 0.22;
const BULGE = 0.18;
const SEED_SHAPE = WORLD_SEED + 241;
const STONE_COLOR = '#5b5866';
/** A little light of its own, so it stands out of the dark as a shape. */
const STONE_GLOW = '#10131c';
const STONE_ROUGHNESS = 0.55;
const TAU = Math.PI * 2;
/** A knocked-over stalagmite: how long it takes to fall flat, then to sink away, and how many can be going at once. */
const UP = new THREE.Vector3(0, 1, 0);

/** A unit spike: base radius 1 at y = 0, tip at y = 1. */
function spikeGeometry() {
  const geometry = new THREE.ConeGeometry(1, 1, SIDES, RINGS, true);
  geometry.translate(0, 0.5, 0);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const angle = Math.atan2(z, x);
    const rough = 1 + ROUGHNESS_AMOUNT * (valueNoise2(angle * 1.9 + 7, y * 5, SEED_SHAPE) - 0.5) * 2 + BULGE * Math.sin(Math.PI * Math.min(1, y * 2.2)) * (1 - y);
    position.setXYZ(i, x * rough, y, z * rough);
  }
  geometry.computeVertexNormals();
  return geometry;
}


export class SpikeField {
  readonly group = new THREE.Group();
  private readonly standing: THREE.InstancedMesh;
  private readonly hanging: THREE.InstancedMesh;
  private readonly falling: THREE.Mesh[] = [];
  private readonly material = new THREE.MeshStandardNodeMaterial({ color: STONE_COLOR, roughness: STONE_ROUGHNESS, metalness: 0, side: THREE.DoubleSide });
  private readonly geometry = spikeGeometry();
  private readonly spike = createSpike();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  private readonly turn = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private cellX = Number.NaN;
  private cellZ = Number.NaN;
  private originZ = Number.NaN;
  private changes = -1;

  constructor() {
    this.material.emissive.set(STONE_GLOW);
    this.standing = new THREE.InstancedMesh(this.geometry, this.material, MAX_SPIKES);
    this.hanging = new THREE.InstancedMesh(this.geometry, this.material, MAX_SPIKES);
    for (const mesh of [this.standing, this.hanging]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
    for (let i = 0; i < MAX_FALLERS; i++) this.falling.push(this.single());
  }

  private single() {
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  update(ball: Ball, originZ: number, dt: number) {
    this.rebuildIfMoved(ball, originZ);
    // Stalactites on their way down: hung point up, tip at the faller's height.
    for (let i = 0; i < MAX_FALLERS; i++) {
      const faller = ball.fallers[i], mesh = this.falling[i];
      mesh.visible = faller.active;
      if (!faller.active) continue;
      mesh.position.set(faller.x, faller.tip + faller.length, faller.z - originZ);
      mesh.quaternion.copy(this.flip);
      mesh.scale.set(faller.radius, faller.length, faller.radius);
    }
  }

  private rebuildIfMoved(ball: Ball, originZ: number) {
    const cellX = spikeCellIndex(ball.x), cellZ = spikeCellIndex(ball.z);
    const changes = ball.toppledSpikes.total + ball.fallenSpikes.total;
    if (cellX === this.cellX && cellZ === this.cellZ && originZ === this.originZ && changes === this.changes) return;
    this.cellX = cellX; this.cellZ = cellZ; this.originZ = originZ; this.changes = changes;
    const { spike, matrix, position, quaternion, scale, turn } = this;
    let standing = 0, hanging = 0;
    // Forward is -Z, so "ahead" is toward lower cell indices.
    for (let z = cellZ - CELLS_AHEAD; z <= cellZ + CELLS_BEHIND; z++) {
      const rowCentre = spikeCellIndex(courseCenter(-(z + 0.5) * SPIKE_CELL));
      for (let x = rowCentre - CELLS_ACROSS; x <= rowCentre + CELLS_ACROSS; x++) {
        if (standing < MAX_SPIKES && stalagmiteInCell(x, z, spike) && !isRockBroken(ball.toppledSpikes, x, z)) {
          position.set(spike.x, spike.y - spike.radius * 0.15, spike.z - originZ);
          quaternion.setFromAxisAngle(UP, spike.look * TAU);
          scale.set(spike.radius, spike.length, spike.radius);
          this.standing.setMatrixAt(standing++, matrix.compose(position, quaternion, scale));
        }
        if (hanging < MAX_SPIKES && stalactiteInCell(x, z, spike) && !isRockBroken(ball.fallenSpikes, x, z)) {
          position.set(spike.x, spike.y + spike.tip + spike.length, spike.z - originZ);
          quaternion.copy(this.flip).multiply(turn.setFromAxisAngle(UP, spike.look * TAU));
          scale.set(spike.radius, spike.length, spike.radius);
          this.hanging.setMatrixAt(hanging++, matrix.compose(position, quaternion, scale));
        }
      }
    }
    this.standing.count = standing; this.hanging.count = hanging;
    this.standing.instanceMatrix.needsUpdate = true; this.hanging.instanceMatrix.needsUpdate = true;
  }

  invalidate() {
    this.cellX = Number.NaN;
  }

  reset() {
    this.invalidate();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
