/**
 * The visible hill: a fixed pool of grid chunks that are refilled from the
 * terrain function as the jelly descends. Nothing is allocated after
 * construction; a recycled chunk just has its vertex buffers rewritten.
 */
import * as THREE from 'three/webgpu';
import { attribute, mix, normalMap, positionWorld, texture, vec2, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { smoothstep, valueNoise1, valueNoise2 } from '../game/noise.ts';
import { createRock, rockCellIndex, rockInCell } from '../game/rocks.ts';
import { courseCenter, courseHalfWidth, kickerHeight, terrainHeight } from '../game/terrain.ts';
import { GRADIENT_STEP, KICKER_HEIGHT, WORLD_SEED } from '../game/tuning.ts';
import { shadeUnderJelly, type GroundLighting } from './ground-lighting.ts';

// --- Grid -------------------------------------------------------------------
/** Edge of one terrain quad (metres). REBASE_DISTANCE is a multiple of it. */
export const TERRAIN_CELL = 1.2;
const CHUNK_ROWS = 40;
export const CHUNK_LENGTH = TERRAIN_CELL * CHUNK_ROWS;
/**
 * Across the hill each row has a uniform core that covers the valley and both
 * ridges, flanked by skirts whose cells grow geometrically. The skirts carry
 * the land beyond the ridges out into the fog for very few vertices, so the
 * edge of the drawn terrain is never on screen.
 */
const CORE_COLUMNS = 120;
const CORE_HALF_WIDTH = (TERRAIN_CELL * CORE_COLUMNS) / 2;
const SKIRT_COLUMNS = 12;
const SKIRT_GROWTH = 1.3;
const CHUNK_COLUMNS = CORE_COLUMNS + 2 * SKIRT_COLUMNS;
/** X of each column relative to the (lattice-snapped) valley centre of its row. */
const COLUMN_OFFSETS = buildColumnOffsets();
const CHUNKS_AHEAD = 9;
const CHUNKS_BEHIND = 1;
const CHUNK_POOL = CHUNKS_AHEAD + CHUNKS_BEHIND + 1;
/** How far ahead the hill is drawn; the fog must close before this. */
export const VIEW_DISTANCE = CHUNKS_AHEAD * CHUNK_LENGTH;
const UNASSIGNED = Number.NaN;

// --- Grass material -----------------------------------------------------------
/** REBASE_DISTANCE is a multiple of both tile sizes. */
const GRASS_TILE = 0.6;
const GRASS_MACRO_TILE = 40;
/** Mean luminance of the grass albedo, used to turn the macro sample into a gain. */
const GRASS_MEAN_LUMA = 0.11;
const GRASS_MACRO_STRENGTH = 0.55;
const GRASS_NORMAL_STRENGTH = 0.9;
const GRASS_MIN_ROUGHNESS = 0.62;
const GRASS_SPECULAR = 0.16;
const GRASS_ANISOTROPY = 8;
const DIRT_COLOR = new THREE.Color('#8a6a48');
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

// --- Per-vertex tint -----------------------------------------------------------
const SEED_BIOME = WORLD_SEED + 21;
const SEED_PATCH = WORLD_SEED + 22;
const BIOME_WAVELENGTH = 700;
const PATCH_WAVELENGTH = 55;
const PATCH_STRENGTH = 0.18;
const LUSH_TINT = [0.55, 0.86, 0.5] as const;
const DRY_TINT = [0.95, 0.92, 0.5] as const;
/** Banks darken toward this multiplier over WALL_SHADE_DISTANCE metres. */
const WALL_SHADE = 0.72;
const WALL_SHADE_DISTANCE = 30;
/** Rock shadow patches: offset and size in rock radii, and darkness. */
const ROCK_SHADOW_OFFSET = 0.9;
const ROCK_SHADOW_INNER = 0.7;
const ROCK_SHADOW_OUTER = 2.3;
const ROCK_SHADOW_STRENGTH = 0.55;
/** A shadow never reaches further than one rock cell from its rock's cell. */
const ROCK_SHADOW_CELL_REACH = 1;
const TINT_SIZE = 4;

export type GrassTextures = { base: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };

export async function loadGrassTextures(): Promise<GrassTextures> {
  const loader = new THREE.TextureLoader();
  const [base, normal, roughness] = await Promise.all([
    new URL('../assets/grass_texture/grass_base.jpg', import.meta.url).href,
    new URL('../assets/grass_texture/grass_normal.jpg', import.meta.url).href,
    new URL('../assets/grass_texture/grass_roughness.jpg', import.meta.url).href,
  ].map(url => loader.loadAsync(url)));
  base.colorSpace = THREE.SRGBColorSpace;
  for (const map of [base, normal, roughness]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = GRASS_ANISOTROPY;
  }
  return { base, normal, roughness };
}

function createGrassMaterial(textures: GrassTextures, lighting: GroundLighting) {
  const material = new THREE.MeshPhysicalNodeMaterial({ metalness: 0, roughness: 1, specularIntensity: GRASS_SPECULAR });
  const uv = positionWorld.xz.div(GRASS_TILE);
  const detail = texture(textures.base, uv).rgb;
  // The same map sampled far larger breaks up the visible repeat of the detail tile.
  const macroLuma = texture(textures.base, positionWorld.xz.div(GRASS_MACRO_TILE)).rgb.dot(vec3(...LUMA_WEIGHTS));
  const macro = mix(1, macroLuma.div(GRASS_MEAN_LUMA), GRASS_MACRO_STRENGTH);
  const tint = attribute('tint', 'vec4');
  const grass = detail.mul(macro).mul(tint.rgb);
  const dirt = vec3(DIRT_COLOR.r, DIRT_COLOR.g, DIRT_COLOR.b).mul(macro);
  const albedo = mix(grass, dirt, tint.a) as unknown as Node<'vec3'>;
  material.colorNode = shadeUnderJelly(albedo, lighting);
  material.normalNode = normalMap(texture(textures.normal, uv), vec2(GRASS_NORMAL_STRENGTH, GRASS_NORMAL_STRENGTH));
  material.roughnessNode = texture(textures.roughness, uv).r.max(GRASS_MIN_ROUGHNESS);
  return material;
}

type Chunk = {
  mesh: THREE.Mesh;
  positions: Float32Array;
  normals: Float32Array;
  tints: Float32Array;
  /** Snapped valley-centre X of each row, kept so rock shadows can find their vertices. */
  rowOriginX: Float32Array;
  /** Which stretch of the course this chunk currently shows. */
  index: number;
};

export class TerrainMesh {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly material: THREE.MeshPhysicalNodeMaterial;
  private readonly indexAttribute: THREE.BufferAttribute;
  private readonly rock = createRock();
  private readonly shadowDirectionX: number;
  private readonly shadowDirectionZ: number;

  constructor(textures: GrassTextures, lighting: GroundLighting, toLight: THREE.Vector3) {
    this.material = createGrassMaterial(textures, lighting);
    // Shadows fall on the far side of a rock from the light.
    const horizontal = Math.hypot(toLight.x, toLight.z) || 1;
    this.shadowDirectionX = -toLight.x / horizontal;
    this.shadowDirectionZ = -toLight.z / horizontal;
    this.indexAttribute = new THREE.BufferAttribute(buildIndices(), 1);
    const uvs = new THREE.BufferAttribute(buildUvs(), 2);
    for (let i = 0; i < CHUNK_POOL; i++) this.chunks.push(this.createChunk(uvs));
  }

  /**
   * Make sure the chunks around course distance `s` exist, refilling at most
   * `budget` of them, and place every chunk relative to the render origin.
   */
  update(s: number, originZ: number, budget: number) {
    const current = Math.floor(s / CHUNK_LENGTH);
    const first = current - CHUNKS_BEHIND, last = current + CHUNKS_AHEAD;
    // Nearest missing stretch first, so a tight budget never leaves a hole underfoot.
    for (let wanted = first; wanted <= last && budget > 0; wanted++) {
      if (this.chunks.some(chunk => chunk.index === wanted)) continue;
      const spare = this.chunks.find(chunk => !(chunk.index >= first && chunk.index <= last));
      if (!spare) break;
      this.fill(spare, wanted);
      budget--;
    }
    for (const chunk of this.chunks) {
      chunk.mesh.visible = !Number.isNaN(chunk.index);
      if (chunk.mesh.visible) chunk.mesh.position.z = -chunk.index * CHUNK_LENGTH - originZ;
    }
  }

  dispose() {
    for (const chunk of this.chunks) chunk.mesh.geometry.dispose();
    this.material.dispose();
  }

  private createChunk(uvs: THREE.BufferAttribute): Chunk {
    const vertexCount = (CHUNK_ROWS + 1) * (CHUNK_COLUMNS + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const tints = new Float32Array(vertexCount * TINT_SIZE);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('tint', new THREE.BufferAttribute(tints, TINT_SIZE).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', uvs);
    geometry.setIndex(this.indexAttribute);
    const mesh = new THREE.Mesh(geometry, this.material);
    // Chunks are rewritten in place and always near the camera; a stale
    // bounding sphere would cull the ground out from under the jelly.
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, positions, normals, tints, rowOriginX: new Float32Array(CHUNK_ROWS + 1), index: UNASSIGNED };
  }

  private fill(chunk: Chunk, index: number) {
    const { positions, normals, tints, rowOriginX } = chunk;
    const startS = index * CHUNK_LENGTH;
    let p = 0, t = 0;
    for (let row = 0; row <= CHUNK_ROWS; row++) {
      const s = startS + row * TERRAIN_CELL;
      const z = -s;
      const centre = courseCenter(s), halfWidth = courseHalfWidth(s);
      // Each row is centred on the valley but snapped to the world lattice, so
      // the shared row between two chunks is computed identically by both.
      const originX = Math.round(centre / TERRAIN_CELL) * TERRAIN_CELL;
      rowOriginX[row] = originX;
      const dryness = valueNoise1(s / BIOME_WAVELENGTH, SEED_BIOME);
      for (let column = 0; column <= CHUNK_COLUMNS; column++) {
        const x = originX + COLUMN_OFFSETS[column];
        const h = terrainHeight(x, z);
        const dhdx = (terrainHeight(x + GRADIENT_STEP, z) - h) / GRADIENT_STEP;
        const dhdz = (terrainHeight(x, z + GRADIENT_STEP) - h) / GRADIENT_STEP;
        const inverseLength = 1 / Math.hypot(dhdx, 1, dhdz);
        positions[p] = x; positions[p + 1] = h; positions[p + 2] = -row * TERRAIN_CELL;
        normals[p] = -dhdx * inverseLength; normals[p + 1] = inverseLength; normals[p + 2] = -dhdz * inverseLength;
        p += 3;

        const patch = 1 + PATCH_STRENGTH * valueNoise2(x / PATCH_WAVELENGTH, s / PATCH_WAVELENGTH, SEED_PATCH);
        const beyond = Math.max(0, Math.abs(x - centre) - halfWidth);
        const shade = patch * (1 - (1 - WALL_SHADE) * smoothstep(0, WALL_SHADE_DISTANCE, beyond));
        tints[t] = (LUSH_TINT[0] + (DRY_TINT[0] - LUSH_TINT[0]) * dryness) * shade;
        tints[t + 1] = (LUSH_TINT[1] + (DRY_TINT[1] - LUSH_TINT[1]) * dryness) * shade;
        tints[t + 2] = (LUSH_TINT[2] + (DRY_TINT[2] - LUSH_TINT[2]) * dryness) * shade;
        tints[t + 3] = Math.min(1, kickerHeight(x, s) / KICKER_HEIGHT);
        t += TINT_SIZE;
      }
    }
    this.stampRockShadows(chunk, startS);
    const { geometry } = chunk.mesh;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.attributes.tint.needsUpdate = true;
    chunk.index = index;
  }

  /** Darken the vertices in each rock's shadow. Coarse, soft, and free at draw time. */
  private stampRockShadows(chunk: Chunk, startS: number) {
    const { tints, rowOriginX } = chunk;
    const rock = this.rock;
    // Rows are sheared to follow the valley, so the X extent of the uniform
    // core (the only part rocks ever sit on) is the union over the rows.
    let minX = Infinity, maxX = -Infinity;
    for (let row = 0; row <= CHUNK_ROWS; row++) {
      minX = Math.min(minX, rowOriginX[row] - CORE_HALF_WIDTH);
      maxX = Math.max(maxX, rowOriginX[row] + CORE_HALF_WIDTH);
    }
    const cellZFirst = rockCellIndex(-(startS + CHUNK_LENGTH)) - ROCK_SHADOW_CELL_REACH;
    const cellZLast = rockCellIndex(-startS) + ROCK_SHADOW_CELL_REACH;
    const cellXFirst = rockCellIndex(minX) - ROCK_SHADOW_CELL_REACH;
    const cellXLast = rockCellIndex(maxX) + ROCK_SHADOW_CELL_REACH;
    for (let cellZ = cellZFirst; cellZ <= cellZLast; cellZ++) {
      for (let cellX = cellXFirst; cellX <= cellXLast; cellX++) {
        if (!rockInCell(cellX, cellZ, rock)) continue;
        const outer = rock.radius * ROCK_SHADOW_OUTER, inner = rock.radius * ROCK_SHADOW_INNER;
        const shadowX = rock.x + this.shadowDirectionX * rock.radius * ROCK_SHADOW_OFFSET;
        const shadowS = -(rock.z + this.shadowDirectionZ * rock.radius * ROCK_SHADOW_OFFSET);
        const rowFirst = Math.max(0, Math.ceil((shadowS - outer - startS) / TERRAIN_CELL));
        const rowLast = Math.min(CHUNK_ROWS, Math.floor((shadowS + outer - startS) / TERRAIN_CELL));
        for (let row = rowFirst; row <= rowLast; row++) {
          const ds = startS + row * TERRAIN_CELL - shadowS;
          // Core columns are uniform, so the ones under the shadow are found by division.
          const coreLeft = rowOriginX[row] - CORE_HALF_WIDTH;
          const columnFirst = SKIRT_COLUMNS + Math.max(0, Math.ceil((shadowX - outer - coreLeft) / TERRAIN_CELL));
          const columnLast = SKIRT_COLUMNS + Math.min(CORE_COLUMNS, Math.floor((shadowX + outer - coreLeft) / TERRAIN_CELL));
          for (let column = columnFirst; column <= columnLast; column++) {
            const dx = rowOriginX[row] + COLUMN_OFFSETS[column] - shadowX;
            const shade = 1 - ROCK_SHADOW_STRENGTH * (1 - smoothstep(inner, outer, Math.hypot(dx, ds)));
            const t = (row * (CHUNK_COLUMNS + 1) + column) * TINT_SIZE;
            tints[t] *= shade; tints[t + 1] *= shade; tints[t + 2] *= shade;
          }
        }
      }
    }
  }
}

function buildColumnOffsets(): Float32Array {
  const offsets = new Float32Array(CHUNK_COLUMNS + 1);
  for (let column = 0; column <= CORE_COLUMNS; column++) {
    offsets[SKIRT_COLUMNS + column] = -CORE_HALF_WIDTH + column * TERRAIN_CELL;
  }
  let reach = CORE_HALF_WIDTH, cell = TERRAIN_CELL;
  for (let step = 1; step <= SKIRT_COLUMNS; step++) {
    cell *= SKIRT_GROWTH;
    reach += cell;
    offsets[SKIRT_COLUMNS - step] = -reach;
    offsets[SKIRT_COLUMNS + CORE_COLUMNS + step] = reach;
  }
  return offsets;
}

function buildIndices(): Uint16Array {
  const QUAD_INDICES = 6;
  const indices = new Uint16Array(CHUNK_ROWS * CHUNK_COLUMNS * QUAD_INDICES);
  const stride = CHUNK_COLUMNS + 1;
  let i = 0;
  for (let row = 0; row < CHUNK_ROWS; row++) {
    for (let column = 0; column < CHUNK_COLUMNS; column++) {
      const near = row * stride + column, far = near + stride;
      // Rows advance toward -Z, so this winding faces up.
      indices[i++] = near; indices[i++] = near + 1; indices[i++] = far;
      indices[i++] = near + 1; indices[i++] = far + 1; indices[i++] = far;
    }
  }
  return indices;
}

/**
 * Texturing uses world position, but the normal map still needs a tangent
 * frame, which Three derives from a UV attribute. These only fix its axes.
 */
function buildUvs(): Float32Array {
  const uvs = new Float32Array((CHUNK_ROWS + 1) * (CHUNK_COLUMNS + 1) * 2);
  let i = 0;
  for (let row = 0; row <= CHUNK_ROWS; row++) {
    for (let column = 0; column <= CHUNK_COLUMNS; column++) {
      uvs[i++] = COLUMN_OFFSETS[column] / GRASS_TILE;
      uvs[i++] = (-row * TERRAIN_CELL) / GRASS_TILE;
    }
  }
  return uvs;
}
