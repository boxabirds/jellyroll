/**
 * The ripples: a wave simulation on a square grid (the wave equation of Evan Wallace's WebGL Water, run on the CPU),
 * held in a half-float texture the water surface reads. Red and green hold the slope of the surface, blue its height,
 * alpha the foam. Edges soak waves up, so nothing bounces back from the frame of the pool. The grid's size and how often
 * it is stepped are set by the quality (quality.ts), and a still pool costs nothing.
 */
import * as THREE from 'three/webgpu';
import { waterSettings } from './params.ts';

export const SIM_SIZE = 24;
const CHANNELS = 4;
/** Damping in settings is per step at this many steps a second; other rates are scaled to match. */
const REFERENCE_STEPS_PER_SECOND = 30;
const MAX_STEPS_PER_FRAME = 4;
/** The most a wave may travel in one step, in cells (2D wave equation: 1 / sqrt 2). */
const MAX_COURANT = 0.7;
/** The edge that soaks up waves is this share of the grid wide. */
const SPONGE_SHARE = 0.09;
const SPONGE_STRENGTH = 0.12;
const { toHalfFloat } = THREE.DataUtils;

export class WaterSim {
  texture!: THREE.DataTexture;
  cells = 0;
  /** The most times a second the grid is stepped and uploaded. */
  hz = 30;
  /** Called with the new texture when the grid is resized (the surface rebinds it). */
  onTexture: (texture: THREE.DataTexture) => void = () => {};
  /** Milliseconds the last update took on the CPU (stepping and writing the texture), for the cost readout. */
  lastMilliseconds = 0;
  private height = new Float32Array(0);
  private velocity = new Float32Array(0);
  private foam = new Float32Array(0);
  private sponge = new Float32Array(0);
  private pixels = new Uint16Array(0);
  private accumulator = 0;
  private active = false;
  private dirty = false;

  /**
   * @param wrap true for the game: the grid wraps round, takes positions in absolute world metres, and has no soaking edge, so
   *             it needs no moving as the jelly goes by. False for a pool centred on the origin with a soaking edge.
   */
  constructor(cells: number, hz: number, private readonly wrap = false) {
    this.configure(cells, hz);
  }

  /** Cells across where the world's origin falls: the middle for a pool, the corner for a wrapping world. */
  private get middle() {
    return this.wrap ? 0 : this.cells / 2;
  }

  private index(gx: number, gz: number): number {
    const n = this.cells;
    if (this.wrap) return (((gz % n) + n) % n) * n + (((gx % n) + n) % n);
    return gx < 1 || gz < 1 || gx >= n - 1 || gz >= n - 1 ? -1 : gz * n + gx;
  }

  private get cell() {
    return SIM_SIZE / this.cells;
  }

  /** Change the grid size and rate. Whatever ripples there were are gone. */
  configure(cells: number, hz: number) {
    this.hz = hz;
    if (cells === this.cells) return;
    this.cells = cells;
    const count = cells * cells;
    this.height = new Float32Array(count); this.velocity = new Float32Array(count); this.foam = new Float32Array(count);
    this.sponge = new Float32Array(count); this.pixels = new Uint16Array(count * CHANNELS);
    const reach = Math.max(3, Math.round(cells * SPONGE_SHARE));
    for (let z = 0; z < cells && !this.wrap; z++) {
      for (let x = 0; x < cells; x++) {
        const edge = Math.min(x, z, cells - 1 - x, cells - 1 - z);
        const t = Math.max(0, 1 - edge / reach);
        this.sponge[z * cells + x] = t * t * SPONGE_STRENGTH;
      }
    }
    const old = this.texture;
    this.texture = new THREE.DataTexture(this.pixels, cells, cells, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.active = false;
    this.write();
    this.onTexture(this.texture);
    old?.dispose();
  }

  reset() {
    this.height.fill(0); this.velocity.fill(0); this.foam.fill(0);
    this.active = false;
    this.write();
  }

  /**
   * Push the water at a point: a smooth bump `radius` metres across and `amount` metres high (negative digs a dent).
   * Positions are in metres from the middle of the pool.
   */
  drop(x: number, z: number, radius: number, amount: number) {
    const cell = this.cell;
    const cells = Math.max(1.5, radius / cell);
    const cx = x / cell + this.middle, cz = z / cell + this.middle;
    const reach = Math.ceil(cells);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const gx = Math.round(cx) + dx, gz = Math.round(cz) + dz;
        const index = this.index(gx, gz);
        if (index < 0) continue;
        const distance = Math.hypot(gx - cx, gz - cz) / cells;
        if (distance >= 1) continue;
        this.height[index] += amount * (0.5 - 0.5 * Math.cos(Math.PI * (1 - distance)));
      }
    }
    this.active = true; this.dirty = true;
  }

  /** Lay foam over a disc: `amount` 0..1 is how much (it never goes down, only up to this). */
  addFoam(x: number, z: number, radius: number, amount: number) {
    const cell = this.cell;
    const cells = Math.max(1, radius / cell);
    const cx = x / cell + this.middle, cz = z / cell + this.middle;
    const reach = Math.ceil(cells);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const gx = Math.round(cx) + dx, gz = Math.round(cz) + dz;
        const index = this.index(gx, gz);
        if (index < 0) continue;
        const distance = Math.hypot(gx - cx, gz - cz) / cells;
        if (distance >= 1) continue;
        this.foam[index] = Math.max(this.foam[index], amount * (1 - distance * distance));
      }
    }
    this.active = true; this.dirty = true;
  }

  update(dt: number) {
    if (!this.active) { this.lastMilliseconds = 0; return; }
    const started = performance.now();
    const values = waterSettings.values;
    // The grid is stepped at a fixed, smooth rate whatever its size. How far a ripple travels in a step is set by the
    // wave's "Courant number" (speed x step / cell), kept under the limit of stability (0.707): a coarse grid just uses a
    // smaller share of it per step, so its ripples are blockier but move as smoothly and as fast as a fine grid's.
    const stepsPerSecond = this.hz;
    const stepSeconds = 1 / stepsPerSecond;
    const courant = Math.min(MAX_COURANT, values.rippleSpeed / (this.cell * stepsPerSecond));
    const gain = 4 * courant * courant;
    this.accumulator = Math.min(this.accumulator + dt, stepSeconds * MAX_STEPS_PER_FRAME);
    const damping = Math.pow(values.rippleDamping, REFERENCE_STEPS_PER_SECOND / stepsPerSecond);
    while (this.accumulator >= stepSeconds) { this.step(damping, gain); this.accumulator -= stepSeconds; this.dirty = true; }
    // Foam fades at its own rate, however many steps ran.
    const keep = Math.exp(-dt / values.foamLifetime);
    let live = 0;
    const foam = this.foam;
    for (let i = 0; i < foam.length; i++) { const f = foam[i]; if (f > 0) { const g = f * keep; foam[i] = g < 0.002 ? 0 : g; live += foam[i]; } }
    // The texture is rewritten whenever something changed (the grids that are cheap to rewrite are the ones that are small).
    if (this.dirty) { this.write(); this.dirty = false; }
    if (live === 0 && this.energy() < 1e-8) { this.active = false; this.height.fill(0); this.velocity.fill(0); this.write(); }
    this.lastMilliseconds = performance.now() - started;
  }

  private energy() {
    let sum = 0;
    const h = this.height;
    for (let i = 0; i < h.length; i++) sum += h[i] * h[i];
    return sum;
  }

  /** One step of the wave equation: each cell is pulled toward the average of its neighbours. */
  private step(damping: number, gain: number) {
    const n = this.cells, { height, velocity, sponge } = this;
    const from = this.wrap ? 0 : 1, to = this.wrap ? n : n - 1;
    for (let z = from; z < to; z++) {
      const up = (this.wrap ? (z + n - 1) % n : z - 1) * n, row = z * n, down = (this.wrap ? (z + 1) % n : z + 1) * n;
      for (let x = from; x < to; x++) {
        const left = this.wrap ? (x + n - 1) % n : x - 1, right = this.wrap ? (x + 1) % n : x + 1;
        const i = row + x;
        const average = (height[row + left] + height[row + right] + height[up + x] + height[down + x]) * 0.25;
        velocity[i] = (velocity[i] + (average - height[i]) * gain) * damping * (1 - sponge[i]);
      }
    }
    for (let i = 0; i < height.length; i++) height[i] += velocity[i];
  }

  /** Put the slope, height and foam into the texture. */
  private write() {
    const n = this.cells, cell = this.cell, { height, foam, pixels } = this;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        let left = i - 1, right = i + 1, up = i - n, down = i + n, run = 2, rows = 2;
        if (this.wrap) {
          left = z * n + (x + n - 1) % n; right = z * n + (x + 1) % n; up = ((z + n - 1) % n) * n + x; down = ((z + 1) % n) * n + x;
        } else {
          if (x === 0) { left = i; run = 1; } else if (x === n - 1) { right = i; run = 1; }
          if (z === 0) { up = i; rows = 1; } else if (z === n - 1) { down = i; rows = 1; }
        }
        const slopeX = (height[right] - height[left]) / (cell * run);
        const slopeZ = (height[down] - height[up]) / (cell * rows);
        const p = i * CHANNELS;
        pixels[p] = toHalfFloat(slopeX); pixels[p + 1] = toHalfFloat(slopeZ); pixels[p + 2] = toHalfFloat(height[i]); pixels[p + 3] = toHalfFloat(foam[i]);
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
