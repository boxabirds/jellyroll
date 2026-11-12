/**
 * Draws the bees you have: each one small and fast, with a contrail behind it. The contrail is a ribbon: a strip of
 * triangles along the bee's recent path, turned to face the camera, that narrows and fades toward its tail. The bee
 * itself comes from bee-model.ts.
 */
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type { Ball } from '../game/physics.ts';
import { BEE_MAX } from '../game/tuning.ts';
import { beatWings, createBee, createBeeMaterials, type BeeModel } from './bee-model.ts';

/** How big a bee is drawn, relative to the model (which is a little under 30 cm). */
const SCALE = 3;
/** Points along a contrail, how often one is laid down (seconds), how wide the ribbon is at the bee, and how opaque. */
const TRAIL_POINTS = 24;
const POINT_GAP_SECONDS = 0.011;
/** Two ribbons cross each other, so the trail has body from any side (seen end-on, a single flat one would vanish). */
const RIBBONS_PER_BEE = 2;
const RIBBON_WIDTH = 0.13;
const RIBBON_OPACITY = 0.55;
/** How quickly the width and the opacity fall away along the tail (powers of the distance along it). */
const WIDTH_FALLOFF = 0.9;
const OPACITY_FALLOFF = 1.4;
const RIBBON_COLOR = '#fff6d8';
/** How quickly a bee turns to face the way it flies (1/s), and how far it tips nose-down per metre per second of climb. */
const TURN_RATE = 14;
const PITCH_PER_CLIMB = 0.03;
const MAX_PITCH = 0.6;
const BEAT_PHASE = 1.9;
const FACE_MIN_SPEED = 0.5;
const VERTICES_PER_POINT = 2;
const MAX_TRIANGLES = BEE_MAX * RIBBONS_PER_BEE * (TRAIL_POINTS - 1) * 2;

type Point = { x: number; y: number; z: number };

export class BeeFlock {
  readonly group = new THREE.Group();
  private readonly materials = createBeeMaterials();
  private readonly bees: BeeModel[] = [];
  private readonly heading: number[] = [];
  /** Each bee's recent path (world coordinates), newest at `head`, and how many points of it are real. */
  private readonly trails: Point[][] = [];
  private readonly head: number[] = [];
  private readonly filled: number[] = [];
  private readonly sinceLaid: number[] = [];
  private readonly ribbon: THREE.Mesh;
  /** Triangles of contrail drawn last frame (for checks). */
  trailTriangles = 0;
  /** The ribbons as a plain list of triangles (three vertices each): an indexed buffer that is rewritten every frame was never drawn. */
  private readonly positions = new Float32Array(MAX_TRIANGLES * 3 * 3);
  private readonly alphas = new Float32Array(MAX_TRIANGLES * 3);
  /** One ribbon's two edges, point by point, before they are cut into triangles. */
  private readonly edge = new Float32Array(TRAIL_POINTS * VERTICES_PER_POINT * 3);
  private readonly edgeAlpha = new Float32Array(TRAIL_POINTS * VERTICES_PER_POINT);
  private readonly along = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < BEE_MAX; i++) {
      const bee = createBee(this.materials);
      bee.scale.setScalar(SCALE);
      bee.visible = false;
      this.bees.push(bee);
      this.group.add(bee);
      this.heading.push(0);
      this.trails.push(Array.from({ length: TRAIL_POINTS }, () => ({ x: 0, y: 0, z: 0 })));
      this.head.push(0); this.filled.push(0); this.sinceLaid.push(0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('tAlpha', new THREE.BufferAttribute(this.alphas, 1));
    const material = new THREE.MeshBasicNodeMaterial({ color: RIBBON_COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.opacityNode = attribute('tAlpha', 'float') as unknown as Node<'float'>;
    this.ribbon = new THREE.Mesh(geometry, material);
    this.ribbon.frustumCulled = false;
    this.group.add(this.ribbon);
  }

  /** @param time seconds of play (for the wings), @param dt seconds since the last frame, @param camera the camera's position in render space */
  update(ball: Ball, originZ: number, time: number, dt: number, camera: THREE.Vector3) {
    const flock = ball.flock;
    let triangles = 0;
    for (let i = 0; i < BEE_MAX; i++) {
      const model = this.bees[i];
      const exists = i < flock.count;
      model.visible = exists;
      if (!exists) { this.filled[i] = 0; this.sinceLaid[i] = 0; continue; }
      const bee = flock.bees[i];
      const speed = Math.hypot(bee.vx, bee.vz);
      if (speed > FACE_MIN_SPEED) {
        const wanted = Math.atan2(-bee.vx, -bee.vz);
        let turn = wanted - this.heading[i];
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.heading[i] += turn * Math.min(1, TURN_RATE * dt);
      }
      model.position.set(bee.x, bee.y, bee.z - originZ);
      model.rotation.set(Math.max(-MAX_PITCH, Math.min(MAX_PITCH, bee.vy * PITCH_PER_CLIMB)), this.heading[i], 0, 'YXZ');
      beatWings(model, time, i * BEAT_PHASE);
      this.layPoint(i, bee.x, bee.y, bee.z, dt);
      triangles = this.writeRibbon(i, bee, originZ, camera, triangles);
    }
    const geometry = this.ribbon.geometry;
    this.trailTriangles = triangles;
    // Every triangle is always drawn: those not in use are flattened to nothing.
    this.positions.fill(0, triangles * 9);
    this.alphas.fill(0, triangles * 3);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.tAlpha.needsUpdate = true;
  }

  /** Record the bee's place now and then, in world coordinates (so a change of origin does not smear the trail). */
  private layPoint(i: number, x: number, y: number, z: number, dt: number) {
    this.sinceLaid[i] += dt;
    if (this.filled[i] > 0 && this.sinceLaid[i] < POINT_GAP_SECONDS) return;
    this.sinceLaid[i] = 0;
    const head = this.head[i] = (this.head[i] + 1) % TRAIL_POINTS;
    const point = this.trails[i][head];
    point.x = x; point.y = y; point.z = z;
    this.filled[i] = Math.min(TRAIL_POINTS, this.filled[i] + 1);
  }

  private readonly path = new Float32Array(TRAIL_POINTS * 3);

  /** Copy three of the ribbon's edge points into the next triangle. */
  private emit(triangle: number, corners: [number, number, number]): number {
    for (let c = 0; c < 3; c++) {
      const from = corners[c], to = triangle * 3 + c;
      this.positions[to * 3] = this.edge[from * 3]; this.positions[to * 3 + 1] = this.edge[from * 3 + 1]; this.positions[to * 3 + 2] = this.edge[from * 3 + 2];
      this.alphas[to] = this.edgeAlpha[from];
    }
    return triangle + 1;
  }

  /** Lay bee `i`'s ribbon into the buffers, starting at the bee itself so there is no gap, and return the triangle count so far. */
  private writeRibbon(i: number, bee: { x: number; y: number; z: number }, originZ: number, camera: THREE.Vector3, triangles: number): number {
    const count = this.filled[i];
    if (count < 2) return triangles;
    const trail = this.trails[i], path = this.path;
    // The path in render space: the bee now, then the recorded points, newest first.
    path[0] = bee.x; path[1] = bee.y; path[2] = bee.z - originZ;
    for (let k = 1; k < count; k++) {
      const point = trail[(this.head[i] - (k - 1) + TRAIL_POINTS) % TRAIL_POINTS];
      path[k * 3] = point.x; path[k * 3 + 1] = point.y; path[k * 3 + 2] = point.z - originZ;
    }
    const { along, toCamera, side } = this;
    for (let ribbon = 0; ribbon < RIBBONS_PER_BEE; ribbon++) {
      for (let k = 0; k < count; k++) {
        const ahead = Math.max(0, k - 1) * 3, behind = Math.min(count - 1, k + 1) * 3;
        along.set(path[ahead] - path[behind], path[ahead + 1] - path[behind + 1], path[ahead + 2] - path[behind + 2]);
        if (along.lengthSq() < 1e-8) along.set(0, 0, -1);
        toCamera.set(camera.x - path[k * 3], camera.y - path[k * 3 + 1], camera.z - path[k * 3 + 2]);
        // The first ribbon turns to face the camera; the second stands square to it.
        side.crossVectors(along, toCamera);
        if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
        side.normalize();
        if (ribbon === 1) side.crossVectors(along, side).normalize();
        const fade = 1 - k / (count - 1);
        const half = RIBBON_WIDTH * 0.5 * Math.pow(fade, WIDTH_FALLOFF);
        const v = k * VERTICES_PER_POINT;
        const x = path[k * 3], y = path[k * 3 + 1], z = path[k * 3 + 2];
        this.edge[v * 3] = x - side.x * half; this.edge[v * 3 + 1] = y - side.y * half; this.edge[v * 3 + 2] = z - side.z * half;
        this.edge[(v + 1) * 3] = x + side.x * half; this.edge[(v + 1) * 3 + 1] = y + side.y * half; this.edge[(v + 1) * 3 + 2] = z + side.z * half;
        const alpha = RIBBON_OPACITY * Math.pow(fade, OPACITY_FALLOFF);
        this.edgeAlpha[v] = alpha; this.edgeAlpha[v + 1] = alpha;
      }
      // Cut the strip into triangles: each step along it is a quad of two.
      for (let k = 0; k < count - 1; k++) {
        const l0 = k * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
        triangles = this.emit(triangles, [l0, l1, r0]);
        triangles = this.emit(triangles, [r0, l1, r1]);
      }
    }
    return triangles;
  }

  /** A new run: no old trails. */
  reset() {
    for (let i = 0; i < BEE_MAX; i++) { this.filled[i] = 0; this.sinceLaid[i] = 0; }
  }

  dispose() {
    this.ribbon.geometry.dispose();
    (this.ribbon.material as THREE.Material).dispose();
    this.group.traverse(object => { if (object instanceof THREE.Mesh && object !== this.ribbon) object.geometry.dispose(); });
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
