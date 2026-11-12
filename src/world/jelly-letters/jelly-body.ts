/*
 * Ported from the owner's unixjelly project (GPL-3.0), src/engine/shell.html `JellyBody`, itself a port of Jelly Baby's soft
 * body by Scott Sun (GPL-3.0-only; see NOTICE.md): one squishy letter, a tetrahedral cage solved with XPBD (shear and volume
 * together, plus a collapse barrier), friction on the floor, resting and sleeping. Changes: typed; grabbing and carrying are
 * left out (nothing here is dragged); sounds are reported to the stage as events; the skin is drawn with the game's renderer.
 */
import * as THREE from 'three/webgpu';
import { inside, makeLetter } from './letter-geometry.ts';
import type { Point } from './letter-geometry.ts';

export const PHYS = { density: 1050, shear: 1200, bulk: 65000, damping: 3, gravity: 3.2, step: 1 / 240, iterations: 3, staticFriction: 0.65, dynamicFriction: 0.42, restitution: 0.065 };
/** Cage cells across one letter size: fewer is cheaper and stiffer. */
const CELLS = 6.5;
const MIN_CELLS_DEEP = 2;
/** Air drag, as a rate. */
const AIR_DRAG = 0.025;
/** A tetrahedron may not collapse below this share of its volume. */
const BARRIER = 0.25;
/** Landing: the slowest fall that bounces at all, and the share of the fall speed that comes back. */
const BOUNCE_FROM = 0.18;
/** A landing at least this fast (m/s) is a thud worth reporting. */
const THUD_FROM = 0.45;
const THUD_GAP_MS = 220;
/** A landing this fast (m/s) is a full-strength thud. */
const THUD_FULL = 1.5;
/** Wobble damping along the edges, as a share of the rate. */
const EDGE_DAMPING = 0.35;
/** Held up and slower than this (m/s rms): the last rocking is slowed hard. Still for QUIET_SECONDS: asleep. */
const SETTLE_SPEED = 0.03;
const SLEEP_SPEED = 0.005;
const QUIET_SECONDS = 0.45;
/** Tall thin letters topple; one lying down for this long stands back up. */
export const STAND_UP_AFTER = 1.1;
/** A fallen letter is flatter than this share of its height. */
const FALLEN_SHARE = 0.75;
/** A letter on the floor is eased towards its place in the word (a soft spring on its middle along and across the floor), so wide letters that bounce sideways when they land do not wander into their neighbours. */
const HOME_STIFFNESS = 40;
const HOME_DAMPING = 14;
/** Letters narrower than this share of their height are weighted at the bottom (the lowest share of the letter), by this much per unit of slimness. */
const SLIM_BELOW = 0.7;
const SLIM_WEIGHT = 25;
const HEAVY_BOTTOM = 0.3;
/** Letters that stand on a rounded tail get a heavy bottom too. */
const TAILED = 'GJPQY';
const TAIL_WEIGHT = 6;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const det3 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
function inv3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m, s = 1 / det3(a, b, c, d, e, f, g, h, i);
  return [(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s, (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s, (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s];
}

const PERMS = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];

interface Element { ids: number[]; o: number[]; vol: number; g: Float64Array; lD: number; lH: number; lB: number }
export interface Stage {
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Seconds of stage time. */
  t: number;
  /** A letter landed hard enough to hear (strength 0..1). */
  onThud: (strength: number) => void;
}

export class JellyBody {
  readonly character: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** Where the letter stands: x of its middle. */
  cx: number;
  readonly homeX: number;
  readonly cell: number;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly N: number;
  rest: Float64Array;
  restMean: number[];
  x: Float64Array; prev: Float64Array; v: Float64Array;
  mass: Float64Array; inv: Float64Array; nodalVolume: Float64Array;
  normal: Float64Array; incoming: Float64Array; nodalF: Float64Array;
  F = new Float64Array(9); dg = new Float64Array(12); hg = new Float64Array(12); co = new Float64Array(9);
  elements: Element[] = [];
  edges: [number, number][] = [];
  totalMass = 0;
  sleeping = false;
  /** Seconds asleep (the stage stands a toppled letter up after a while), and seconds awake since it last was put down. */
  restTime = 0;
  activeTime = 0;
  quiet = 0;
  spawnAt = 0;
  grounded = false;
  dirty = true;
  rms = 0;
  lo: number[] = [0, 0, 0];
  hi: number[] = [0, 0, 0];
  visible = true;
  private lastThud = Number.NEGATIVE_INFINITY;
  private bIds: Int32Array;
  private bW: Float32Array;
  private restNormals: Float32Array;
  private readonly stage: Stage;
  private readonly bind: (px: number, py: number, pz: number) => [number, number][];

  constructor(stage: Stage, character: string, material: THREE.Material, cx: number, size: number) {
    const letter = makeLetter(character, size), geometry = letter.geometry, box = letter.box, polys: Point[][] = letter.polygons;
    this.stage = stage; this.character = character; this.size = size; this.cx = cx; this.homeX = cx;
    this.width = box.max.x - box.min.x; this.height = box.max.y;
    const dx = box.max.x - box.min.x, dy = box.max.y - box.min.y, dz = box.max.z - box.min.z, cell = this.cell = size / CELLS;
    const nx = Math.max(1, Math.round(dx / cell)), ny = Math.max(1, Math.round(dy / cell)), nz = Math.max(MIN_CELLS_DEEP, Math.round(dz / cell));
    const sx = dx / nx, sy = dy / ny, sz = dz / nz, ox = box.min.x, oy = box.min.y, oz = box.min.z;
    const col = (v: number, o: number, s: number, n: number) => clamp(Math.floor((v - o) / s), 0, n - 1);
    const occupied = new Uint8Array(nx * ny), P = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < P.length; i += 3) occupied[col(P[i], ox, sx, nx) + col(P[i + 1], oy, sy, ny) * nx] = 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      for (const [a, b] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]]) {
        if (inside(polys, ox + (i + a) * sx, oy + (j + b) * sy)) occupied[i + j * nx] = 1;
      }
    }
    const index = new Map<number, number>(), rest: number[] = [];
    const node = (i: number, j: number, k: number) => {
      const key = i + (nx + 1) * (j + (ny + 1) * k);
      let id = index.get(key);
      if (id === undefined) { id = rest.length / 3; index.set(key, id); rest.push(ox + i * sx, oy + j * sy, oz + k * sz); }
      return id;
    };
    const corners = (i: number, j: number, k: number) => [0, 1, 2, 3, 4, 5, 6, 7].map(b => node(i + (b & 1), j + (b >> 1 & 1), k + (b >> 2 & 1)));
    const tets: number[][] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!occupied[i + j * nx]) continue;
      for (let k = 0; k < nz; k++) {
        const c = corners(i, j, k);
        for (const [A, B] of PERMS) tets.push([c[0], c[1 << A], c[(1 << A) | (1 << B)], c[7]]);
      }
    }
    const nearest = (i: number, j: number): [number, number] => {
      if (occupied[i + j * nx]) return [i, j];
      let best: [number, number] = [0, 0], bestDistance = Infinity;
      for (let jj = 0; jj < ny; jj++) for (let ii = 0; ii < nx; ii++) {
        if (!occupied[ii + jj * nx]) continue;
        const d = (ii - i) ** 2 + (jj - j) ** 2;
        if (d < bestDistance) { bestDistance = d; best = [ii, jj]; }
      }
      return best;
    };
    // Each surface point rides inside one Kuhn tetrahedron of its cage cell (dense four-node embedding).
    this.bind = (px, py, pz) => {
      const [i, j] = nearest(col(px, ox, sx, nx), col(py, oy, sy, ny)), k = col(pz, oz, sz, nz);
      const u = [clamp((px - ox) / sx - i, 0, 1), clamp((py - oy) / sy - j, 0, 1), clamp((pz - oz) / sz - k, 0, 1)];
      const [A, B, C] = [0, 1, 2].sort((a, b) => u[b] - u[a]), c = corners(i, j, k);
      return [[c[0], 1 - u[A]], [c[1 << A], u[A] - u[B]], [c[(1 << A) | (1 << B)], u[B] - u[C]], [c[7], u[C]]];
    };

    const N = this.N = rest.length / 3;
    this.rest = Float64Array.from(rest);
    this.restMean = [0, 1, 2].map(k => rest.reduce((a, v, i) => i % 3 === k ? a + v / N : a, 0));
    this.x = new Float64Array(N * 3); this.prev = new Float64Array(N * 3); this.v = new Float64Array(N * 3);
    this.mass = new Float64Array(N); this.inv = new Float64Array(N); this.nodalVolume = new Float64Array(N);
    this.normal = new Float64Array(N); this.incoming = new Float64Array(N); this.nodalF = new Float64Array(N * 9);
    const seen = new Set<number>(), p = this.rest;
    for (const t of tets) {
      let ids = t, o = ids.map(v => v * 3);
      const dmOf = (q: number[]) => [p[q[1]] - p[q[0]], p[q[2]] - p[q[0]], p[q[3]] - p[q[0]], p[q[1] + 1] - p[q[0] + 1], p[q[2] + 1] - p[q[0] + 1], p[q[3] + 1] - p[q[0] + 1], p[q[1] + 2] - p[q[0] + 2], p[q[2] + 2] - p[q[0] + 2], p[q[3] + 2] - p[q[0] + 2]];
      let dm = dmOf(o);
      if (det3(dm[0], dm[1], dm[2], dm[3], dm[4], dm[5], dm[6], dm[7], dm[8]) < 0) { ids = [ids[0], ids[1], ids[3], ids[2]]; o = ids.map(v => v * 3); dm = dmOf(o); }
      const vol = det3(dm[0], dm[1], dm[2], dm[3], dm[4], dm[5], dm[6], dm[7], dm[8]) / 6, inverse = inv3(dm), g = new Float64Array(12);
      for (let k = 0; k < 3; k++) { g[3 + k] = inverse[k]; g[6 + k] = inverse[3 + k]; g[9 + k] = inverse[6 + k]; g[k] = -inverse[k] - inverse[3 + k] - inverse[6 + k]; }
      this.elements.push({ ids, o, vol, g, lD: 0, lH: 0, lB: 0 });
      for (const id of ids) { this.mass[id] += PHYS.density * vol / 4; this.nodalVolume[id] += vol; }
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const lo = Math.min(ids[a], ids[b]), hi = Math.max(ids[a], ids[b]), key = lo * 100000 + hi;
        if (!seen.has(key)) { seen.add(key); this.edges.push([lo, hi]); }
      }
    }
    // Tall, thin letters (like I and L) tip over easily. A heavier bottom keeps them standing, like a weighted toy. (From
    // the Unix Jelly guides' fix, as is the same cure for letters that stand on a rounded tail.)
    const slim = dx / box.max.y;
    const bottom = (i: number) => rest[i * 3 + 1] < oy + dy * HEAVY_BOTTOM;
    if (slim < SLIM_BELOW) { for (let i = 0; i < N; i++) if (bottom(i)) this.mass[i] *= 1 + SLIM_WEIGHT * (SLIM_BELOW - slim); }
    else if (TAILED.includes(character)) { for (let i = 0; i < N; i++) if (bottom(i)) this.mass[i] *= TAIL_WEIGHT; }
    for (let i = 0; i < N; i++) this.inv[i] = 1 / this.mass[i];
    this.totalMass = this.mass.reduce((a, b) => a + b, 0);

    const V = P.length / 3;
    this.bIds = new Int32Array(V * 4); this.bW = new Float32Array(V * 4);
    for (let v = 0; v < V; v++) {
      const b = this.bind(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      for (let q = 0; q < 4; q++) { this.bIds[v * 4 + q] = b[q][0]; this.bW[v * 4 + q] = b[q][1]; }
    }
    this.restNormals = Float32Array.from(geometry.attributes.normal.array as Float32Array);
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  /** Put the letter standing at its place, `drop` metres up, turned by `tilt`, at rest. */
  place(drop: number, tilt: number) {
    const c = Math.cos(tilt), s = Math.sin(tilt), cy = this.height / 2;
    for (let i = 0; i < this.N; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1] - cy;
      this.x[i * 3] = this.cx + x * c - y * s; this.x[i * 3 + 1] = cy + drop + x * s + y * c; this.x[i * 3 + 2] = this.rest[i * 3 + 2];
    }
    this.prev.set(this.x); this.v.fill(0); this.wake(); this.updateBox();
    this.activeTime = 0; this.restTime = 0;
  }
  wake() { this.sleeping = false; this.quiet = 0; }

  updateBox() {
    const x = this.x, lo = this.lo, hi = this.hi;
    lo.fill(Infinity); hi.fill(-Infinity);
    for (let i = 0; i < x.length; i += 3) for (let k = 0; k < 3; k++) { const v = x[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  }
  /** Tall thin letters topple. */
  isFallen(): boolean {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.N; i++) { const y = this.x[i * 3 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    return hi - lo < this.height * FALLEN_SHARE;
  }
  /** How far the letter's middle is from where it belongs (along the row and across it), in metres. */
  displacement(): number {
    const c = this.center();
    return Math.hypot(c[0] - (this.homeX + this.restMean[0]), c[2] - this.restMean[2]);
  }
  center(): [number, number, number] {
    const c: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < this.N; i++) for (let k = 0; k < 3; k++) c[k] += this.x[i * 3 + k] / this.N;
    return c;
  }
  /** A small hop, a little spin: the refusal wobble. */
  hop(power = 1) {
    this.wake();
    const spin = (Math.random() - 0.5) * 6 * power * Math.min(1, this.width / this.height);
    let cy = 0; for (let i = 0; i < this.N; i++) cy += this.x[i * 3 + 1] / this.N;
    for (let i = 0; i < this.N; i++) { this.v[i * 3 + 1] += 0.55 * power; this.v[i * 3] += (this.x[i * 3 + 1] - cy) * spin; }
  }
  visibleNow(on: boolean) {
    if (this.visible === on) return;
    this.visible = on; this.mesh.visible = on;
  }

  private deformation(e: Element): Float64Array {
    const x = this.x, g = e.g, f = this.F, a = e.o[0], b = e.o[1], c = e.o[2], d = e.o[3];
    const bx = x[b] - x[a], by = x[b + 1] - x[a + 1], bz = x[b + 2] - x[a + 2];
    const cx = x[c] - x[a], cy = x[c + 1] - x[a + 1], cz = x[c + 2] - x[a + 2];
    const dx = x[d] - x[a], dy = x[d + 1] - x[a + 1], dz = x[d + 2] - x[a + 2];
    f[0] = bx * g[3] + cx * g[6] + dx * g[9]; f[1] = bx * g[4] + cx * g[7] + dx * g[10]; f[2] = bx * g[5] + cx * g[8] + dx * g[11];
    f[3] = by * g[3] + cy * g[6] + dy * g[9]; f[4] = by * g[4] + cy * g[7] + dy * g[10]; f[5] = by * g[5] + cy * g[8] + dy * g[11];
    f[6] = bz * g[3] + cz * g[6] + dz * g[9]; f[7] = bz * g[4] + cz * g[7] + dz * g[10]; f[8] = bz * g[5] + cz * g[8] + dz * g[11];
    return f;
  }
  /** W = mu/2 (|F|^2 - 3) + K/2 (J - 1 - mu/K)^2, both constraints solved together (as in Jelly Baby). */
  private solveElastic(e: Element, h: number) {
    const f = this.deformation(e), g = e.g, dg = this.dg, hg = this.hg;
    let norm = 0; for (let k = 0; k < 9; k++) norm += f[k] * f[k]; norm = Math.sqrt(norm);
    if (norm < 1e-12) return;
    const a = f[0], b = f[1], c = f[2], d = f[3], ee = f[4], ff = f[5], gg = f[6], hh = f[7], ii = f[8];
    const c0 = ee * ii - ff * hh, c1 = ff * gg - d * ii, c2 = d * hh - ee * gg;
    const c3 = c * hh - b * ii, c4 = a * ii - c * gg, c5 = b * gg - a * hh;
    const c6 = b * ff - c * ee, c7 = c * d - a * ff, c8 = a * ee - b * d, J = a * c0 + b * c1 + c * c2;
    const alphaD = 1 / (PHYS.shear * e.vol * h * h), alphaH = 1 / (PHYS.bulk * e.vol * h * h);
    let dd = alphaD, hm = alphaH, dh = 0;
    for (let v = 0; v < 4; v++) {
      const j = v * 3, x = g[j], y = g[j + 1], z = g[j + 2], w = this.inv[e.ids[v]];
      dg[j] = (a * x + b * y + c * z) / norm; dg[j + 1] = (d * x + ee * y + ff * z) / norm; dg[j + 2] = (gg * x + hh * y + ii * z) / norm;
      hg[j] = c0 * x + c1 * y + c2 * z; hg[j + 1] = c3 * x + c4 * y + c5 * z; hg[j + 2] = c6 * x + c7 * y + c8 * z;
      for (let k = 0; k < 3; k++) { dd += w * dg[j + k] ** 2; hm += w * hg[j + k] ** 2; dh += w * dg[j + k] * hg[j + k]; }
    }
    const rd = -norm - alphaD * e.lD, rh = -(J - 1 - PHYS.shear / PHYS.bulk) - alphaH * e.lH, den = dd * hm - dh * dh;
    const dlD = (rd * hm - rh * dh) / den, dlH = (rh * dd - rd * dh) / den;
    e.lD += dlD; e.lH += dlH;
    for (let v = 0; v < 4; v++) {
      const i = e.o[v], j = v * 3, w = this.inv[e.ids[v]];
      for (let k = 0; k < 3; k++) this.x[i + k] += w * (dlD * dg[j + k] + dlH * hg[j + k]);
    }
  }
  /** Keeps every tetrahedron from collapsing below a quarter of its volume. */
  private solveBarrier(e: Element) {
    const f = this.deformation(e), g = e.g, out = this.dg, co = this.co;
    const a = f[0], b = f[1], c = f[2], d = f[3], ee = f[4], ff = f[5], gg = f[6], hh = f[7], ii = f[8];
    const J = a * (ee * ii - ff * hh) + b * (ff * gg - d * ii) + c * (d * hh - ee * gg);
    if (J >= BARRIER && e.lB === 0) return;
    co[0] = ee * ii - ff * hh; co[1] = ff * gg - d * ii; co[2] = d * hh - ee * gg;
    co[3] = c * hh - b * ii; co[4] = a * ii - c * gg; co[5] = b * gg - a * hh;
    co[6] = b * ff - c * ee; co[7] = c * d - a * ff; co[8] = a * ee - b * d;
    let den = 0;
    for (let v = 0; v < 4; v++) {
      const j = v * 3, w = this.inv[e.ids[v]];
      for (let k = 0; k < 3; k++) { out[j + k] = co[k * 3] * g[j] + co[k * 3 + 1] * g[j + 1] + co[k * 3 + 2] * g[j + 2]; den += w * out[j + k] ** 2; }
    }
    if (den < 1e-15) return;
    const next = Math.max(0, e.lB - (J - BARRIER) / den), delta = next - e.lB; e.lB = next;
    for (let v = 0; v < 4; v++) for (let k = 0; k < 3; k++) this.x[e.o[v] + k] += this.inv[e.ids[v]] * delta * out[v * 3 + k];
  }
  private solveContacts() {
    const x = this.x, B = this.stage.bounds;
    for (let i = 0; i < this.N; i++) {
      const j = i * 3;
      if (x[j + 1] < 0) { this.normal[i] -= x[j + 1]; x[j + 1] = 0; }
      x[j] = clamp(x[j], B.x0, B.x1); x[j + 2] = clamp(x[j + 2], B.z0, B.z1);
    }
  }

  /** Predict: everything moves on, and falls. False when asleep. */
  begin(h: number): boolean {
    if (this.sleeping) return false;
    const x = this.x, v = this.v, old = this.prev, N3 = this.N * 3;
    old.set(x); this.normal.fill(0);
    const air = Math.exp(-AIR_DRAG * h);
    for (let i = 0; i < N3; i++) v[i] *= air;
    for (let i = 1; i < N3; i += 3) v[i] -= PHYS.gravity * h;
    if (this.grounded) this.pullHome(h);
    for (let i = 0; i < this.N; i++) this.incoming[i] = v[i * 3 + 1];
    for (let i = 0; i < N3; i++) x[i] += v[i] * h;
    for (const e of this.elements) e.lD = e.lH = e.lB = 0;
    return true;
  }
  /** Spring the letter's middle (and damp its drift) towards its place along and across the floor, leaving its wobble alone. */
  private pullHome(h: number) {
    const v = this.v, x = this.x, N = this.N;
    let mx = 0, mz = 0, mvx = 0, mvz = 0;
    for (let i = 0; i < N; i++) { const j = i * 3; mx += x[j]; mz += x[j + 2]; mvx += v[j]; mvz += v[j + 2]; }
    mx /= N; mz /= N; mvx /= N; mvz /= N;
    const dvx = ((this.homeX + this.restMean[0] - mx) * HOME_STIFFNESS - mvx * HOME_DAMPING) * h;
    const dvz = ((this.restMean[2] - mz) * HOME_STIFFNESS - mvz * HOME_DAMPING) * h;
    for (let i = 0; i < N; i++) { v[i * 3] += dvx; v[i * 3 + 2] += dvz; }
  }
  /** One solver pass: pull back towards the letter's shape. */
  iterate(h: number, pass: number) {
    const E = this.elements, n = E.length;
    for (let q = 0; q < n; q++) { const e = E[(pass & 1) ? n - 1 - q : q]; this.solveElastic(e, h); this.solveBarrier(e); }
    this.solveContacts();
  }
  /** Turn the solved positions into velocities; friction, landing, damping, settling and sleeping. */
  finish(h: number) {
    const x = this.x, v = this.v, old = this.prev, N3 = this.N * 3;
    let grounded = false; this.grounded = false;
    for (let i = 0; i < this.N; i++) {
      if (this.normal[i] <= 0) continue;
      grounded = true;
      const j = i * 3, dx = x[j] - old[j], dz = x[j + 2] - old[j + 2], t = Math.hypot(dx, dz), nrm = this.normal[i];
      const fr = t < PHYS.staticFriction * nrm ? 1 : Math.min(1, PHYS.dynamicFriction * nrm / (t + 1e-20));
      x[j] -= dx * fr; x[j + 2] -= dz * fr;
    }
    for (let i = 0; i < N3; i++) v[i] = (x[i] - old[i]) / h;
    let impact = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.normal[i] > 0 && this.incoming[i] < 0) {
        const vy = v[i * 3 + 1], inc = this.incoming[i], bounce = inc < -BOUNCE_FROM ? -inc * PHYS.restitution : 0;
        v[i * 3 + 1] += Math.max(0, bounce - vy); impact = Math.min(impact, inc);
      }
    }
    const now = performance.now();
    if (impact < -THUD_FROM && now - this.lastThud > THUD_GAP_MS) { this.lastThud = now; this.stage.onThud(Math.min(1, -impact / THUD_FULL)); }
    // Equal and opposite axial viscosity: dissipates wobble without slowing the whole letter.
    const damp = 1 - Math.exp(-PHYS.damping * h * EDGE_DAMPING);
    for (const [a, b] of this.edges) {
      const ia = a * 3, ib = b * 3, dx = x[ib] - x[ia], dy = x[ib + 1] - x[ia + 1], dz = x[ib + 2] - x[ia + 2], len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      const nx = dx / len, ny = dy / len, nz = dz / len, rel = (v[ib] - v[ia]) * nx + (v[ib + 1] - v[ia + 1]) * ny + (v[ib + 2] - v[ia + 2]) * nz;
      const imp = rel * damp / (this.inv[a] + this.inv[b]), sa = imp * this.inv[a], sb = imp * this.inv[b];
      v[ia] += sa * nx; v[ia + 1] += sa * ny; v[ia + 2] += sa * nz; v[ib] -= sb * nx; v[ib + 1] -= sb * ny; v[ib + 2] -= sb * nz;
    }
    let energy = 0; for (let i = 0; i < this.N; i++) energy += 0.5 * this.mass[i] * (v[i * 3] ** 2 + v[i * 3 + 1] ** 2 + v[i * 3 + 2] ** 2);
    const rms = Math.sqrt(2 * energy / this.totalMass), held = grounded;
    this.grounded = grounded; this.rms = rms;
    // A letter held up and nearly still is slowed hard, so the last slow rocking dies away in about a second.
    if (held && rms < SETTLE_SPEED) { const k = Math.exp(-5 * h); for (let i = 0; i < N3; i++) v[i] *= k; }
    this.quiet = held && rms < SLEEP_SPEED ? this.quiet + h : 0;
    if (this.quiet > QUIET_SECONDS) { this.sleeping = true; v.fill(0); }
    this.dirty = true; this.updateBox();
    if (!Number.isFinite(x[0])) this.place(0.05, 0);
  }

  /** Move the drawn skin (and its normals) to follow the cage. */
  updateSurface() {
    const nF = this.nodalF; nF.fill(0);
    for (const e of this.elements) {
      const f = this.deformation(e);
      for (let q = 0; q < 4; q++) { const id = e.ids[q], w = e.vol / this.nodalVolume[id], o = id * 9; for (let k = 0; k < 9; k++) nF[o + k] += f[k] * w; }
    }
    const p = this.geometry.attributes.position.array as Float32Array, nr = this.geometry.attributes.normal.array as Float32Array;
    const ids = this.bIds, W = this.bW, rest = this.restNormals, x = this.x;
    for (let i = 0, j = 0; i < p.length; i += 3, j += 4) {
      const i0 = ids[j] * 3, i1 = ids[j + 1] * 3, i2 = ids[j + 2] * 3, i3 = ids[j + 3] * 3, w0 = W[j], w1 = W[j + 1], w2 = W[j + 2], w3 = W[j + 3];
      p[i] = x[i0] * w0 + x[i1] * w1 + x[i2] * w2 + x[i3] * w3;
      p[i + 1] = x[i0 + 1] * w0 + x[i1 + 1] * w1 + x[i2 + 1] * w2 + x[i3 + 1] * w3;
      p[i + 2] = x[i0 + 2] * w0 + x[i1 + 2] * w1 + x[i2 + 2] * w2 + x[i3 + 2] * w3;
      const m0 = ids[j] * 9, m1 = ids[j + 1] * 9, m2 = ids[j + 2] * 9, m3 = ids[j + 3] * 9;
      const F = (k: number) => nF[m0 + k] * w0 + nF[m1 + k] * w1 + nF[m2 + k] * w2 + nF[m3 + k] * w3;
      const a = F(0), b = F(1), c = F(2), d = F(3), e = F(4), f = F(5), g = F(6), h = F(7), q = F(8), nx = rest[i], ny = rest[i + 1], nz = rest[i + 2];
      const ox = (e * q - f * h) * nx + (f * g - d * q) * ny + (d * h - e * g) * nz;
      const oy = (c * h - b * q) * nx + (a * q - c * g) * ny + (b * g - a * h) * nz;
      const oz = (b * f - c * e) * nx + (c * d - a * f) * ny + (a * e - b * d) * nz;
      const inv = 1 / (Math.hypot(ox, oy, oz) || 1);
      nr[i] = ox * inv; nr[i + 1] = oy * inv; nr[i + 2] = oz * inv;
    }
    this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.normal.needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.geometry.dispose();
  }
}
