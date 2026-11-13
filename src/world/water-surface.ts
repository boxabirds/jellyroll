/**
 * The water in the game: a flat surface at the level of every water-filled hole near the jelly, shaded by the shared
 * water shader (water/material.ts). Each hole's surface is a grid over its ragged outline, rebuilt when the jelly moves to
 * a new cell. Water is level, so every vertex of a hole is at the hole's one height, with two rules to keep it from ever
 * hanging in the air on a hill:
 *   - it exists only inside the hole's own outline (no soft edge beyond the rim, where the hillside falls away), and only
 *     where the ground is below the surface;
 *   - every other vertex is dropped just under the ground, so the triangles that cross the shore dive under the terrain
 *     instead of standing out as a flat shelf.
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { CAVE, DUNES, ICE, MEADOW } from '../game/biomes.ts';
import { createHoleDisc, holeCellIndex, holeInCell } from '../game/hazards.ts';
import { collectHoles, courseCenter, discLevel, HoleSet, terrainHeightWith } from '../game/terrain.ts';
import { createShoreVertex, shoreVertexOn } from '../game/water-shore.ts';
import { HAZARD_CELL, HAZARD_EDGE_WAVES, RIDGE_DISTANCE, VALLEY_HALF_WIDTH, VALLEY_HALF_WIDTH_SWING } from '../game/tuning.ts';
import { buildWaterMaterial } from '../water/material.ts';
import { waterSettings } from '../water/params.ts';
import type { Quality } from '../water/quality.ts';
import type { WaterSim } from '../water/sim.ts';

/** Surfaces are made this far (metres) ahead of the jelly and behind it. */
const AHEAD = 170;
const BEHIND = 30;
const CELLS_AHEAD = Math.ceil(AHEAD / HAZARD_CELL);
const CELLS_BEHIND = Math.ceil(BEHIND / HAZARD_CELL);
const CELLS_ACROSS = Math.ceil((VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING + RIDGE_DISTANCE) / HAZARD_CELL) + 1;
/** Spacing of the grid over a hole (metres), and the most vertices and triangles in total. */
const GRID_STEP = 1;
const MIN_GRID_STEP = 0.4;
const POINTS_PER_RADIUS = 6;
/** The most points in the triangle list (three to a triangle). */
const MAX_VERTICES = 240000;
const MAX_EDGE_FACTOR = 1 + HAZARD_EDGE_WAVES[0] + HAZARD_EDGE_WAVES[1] + HAZARD_EDGE_WAVES[2];
/** The colour of each kind of water, as a factor on the water colour in the settings. */
const TINTS: Record<number, readonly [number, number, number]> = {
  [MEADOW]: [1, 1, 1],
  [DUNES]: [0.85, 1.25, 1],
  [ICE]: [0.8, 0.95, 1.25],
  // Cave pools glow: brighter than daylight water, since it is the water's own light.
  [CAVE]: [0.9, 2.2, 2.4],
};

/** One pool's surface as worked out once: its grid in world coordinates, which points are wet, and its triangles. */
type Patch = { positions: Float32Array; alphas: Float32Array; depths: Float32Array; tint: readonly [number, number, number] };
/** The pools are half a metre deep: their depth counts this many times over, so they look like water and not like wet ground. */
const POOL_DEPTH_SCALE = 5;
/** But never so much that the jelly cannot be seen in the water: the scaled depth counts up to this (metres of real water it looks like). */
const POOL_MAX_OPTICAL_DEPTH = 1.1;
/** And their own colour is this much stronger than in the designer's pale-bedded pool, so they read as water over grass and rock. */
const POOL_SCATTER_GAIN = 3;
/** The mesh is re-laid (and sent to the GPU) no more often than this while pools keep arriving. */
const ASSEMBLE_GAP_MS = 350;
/** Milliseconds a frame may be spent working out pools that have come into range. */
const BUILD_BUDGET_MS = 1.5;
/** Cells are keyed by one number: the row times this, plus the column (both shifted to be positive). */
const KEY_SPAN = 4096;
const KEY_OFFSET = 1024;

/** Cells either side of a changed stretch whose pools may reach into it. */
const REFRESH_CELLS = 2;

export class WaterSurfaces {
  readonly mesh: THREE.Mesh;
  /** The direction to the sun, and where the ripples are: shader inputs. */
  readonly sun = uniform(new THREE.Vector3(0.4, 0.8, 0.3).normalize());
  readonly centre = uniform(new THREE.Vector2());
  private readonly reach = uniform(10);
  private readonly positions = new Float32Array(MAX_VERTICES * 3);
  private readonly alphas = new Float32Array(MAX_VERTICES);
  private readonly tints = new Float32Array(MAX_VERTICES * 3);
  private readonly depths = new Float32Array(MAX_VERTICES);
  private used = 0;
  private stale = false;
  private assembledAt = 0;
  private assembledOrigin = Number.NaN;
  private readonly disc = createHoleDisc();
  private readonly scratch = createShoreVertex();
  private readonly sim: WaterSim;
  private nodes: { value: unknown }[] = [];
  private builtFor = '';
  /** Set while the ground is not all built: water drawn over a missing hillside would be a flat sheet over nothing. */
  hold = false;
  /** Switched off altogether (for performance checks). */
  off = false;
  private built = false;
  private cellS = Number.NaN;
  private originZ = Number.NaN;
  private readonly patches = new Map<number, Patch | null>();
  private readonly queue: number[] = [];
  private queued = 0;
  private readonly basins = new HoleSet();

  constructor(sim: WaterSim, quality: Quality) {
    this.sim = sim;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('wAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('wTint', new THREE.BufferAttribute(this.tints, 3));
    geometry.setAttribute('wDepth', new THREE.BufferAttribute(this.depths, 1));
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    sim.onTexture = texture => { for (const node of this.nodes) node.value = texture; };
    this.apply(quality);
  }

  private testPlane: THREE.Mesh | null = null;

  /**
   * For the device benchmark: a stretch of water at the jelly (it draws the same shader as real water, so its cost is in the
   * timing, and its shader is compiled before the game starts). `on` false takes it away.
   */
  benchmark(on: boolean, x: number, groundY: number, z: number, originZ: number) {
    if (!on) {
      if (this.testPlane) { this.mesh.parent?.remove(this.testPlane); this.testPlane.geometry.dispose(); this.testPlane = null; }
      return;
    }
    if (!this.testPlane) {
      const size = 60, geometry = new THREE.PlaneGeometry(size, size, 60, 60);
      geometry.rotateX(-Math.PI / 2);
      const count = geometry.attributes.position.count;
      geometry.setAttribute('wAlpha', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
      geometry.setAttribute('wTint', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      geometry.setAttribute('wDepth', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));
      this.testPlane = new THREE.Mesh(geometry, this.mesh.material);
      this.testPlane.frustumCulled = false;
      this.testPlane.renderOrder = 2;
      this.mesh.parent?.add(this.testPlane);
    }
    this.testPlane.material = this.mesh.material;
    this.testPlane.position.set(x, groundY + 0.35, z - originZ);
  }

  /** Rebuild the shader if what the quality changes about it has changed. */
  apply(quality: Quality) {
    const key = `${quality.lift}${quality.bentRefraction}${quality.fineDetail}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    (this.mesh.material as THREE.Material).dispose();
    this.nodes = [];
    this.mesh.material = buildWaterMaterial({
      quality, sim: this.sim, uvOffset: 0, perVertex: true, vertexDepth: true, depthScale: POOL_DEPTH_SCALE, maxDepth: POOL_MAX_OPTICAL_DEPTH, scatterGain: POOL_SCATTER_GAIN, sun: this.sun as unknown as Node<'vec3'>,
      ripplesNear: { centre: this.centre as unknown as Node<'vec2'>, reach: this.reach as unknown as Node<'float'> }, nodes: this.nodes,
    });
  }

  /**
   * Keep the surfaces round the jelly up to date. Each pool's surface is worked out once (it needs the ground height at
   * every point of its grid, which is the costly part) and kept until the pool is far behind; new pools coming into range
   * are worked out a few at a time, within `budgetMs` a frame, nearest first, so the game never stops to do it.
   */
  update(worldX: number, worldZ: number, originZ: number, budgetMs = BUILD_BUDGET_MS) {
    this.reach.value = waterSettings.values.rippleReach;
    this.centre.value.set(worldX, worldZ - originZ);
    const cellS = holeCellIndex(-worldZ);
    let dirty = originZ !== this.originZ;
    this.originZ = originZ;
    if (cellS !== this.cellS) {
      this.cellS = cellS;
      const first = cellS - CELLS_BEHIND, last = cellS + CELLS_AHEAD;
      for (const [key, patch] of this.patches) {
        const j = Math.floor(key / KEY_SPAN) - KEY_OFFSET;
        if (j < first || j > last) { this.patches.delete(key); if (patch) dirty = true; }
      }
      // Nearest rows first.
      this.queue.length = 0;
      for (let j = first; j <= last; j++) {
        for (let i = -CELLS_ACROSS; i <= CELLS_ACROSS; i++) {
          const key = (j + KEY_OFFSET) * KEY_SPAN + (i + KEY_SPAN / 2);
          if (!this.patches.has(key)) this.queue.push(key);
        }
      }
      this.queued = 0;
    }
    const started = performance.now();
    while (this.queued < this.queue.length && performance.now() - started < budgetMs) {
      const key = this.queue[this.queued++];
      const patch = this.buildPatch(key % KEY_SPAN - KEY_SPAN / 2, Math.floor(key / KEY_SPAN) - KEY_OFFSET);
      this.patches.set(key, patch);
      if (patch) dirty = true;
    }
    // Laying the pools into the mesh sends the whole of it to the GPU, so it is not done for every pool that arrives:
    // at once if the origin moved or nothing is waiting, otherwise at most every ASSEMBLE_GAP_MS.
    if (dirty) this.stale = true;
    const now = performance.now();
    const forced = originZ !== this.assembledOrigin || budgetMs === Number.POSITIVE_INFINITY;
    if (this.stale && (forced || now - this.assembledAt >= ASSEMBLE_GAP_MS)) {
      this.assemble(originZ);
      this.stale = false; this.assembledAt = now; this.assembledOrigin = originZ;
    }
    this.mesh.visible = this.built && !this.hold && !this.off;
  }

  /** For checks: pools worked out, pools with water, points in use, pools still waiting, and whether it is being drawn. */
  stats() {
    let wet = 0;
    for (const patch of this.patches.values()) if (patch) wet++;
    return { pools: this.patches.size, wet, points: this.used, waiting: this.queue.length - this.queued, visible: this.mesh.visible, hold: this.hold };
  }

  /** The ground between course distances sMin and sMax has changed (frozen lakes are solid now): work out the pools there again. */
  refresh(sMin: number, sMax: number) {
    const first = holeCellIndex(Math.min(sMin, sMax)), last = holeCellIndex(Math.max(sMin, sMax));
    for (const key of [...this.patches.keys()]) {
      const j = Math.floor(key / KEY_SPAN) - KEY_OFFSET;
      // A pool reaches a cell or two past its own.
      if (j >= first - REFRESH_CELLS && j <= last + REFRESH_CELLS) this.patches.delete(key);
    }
    this.stale = true;
    this.cellS = Number.NaN;
  }

  /** Work everything out afresh on the next update. */
  invalidate() {
    this.patches.clear();
    this.queue.length = 0; this.queued = 0;
    this.cellS = Number.NaN;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /** One pool's surface, in world coordinates; null if the cell has no water. */
  private buildPatch(i: number, j: number): Patch | null {
    const { disc, scratch, basins } = this;
    if (!holeInCell(i, j, disc)) return null;
    const tint = TINTS[disc.kind];
    if (!tint) return null;
    const level = discLevel(i, j, disc);
    const reach = disc.radius * MAX_EDGE_FACTOR;
    // Small pools get a finer grid, so even the smallest has a surface of several points across.
    const step = Math.min(GRID_STEP, Math.max(MIN_GRID_STEP, disc.radius / POINTS_PER_RADIUS));
    const across = Math.ceil((2 * reach) / step) + 1;
    // The basins that shape the ground under this pool, found once for all its points.
    collectHoles(basins, disc.s - reach - GRID_STEP, disc.s + reach + GRID_STEP);
    const positions = new Float32Array(across * across * 3), alphas = new Float32Array(across * across), depths = new Float32Array(across * across);
    let wetCount = 0;
    for (let b = 0; b < across; b++) {
      const s = disc.s - reach + b * step;
      const centre = courseCenter(s);
      for (let a = 0; a < across; a++) {
        const u = disc.u - reach + a * step, x = centre + u;
        const point = shoreVertexOn(disc, level, u, s, x, terrainHeightWith(basins, x, -s), scratch);
        const v = b * across + a;
        positions[v * 3] = point.x; positions[v * 3 + 1] = point.y; positions[v * 3 + 2] = point.z;
        alphas[v] = point.shown ? 1 : 0;
        depths[v] = level - point.ground;
        if (point.wet) wetCount++;
      }
    }
    if (wetCount === 0) return null;
    // A plain list of triangles (three points each): this renderer does not reliably take up a rewritten index list.
    const corners: number[] = [];
    for (let b = 0; b < across - 1; b++) {
      for (let a = 0; a < across - 1; a++) {
        const v0 = b * across + a, v1 = v0 + 1, v2 = v0 + across, v3 = v2 + 1;
        if (alphas[v0] === 0 && alphas[v1] === 0 && alphas[v2] === 0 && alphas[v3] === 0) continue;
        corners.push(v0, v2, v1, v1, v2, v3);
      }
    }
    const listPositions = new Float32Array(corners.length * 3), listAlphas = new Float32Array(corners.length), listDepths = new Float32Array(corners.length);
    for (let n = 0; n < corners.length; n++) {
      const v = corners[n];
      listPositions[n * 3] = positions[v * 3]; listPositions[n * 3 + 1] = positions[v * 3 + 1]; listPositions[n * 3 + 2] = positions[v * 3 + 2];
      listAlphas[n] = alphas[v]; listDepths[n] = depths[v];
    }
    return { positions: listPositions, alphas: listAlphas, depths: listDepths, tint };
  }

  /** Lay every pool's surface into the one mesh, shifted to the render origin. */
  private assemble(originZ: number) {
    const { positions, alphas, tints } = this;
    let vertices = 0;
    for (const patch of this.patches.values()) {
      if (!patch) continue;
      const count = patch.alphas.length;
      if (vertices + count > MAX_VERTICES) continue;
      positions.set(patch.positions, vertices * 3);
      alphas.set(patch.alphas, vertices);
      this.depths.set(patch.depths, vertices);
      for (let v = vertices; v < vertices + count; v++) {
        positions[v * 3 + 2] -= originZ;
        tints[v * 3] = patch.tint[0]; tints[v * 3 + 1] = patch.tint[1]; tints[v * 3 + 2] = patch.tint[2];
      }
      vertices += count;
    }
    // Every triangle is always drawn: what was in use last time and is not now is flattened to nothing.
    if (this.used > vertices) { positions.fill(0, vertices * 3, this.used * 3); alphas.fill(0, vertices, this.used); }
    // Only the part of each buffer that is in use (now or last time) is sent.
    const span = Math.max(vertices, this.used);
    this.used = vertices;
    const geometry = this.mesh.geometry;
    for (const [name, size] of [['position', 3], ['wAlpha', 1], ['wTint', 3], ['wDepth', 1]] as const) {
      const attribute = geometry.attributes[name] as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, span * size);
      attribute.needsUpdate = true;
    }
    this.built = vertices > 0;
  }
}
