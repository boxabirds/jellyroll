/**
 * The visible hill: a fixed pool of grid chunks that are refilled from the
 * terrain function as the jelly descends. Nothing is allocated after
 * construction; a recycled chunk just has its vertex buffers rewritten.
 */
import * as THREE from 'three/webgpu';
import { attribute, mix, normalMap, positionWorld, sin, smoothstep as smoothstepNode, texture, time, vec2, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { BIOME_COUNT, BIOME_LENGTH, biomeOfStretch, biomeStretch } from '../game/biomes.ts';
import { smoothstep, valueNoise1, valueNoise2 } from '../game/noise.ts';
import { createRock, rockCellIndex, rockInCell } from '../game/rocks.ts';
import { courseCenter, courseHalfWidth, kickerHeight, terrainHeight } from '../game/terrain.ts';
import { GRADIENT_STEP, KICKER_HEIGHT, WORLD_SEED } from '../game/tuning.ts';
import { GROUND_LOOKS, type GroundLook, type GroundTextures } from './biome-looks.ts';
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

// --- Ground material ---------------------------------------------------------
/** Every biome's texture is also sampled this large, to break up its repeat. The origin hop is a multiple. */
const MACRO_TILE = 40;
const GROUND_SPECULAR = 0.16;
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
/**
 * The per-vertex blend between two biomes is soft; these edges sharpen it in
 * the shader so the ground changes in patches with crisp-ish borders rather
 * than as a 200 m cross-fade.
 */
const BLEND_EDGE_FROM = 0.34;
const BLEND_EDGE_TO = 0.66;
/** Emission-map brightness at which a vein starts to glow, and at which it glows fully. */
const GLOW_FROM_HEAT = 0.3;
const GLOW_FULL_HEAT = 0.75;
/** Molten ground breathes: fraction of the glow that pulses, how fast, and how the phase drifts across the valley. */
const GLOW_PULSE = 0.25;
const GLOW_PULSE_RATE = 1.3;
const GLOW_PULSE_PER_METRE = 0.2;

// --- Per-vertex data --------------------------------------------------------------
const SEED_VARIATION = WORLD_SEED + 21;
const SEED_PATCH = WORLD_SEED + 22;
const SEED_EDGE_BROAD = WORLD_SEED + 23;
const SEED_EDGE_FINE = WORLD_SEED + 24;
/** The ground wanders between a biome's two tints over this distance. */
const VARIATION_WAVELENGTH = 700;
const PATCH_WAVELENGTH = 55;
const PATCH_STRENGTH = 0.18;
/** Banks darken toward this multiplier over WALL_SHADE_DISTANCE metres. */
const WALL_SHADE = 0.72;
const WALL_SHADE_DISTANCE = 30;
/**
 * A biome boundary is not a straight line across the valley: it wanders by
 * up to EDGE_BROAD + EDGE_FINE metres, in tongues and patches. Together with
 * EDGE_BAND that keeps the whole change inside the 200 m transition.
 */
const EDGE_BROAD = 40;
const EDGE_BROAD_WAVELENGTH = 55;
const EDGE_FINE = 10;
const EDGE_FINE_WAVELENGTH = 9;
const EDGE_BAND = 50;
/** Rock shadow patches: offset and size in rock radii, and darkness. */
const ROCK_SHADOW_OFFSET = 0.9;
const ROCK_SHADOW_INNER = 0.7;
const ROCK_SHADOW_OUTER = 2.3;
const ROCK_SHADOW_STRENGTH = 0.55;
/** A shadow never reaches further than one rock cell from its rock's cell. */
const ROCK_SHADOW_CELL_REACH = 1;
/** Per vertex: shade, tint variation, blend toward the next biome, bare-dirt amount. */
const TINT_SIZE = 4;
const SHADE = 0;
const VARIATION = 1;
const BLEND = 2;
const DIRT = 3;

/**
 * Keeps only the brightest veins of an emission map. The lava texture glows
 * all over; cooled rock with molten cracks reads better and leaves the jelly
 * and the embers something to stand out against.
 */
function hottest(emission: Node<'vec3'>) {
  const heat = emission.dot(vec3(...LUMA_WEIGHTS));
  return emission.mul(smoothstepNode(GLOW_FROM_HEAT, GLOW_FULL_HEAT, heat));
}

/** One biome's ground at this fragment, before it is blended with its neighbour. */
function groundLayer(look: GroundLook, maps: GroundTextures, variation: Node<'float'>) {
  const uv = positionWorld.xz.div(look.tile);
  const macroLuma = texture(maps.base, positionWorld.xz.div(MACRO_TILE)).rgb.dot(vec3(...LUMA_WEIGHTS));
  const macro = mix(1, macroLuma.div(look.meanLuma), look.macroStrength);
  const tint = mix(vec3(...look.tintA), vec3(...look.tintB), variation);
  const dirt = new THREE.Color(look.dirt);
  return {
    albedo: texture(maps.base, uv).rgb.mul(macro).mul(tint),
    dirt: vec3(dirt.r, dirt.g, dirt.b).mul(macro),
    normal: normalMap(texture(maps.normal, uv), vec2(look.normalStrength, look.normalStrength)),
    roughness: texture(maps.roughness, uv).r.mul(look.roughnessScale).clamp(look.minRoughness, 1),
    glow: maps.emission ? hottest(texture(maps.emission, uv).rgb as unknown as Node<'vec3'>).mul(look.emissionGain) : vec3(0),
  };
}

/**
 * The ground of one stretch of the sequence: biome `from` turning into biome
 * `to`. Only two biomes can ever meet, so each material samples just two sets
 * of maps, and a chunk simply uses the material of the stretch it starts in.
 */
function createGroundMaterial(from: number, to: number, textures: readonly GroundTextures[], lighting: GroundLighting) {
  const material = new THREE.MeshPhysicalNodeMaterial({ metalness: 0, roughness: 1, specularIntensity: GROUND_SPECULAR });
  const data = attribute('tint', 'vec4');
  const variation = data.y as unknown as Node<'float'>;
  const a = groundLayer(GROUND_LOOKS[from], textures[from], variation);
  const b = groundLayer(GROUND_LOOKS[to], textures[to], variation);
  const blend = smoothstepNode(BLEND_EDGE_FROM, BLEND_EDGE_TO, data.z);
  const ground = mix(a.albedo, b.albedo, blend).mul(data.x);
  const albedo = mix(ground, mix(a.dirt, b.dirt, blend), data.w) as unknown as Node<'vec3'>;
  material.colorNode = shadeUnderJelly(albedo, lighting);
  material.normalNode = mix(a.normal, b.normal, blend).normalize();
  material.roughnessNode = mix(a.roughness, b.roughness, blend);
  if (textures[from].emission || textures[to].emission) {
    const pulse = sin(time.mul(GLOW_PULSE_RATE).add(positionWorld.x.mul(GLOW_PULSE_PER_METRE))).mul(GLOW_PULSE).add(1 - GLOW_PULSE);
    material.emissiveNode = mix(a.glow, b.glow, blend).mul(pulse).mul(data.x);
  }
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
  /** One material per stretch of the biome sequence: biome i turning into biome i + 1. */
  private readonly materials: THREE.MeshPhysicalNodeMaterial[];
  private readonly indexAttribute: THREE.BufferAttribute;
  private readonly rock = createRock();
  private readonly shadowDirectionX: number;
  private readonly shadowDirectionZ: number;

  constructor(textures: readonly GroundTextures[], lighting: GroundLighting, toLight: THREE.Vector3) {
    this.materials = Array.from({ length: BIOME_COUNT }, (_, from) => createGroundMaterial(from, (from + 1) % BIOME_COUNT, textures, lighting));
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

  /**
   * Only the first stretch's material is on screen at the start. Show a hidden
   * chunk in each of the others so their shaders are compiled behind the
   * loading card, not as a hitch at the first sight of each new biome.
   * Call the returned function once compilation is done.
   */
  warmMaterials() {
    const extras = this.materials.map(material => {
      const mesh = new THREE.Mesh(this.chunks[0].mesh.geometry, material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    return () => { for (const mesh of extras) this.group.remove(mesh); };
  }

  dispose() {
    for (const chunk of this.chunks) chunk.mesh.geometry.dispose();
    for (const material of this.materials) material.dispose();
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
    const mesh = new THREE.Mesh(geometry, this.materials[0]);
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
    // The whole chunk is drawn as the stretch it starts in. Rows that lie past
    // the end of that stretch are simply fully the next biome.
    const stretch = biomeStretch(startS);
    const boundary = (stretch + 1) * BIOME_LENGTH;
    chunk.mesh.material = this.materials[biomeOfStretch(stretch)];
    let p = 0, t = 0;
    for (let row = 0; row <= CHUNK_ROWS; row++) {
      const s = startS + row * TERRAIN_CELL;
      const z = -s;
      const centre = courseCenter(s), halfWidth = courseHalfWidth(s);
      // Each row is centred on the valley but snapped to the world lattice, so
      // the shared row between two chunks is computed identically by both.
      const originX = Math.round(centre / TERRAIN_CELL) * TERRAIN_CELL;
      rowOriginX[row] = originX;
      const variation = valueNoise1(s / VARIATION_WAVELENGTH, SEED_VARIATION);
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
        const wander =
          EDGE_BROAD * valueNoise2(x / EDGE_BROAD_WAVELENGTH, s / EDGE_BROAD_WAVELENGTH, SEED_EDGE_BROAD) +
          EDGE_FINE * valueNoise2(x / EDGE_FINE_WAVELENGTH, s / EDGE_FINE_WAVELENGTH, SEED_EDGE_FINE);
        tints[t + SHADE] = patch * (1 - (1 - WALL_SHADE) * smoothstep(0, WALL_SHADE_DISTANCE, beyond));
        tints[t + VARIATION] = variation;
        tints[t + BLEND] = smoothstep(boundary - EDGE_BAND, boundary + EDGE_BAND, s + wander);
        tints[t + DIRT] = Math.min(1, kickerHeight(x, s) / KICKER_HEIGHT);
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
            tints[t + SHADE] *= shade;
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
      uvs[i++] = COLUMN_OFFSETS[column];
      uvs[i++] = -row * TERRAIN_CELL;
    }
  }
  return uvs;
}
