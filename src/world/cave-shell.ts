/**
 * Draws the cavern: its roof, and the mountainside over each of its mouths.
 *
 * The valley ends at a mountain, which is the ground itself (the banks rise into it: see CAVE_HILL_RISE), and a giant cave
 * opens in its foot. The roof is one grid that follows the jelly, rewritten as it moves on. The mountainside over a mouth
 * is a second grid whose bottom row is the very same points as the roof's first row, so the two are one surface with no
 * join to come apart: from that edge it climbs, craggy and leaning back, to the height of the banks either side and lies
 * on them. Nothing in it is a straight line or a regular curve.
 */
import * as THREE from 'three/webgpu';
import { mix, mx_noise_float, positionWorld, smoothstep, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { BIOME_LENGTH } from '../game/biomes.ts';
import { caveHalfSpan, caveStart, ceilingOver, floorRef } from '../game/cave.ts';
import { valueNoise2 } from '../game/noise.ts';
import { courseCenter, terrainHeight } from '../game/terrain.ts';
import { WORLD_SEED } from '../game/tuning.ts';

/** The roof grid: metres between rows, rows behind the jelly and ahead of it (far enough that its end is lost in the dark), and points across. */
const ROW = 6;
const ROWS_BEHIND = 6;
const ROWS_AHEAD = 78;
const ROWS = ROWS_BEHIND + ROWS_AHEAD;
const COLUMNS = 44;
/** The foot of the roof's walls is sunk this far below the floor's level, so no gap shows under it. */
const WALL_FOOT = 14;
/**
 * The mountainside over a mouth: its rows (the first is the roof's own edge), how far up the course it runs, how many
 * extra points it has either side of the roof's, and how far beyond the cavern's walls they reach (onto the banks).
 */
const FACE_ROWS = 30;
const FACE_DEPTH = 150;
const FACE_EXTRA = 7;
const FACE_OVERLAP = 34;
/** Rows are closer together near the mouth, where the face is steepest (a power of the way along). */
const FACE_ROW_BUNCHING = 1.7;
/** The rock over the roof is at least this thick. */
const ROCK_THICKNESS = 2.5;
/** Crags: the face is pushed up and down, and in and out, by this much, in lumps about this far across. */
const CRAG_HEIGHT = 5;
const CRAG_DEPTH = 5;
const CRAG_SPAN = 17;
const CRAG_FINE = 1.6;
const CRAG_FINE_SPAN = 5;
/** Where it lies on the banks it is sunk this far into them. */
const FACE_SINK = 0.7;
const SEED_FACE = WORLD_SEED + 271;
/** The mountainside is drawn from this far before its mouth to this far past it. */
const FACE_SEEN = 600;
/** The sheet of darkness seen in the mouth from outside: its colour, how far inside it stands, its size, and how far in the jelly is when it has gone. */
const DEPTHS_COLOR = '#05060b';
const DEPTHS_INSIDE = 95;
const DEPTHS_HEIGHT = 96;
const DEPTHS_MARGIN = 120;
const DEPTHS_GONE_BY = 22;
const ROOF_COLOR = [0.085, 0.082, 0.1] as const;
/** A little light of its own, so the roof is seen as rock and not as a black void. */
const ROOF_GLOW = [0.006, 0.012, 0.016] as const;
/** The mountain's rock: dark in its hollows and seams, paler on its faces, banded across. */
const ROCK_DARK = [0.1, 0.095, 0.09] as const;
const ROCK_MID = [0.24, 0.215, 0.185] as const;
const ROCK_PALE = [0.38, 0.34, 0.28] as const;

const FACE_COLUMNS = COLUMNS + 2 * FACE_EXTRA;

function gridIndices(rows: number, columns: number): number[] {
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c, b = a + 1, d = a + columns, e = d + 1;
      indices.push(a, b, d, b, e, d);
    }
  }
  return indices;
}

const noise = (a: number, b: number, salt: number) => (valueNoise2(a, b, SEED_FACE + salt) - 0.5) * 2;

export class CaveShell {
  readonly group = new THREE.Group();
  private readonly roof: THREE.Mesh;
  /** The mountainsides over the way in and the way out. */
  private readonly faces: THREE.Mesh[] = [];
  private readonly depths: THREE.Mesh;
  private readonly roofPositions = new Float32Array(ROWS * COLUMNS * 3);
  private readonly facePositions = [new Float32Array(FACE_ROWS * FACE_COLUMNS * 3), new Float32Array(FACE_ROWS * FACE_COLUMNS * 3)];
  private readonly edge = new Float32Array(COLUMNS * 3);
  private roofRow = Number.NaN;
  private roofOrigin = Number.NaN;
  private facesFor = Number.NaN;

  constructor() {
    const tone = (c: readonly number[]) => vec3(c[0], c[1], c[2]);
    const roofMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    roofMaterial.colorNode = mix(tone(ROOF_COLOR), tone(ROOF_COLOR).mul(1.7), mx_noise_float(positionWorld.mul(0.3)).mul(0.5).add(0.5)) as unknown as Node<'vec3'>;
    roofMaterial.emissiveNode = tone(ROOF_GLOW) as unknown as Node<'vec3'>;
    const roofGeometry = new THREE.BufferGeometry();
    roofGeometry.setAttribute('position', new THREE.BufferAttribute(this.roofPositions, 3));
    roofGeometry.setIndex(gridIndices(ROWS, COLUMNS));
    this.roof = new THREE.Mesh(roofGeometry, roofMaterial);
    this.roof.frustumCulled = false; this.roof.visible = false; this.group.add(this.roof);

    // Rock: broad patches of pale and mid stone, dark seams, and faint level bands, all from noise in the world.
    const faceMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const patches = mx_noise_float(positionWorld.mul(0.06)).mul(0.5).add(0.5);
    const grain = mx_noise_float(positionWorld.mul(0.7)).mul(0.5).add(0.5);
    const bands = mx_noise_float(vec3(positionWorld.y.mul(0.5), positionWorld.x.mul(0.03), positionWorld.z.mul(0.03))).mul(0.5).add(0.5);
    // Darker where the rock is in a hollow of the big lumps: soft-edged, so it reads as shade in the crags and not as drawn lines.
    const hollows = smoothstep(0.15, 0.75, mx_noise_float(positionWorld.mul(0.045).add(11)).mul(0.5).add(0.5));
    let rockColor = mix(tone(ROCK_MID), tone(ROCK_PALE), patches) as unknown as Node<'vec3'>;
    rockColor = rockColor.mul(grain.mul(0.35).add(0.8)).mul(bands.mul(0.3).add(0.85)) as unknown as Node<'vec3'>;
    faceMaterial.colorNode = mix(tone(ROCK_DARK), rockColor, hollows.mul(0.75).add(0.25)) as unknown as Node<'vec3'>;
    for (const positions of this.facePositions) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(gridIndices(FACE_ROWS, FACE_COLUMNS));
      const face = new THREE.Mesh(geometry, faceMaterial);
      face.frustumCulled = false; face.visible = false;
      this.faces.push(face); this.group.add(face);
    }
    this.depths = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({ color: DEPTHS_COLOR, fog: false, transparent: true, depthWrite: false }));
    this.depths.frustumCulled = false; this.depths.visible = false; this.group.add(this.depths);
  }

  update(worldZ: number, originZ: number) {
    const s = -worldZ;
    const start = caveStart(s), end = start + BIOME_LENGTH;
    const from = s - ROWS_BEHIND * ROW, to = s + ROWS_AHEAD * ROW;
    this.roof.visible = to > start && from < end;
    if (this.roof.visible) {
      const row = Math.floor(s / ROW);
      if (row !== this.roofRow || originZ !== this.roofOrigin) { this.roofRow = row; this.roofOrigin = originZ; this.buildRoof(row, start, end, originZ); }
    }
    // The darkness of the depths, while the jelly is outside the way in or only just inside it.
    const inside = s - start;
    this.depths.visible = inside > -FACE_SEEN && inside < DEPTHS_GONE_BY;
    if (this.depths.visible) {
      const at = start + DEPTHS_INSIDE;
      const centre = courseCenter(at);
      this.depths.position.set(centre, terrainHeight(centre, -at) + DEPTHS_HEIGHT / 2 - WALL_FOOT, -at - originZ);
      this.depths.scale.set(2 * caveHalfSpan(at) + DEPTHS_MARGIN, DEPTHS_HEIGHT, 1);
      (this.depths.material as THREE.MeshBasicNodeMaterial).opacity = Math.min(1, Math.max(0, 1 - inside / DEPTHS_GONE_BY));
    }
    const near = s > start - FACE_SEEN && s < end + FACE_SEEN;
    if (near && start !== this.facesFor) { this.facesFor = start; this.buildFace(0, start, 1); this.buildFace(1, end, -1); }
    for (const face of this.faces) { face.visible = near; face.position.z = -originZ; }
  }

  /** One row of the roof across the cavern at `s`, in world coordinates, written into `out` at `at`. The outermost points are the feet of the walls, sunk into the banks. */
  private roofRowAt(s: number, out: Float32Array, at: number) {
    const centre = courseCenter(s), half = caveHalfSpan(s);
    const floor = floorRef(s);
    for (let c = 0; c < COLUMNS; c++) {
      const x = centre + (c / (COLUMNS - 1) * 2 - 1) * half;
      const foot = c === 0 || c === COLUMNS - 1;
      out[at + c * 3] = x; out[at + c * 3 + 1] = foot ? floor - WALL_FOOT : ceilingOver(x, s, floor); out[at + c * 3 + 2] = -s;
    }
  }

  /** The roof's rows from just behind the jelly to well ahead, kept inside the cave (rows outside it collapse onto its ends). */
  private buildRoof(row: number, start: number, end: number, originZ: number) {
    const positions = this.roofPositions;
    for (let r = 0; r < ROWS; r++) {
      const s = Math.min(end, Math.max(start, (row - ROWS_BEHIND + r) * ROW));
      this.roofRowAt(s, positions, r * COLUMNS * 3);
    }
    for (let v = 2; v < positions.length; v += 3) positions[v] -= originZ;
    const geometry = this.roof.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /**
   * The mountainside over the mouth at `mouth`, running `direction` (+1 down the course, -1 back up it) over the cavern.
   * Its first row is the roof's edge, point for point. Above that it climbs to whichever is higher, the rock over the roof
   * or the line between the banks either side (which rise with the mountain), pushed about into crags; and its outer points
   * lie on the banks. In world coordinates.
   */
  private buildFace(which: number, mouth: number, direction: number) {
    const positions = this.facePositions[which], edge = this.edge;
    this.roofRowAt(mouth, edge, 0);
    for (let r = 0; r < FACE_ROWS; r++) {
      const along = r === 0 ? 0 : FACE_DEPTH * Math.pow((r - 1) / (FACE_ROWS - 2), FACE_ROW_BUNCHING);
      const s = mouth + direction * along;
      const centre = courseCenter(s), half = caveHalfSpan(s), reach = half + FACE_OVERLAP;
      const floor = floorRef(s);
      const left = terrainHeight(centre - reach, -s), right = terrainHeight(centre + reach, -s);
      // How much of the crags there is yet: none on the roof's own edge, all of it a little way up.
      const rough = Math.min(1, r / 3);
      for (let c = 0; c < FACE_COLUMNS; c++) {
        const v = (r * FACE_COLUMNS + c) * 3;
        const inner = c - FACE_EXTRA;
        let x: number, y: number, z = -s;
        if (inner >= 0 && inner < COLUMNS) {
          if (r === 0) { positions[v] = edge[inner * 3]; positions[v + 1] = edge[inner * 3 + 1]; positions[v + 2] = edge[inner * 3 + 2]; continue; }
          const u = (inner / (COLUMNS - 1) * 2 - 1) * half;
          x = centre + u;
          const across = (u + reach) / (2 * reach);
          const banks = left + (right - left) * across;
          y = Math.max(banks, ceilingOver(x, s, floor) + ROCK_THICKNESS);
        } else {
          // Beyond the cavern's walls: out onto the bank, and down into it at the very edge.
          const k = inner < 0 ? -inner : inner - COLUMNS + 1;
          const u = Math.sign(inner) * (half + (k / FACE_EXTRA) * FACE_OVERLAP);
          x = centre + u;
          y = terrainHeight(x, -s) - FACE_SINK * (k / FACE_EXTRA) + (r === 0 ? -WALL_FOOT * (1 - k / FACE_EXTRA) : 0);
          if (r === 0 || k === FACE_EXTRA) { positions[v] = x; positions[v + 1] = y; positions[v + 2] = z; continue; }
        }
        // Crags: lumps big and small, up and down and in and out.
        y += rough * (noise(x / CRAG_SPAN, s / CRAG_SPAN, 1) * CRAG_HEIGHT + noise(x / CRAG_FINE_SPAN, y / CRAG_FINE_SPAN, 2) * CRAG_FINE);
        z += rough * direction * -1 * noise(x / CRAG_SPAN, y / CRAG_SPAN, 3) * CRAG_DEPTH;
        positions[v] = x; positions[v + 1] = y; positions[v + 2] = z;
      }
    }
    const geometry = this.faces[which].geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  invalidate() {
    this.roofRow = Number.NaN; this.facesFor = Number.NaN;
  }

  dispose() {
    this.depths.geometry.dispose(); (this.depths.material as THREE.Material).dispose();
    for (const mesh of [this.roof, ...this.faces]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
  }
}
