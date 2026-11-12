/**
 * Draws the rocks near the jelly as one instanced mesh. The set of instances is
 * rebuilt from the rock hash only when the jelly crosses into a new rock cell.
 */
import * as THREE from 'three/webgpu';
import { mx_noise_float, positionLocal, vec3 } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { valueNoise2 } from '../game/noise.ts';
import { createRock, isRockBroken, rockCellIndex, rockInCell, type RockLedger } from '../game/rocks.ts';
import { RIDGE_DISTANCE, ROCK_CELL, VALLEY_HALF_WIDTH, VALLEY_HALF_WIDTH_SWING, WORLD_SEED } from '../game/tuning.ts';
import { rockColorAt } from './biome-looks.ts';
import { VIEW_DISTANCE } from './terrain-mesh.ts';

const ROCK_DETAIL = 3;
const SEED_SHAPE = WORLD_SEED + 31;
/** Two octaves of lumpiness: frequency (per unit radius) and amplitude. */
const SHAPE_OCTAVES = [
  { frequency: 1.3, amplitude: 0.22 },
  { frequency: 3.1, amplitude: 0.07 },
] as const;
/** Boulders are a little wider than tall. */
const ROCK_FLATTEN = 0.86;
const ROCK_ROUGHNESS = 0.92;
/** Surface mottling: frequency in rock-local space and depth of the variation. */
const MOTTLE_FREQUENCY = 5;
const MOTTLE_DEPTH = 0.22;
/** Per-rock brightness spread. */
const SHADE_MIN = 0.72;
const SHADE_RANGE = 0.5;
const CELLS_AHEAD = Math.ceil(VIEW_DISTANCE / ROCK_CELL);
const CELLS_BEHIND = 3;
/** The jelly can be on one ridge while rocks sit on the opposite bank. */
const CELLS_ACROSS = Math.ceil((2 * (VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING + RIDGE_DISTANCE)) / ROCK_CELL);
const MAX_ROCKS = 512;
const TAU = Math.PI * 2;

function createRockGeometry() {
  const sphere = new THREE.IcosahedronGeometry(1, ROCK_DETAIL);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geometry = mergeVertices(sphere);
  sphere.dispose();
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    let scale = 1;
    for (const octave of SHAPE_OCTAVES) {
      // Three planar noise slices stand in for 3D noise on the unit sphere.
      scale += octave.amplitude * (
        valueNoise2(vertex.x * octave.frequency, vertex.y * octave.frequency, SEED_SHAPE) +
        valueNoise2(vertex.y * octave.frequency, vertex.z * octave.frequency, SEED_SHAPE + 1) +
        valueNoise2(vertex.z * octave.frequency, vertex.x * octave.frequency, SEED_SHAPE + 2)
      ) / 3;
    }
    vertex.multiplyScalar(scale);
    vertex.y *= ROCK_FLATTEN;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export class RockField {
  readonly mesh: THREE.InstancedMesh;
  private readonly rock = createRock();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private cellX = Number.NaN;
  private cellZ = Number.NaN;
  private originZ = Number.NaN;
  private smashed = -1;

  constructor() {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: ROCK_ROUGHNESS, metalness: 0 });
    const mottle = mx_noise_float(positionLocal.mul(MOTTLE_FREQUENCY)).mul(MOTTLE_DEPTH).add(1);
    // The rock's colour comes per instance: its biome's stone, at its own shade.
    material.colorNode = vec3(mottle);
    this.mesh = new THREE.InstancedMesh(createRockGeometry(), material, MAX_ROCKS);
    // The colours are rewritten whenever the rocks are, so their buffer must be dynamic too: made on the
    // first rebuild it would be a static one, and a static buffer can keep showing the old rocks' colours.
    for (let i = 0; i < MAX_ROCKS; i++) this.mesh.setColorAt(i, this.color.setScalar(1));
    this.mesh.count = 0;
    // Instances are spread along hundreds of metres; the single-rock bounding
    // sphere would cull the whole field.
    this.mesh.frustumCulled = false;
  }

  update(worldX: number, worldZ: number, originZ: number, broken: RockLedger) {
    const cellX = rockCellIndex(worldX), cellZ = rockCellIndex(worldZ);
    if (cellX === this.cellX && cellZ === this.cellZ && originZ === this.originZ && broken.total === this.smashed) return;
    this.cellX = cellX; this.cellZ = cellZ; this.originZ = originZ; this.smashed = broken.total;
    const { rock, matrix, position, rotation, scale, euler, mesh } = this;
    const shade = this.color;
    let count = 0;
    // Forward is -Z, so "ahead" is toward lower cell indices.
    for (let z = cellZ - CELLS_AHEAD; z <= cellZ + CELLS_BEHIND && count < MAX_ROCKS; z++) {
      for (let x = cellX - CELLS_ACROSS; x <= cellX + CELLS_ACROSS && count < MAX_ROCKS; x++) {
        if (!rockInCell(x, z, rock) || isRockBroken(broken, x, z)) continue;
        position.set(rock.x, rock.y, rock.z - originZ);
        euler.set(0, rock.look * TAU, 0);
        rotation.setFromEuler(euler);
        scale.setScalar(rock.radius);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(count, matrix);
        rockColorAt(-rock.z, shade).multiplyScalar(SHADE_MIN + SHADE_RANGE * rock.look);
        mesh.setColorAt(count, shade);
        count++;
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Rebuild the rocks on the next update. */
  invalidate() {
    this.cellX = Number.NaN;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
