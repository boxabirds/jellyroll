/**
 * The smear of jelly left on the grass: a thin, wet ribbon in the jelly's own
 * colour, laid down only while it is touching the ground (which is exactly when
 * it is wearing away) and fading out over a few seconds.
 *
 * Points are kept in world coordinates and written to the vertex buffer
 * relative to the floating render origin each frame; the ribbon is short, so
 * that is a few hundred vertices.
 */
import * as THREE from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import type { Ball } from '../game/physics.ts';
import { terrainHeight, terrainNormal } from '../game/terrain.ts';

/** How a trail looks and lasts: the slime on grass is a short, wet, fading smear; the path in snow is a long, matt, slight groove. */
export type TrailLook = {
  maxPoints: number; spacing: number; halfWidth: number; lifetime: number; opacity: number; roughness: number; clearcoat: number; fadeExponent: number;
};
export const SLIME_LOOK: TrailLook = { maxPoints: 220, spacing: 0.4, halfWidth: 0.42, lifetime: 7, opacity: 0.42, roughness: 0.1, clearcoat: 0.7, fadeExponent: 1.6 };
export const SNOW_PATH_LOOK: TrailLook = { maxPoints: 420, spacing: 0.7, halfWidth: 0.5, lifetime: 30, opacity: 0.38, roughness: 0.95, clearcoat: 0, fadeExponent: 1.2 };
/** Moving further than this in one frame is a teleport (restart, test hook), not a roll. */
const MAX_POINT_GAP = 4;
/** Height above the ground function, clear of the terrain triangles' sag between vertices. */
const LIFT = 0.045;
const EDGE_EXPONENT = 0.7;
/** Pulls the ribbon toward the camera in depth so it never fights the grass. */
const DEPTH_OFFSET = -2;
const VERTICES_PER_POINT = 2;
const INDICES_PER_SEGMENT = 6;
/** Per vertex: time laid, side (-1 left edge, +1 right edge), strength (0 at a break). */
const META_SIZE = 3;

export class SlimeTrail {
  readonly mesh: THREE.Mesh;
  private readonly now = uniform(0);
  /** World-space ribbon vertices (Z kept in doubles; the GPU gets Z minus the origin). */
  private readonly worldX: Float64Array;
  private readonly worldY: Float64Array;
  private readonly worldZ: Float64Array;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;
  private readonly meta: Float32Array;
  private readonly look: TrailLook;
  private count = 0;
  private lastX = 0;
  private lastZ = 0;
  private laying = false;
  private readonly normal = { x: 0, y: 1, z: 0 };

  constructor(look: TrailLook = SLIME_LOOK) {
    this.look = look;
    const maxPoints = look.maxPoints;
    this.worldX = new Float64Array(maxPoints * VERTICES_PER_POINT);
    this.worldY = new Float64Array(maxPoints * VERTICES_PER_POINT);
    this.worldZ = new Float64Array(maxPoints * VERTICES_PER_POINT);
    this.positions = new Float32Array(maxPoints * VERTICES_PER_POINT * 3);
    this.normals = new Float32Array(maxPoints * VERTICES_PER_POINT * 3);
    this.colors = new Float32Array(maxPoints * VERTICES_PER_POINT * 3);
    this.meta = new Float32Array(maxPoints * VERTICES_PER_POINT * META_SIZE);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    geometry.setAttribute('slimeColor', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('slimeMeta', new THREE.BufferAttribute(this.meta, META_SIZE));
    const indices = new Uint16Array((maxPoints - 1) * INDICES_PER_SEGMENT);
    for (let i = 0, o = 0; i < maxPoints - 1; i++) {
      const a = i * VERTICES_PER_POINT;
      // Left/right of this point, then of the next; wound to face up.
      indices[o++] = a; indices[o++] = a + 1; indices[o++] = a + 2;
      indices[o++] = a + 1; indices[o++] = a + 3; indices[o++] = a + 2;
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);

    const material = new THREE.MeshPhysicalNodeMaterial({
      roughness: look.roughness, metalness: 0, clearcoat: look.clearcoat, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: DEPTH_OFFSET, polygonOffsetUnits: DEPTH_OFFSET,
    });
    const meta = attribute('slimeMeta', 'vec3');
    const age = this.now.sub(meta.x).div(look.lifetime).clamp(0, 1);
    const acrossFade = meta.y.mul(meta.y).oneMinus().max(0).pow(EDGE_EXPONENT);
    material.colorNode = attribute('slimeColor', 'vec3');
    material.opacityNode = age.oneMinus().pow(look.fadeExponent).mul(acrossFade).mul(meta.z).mul(look.opacity);
    this.mesh = new THREE.Mesh(geometry, material);
    // Rewritten every frame and always right behind the camera's subject.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Forget the whole trail (new run). */
  reset() {
    this.count = 0;
    this.laying = false;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  /**
   * @param time  seconds of play, the clock the fade runs on
   * @param tint  the jelly's current colour; the smear keeps the colour it was laid in
   * @param active whether to lay any now (the snow path only lays on snow)
   */
  update(ball: Ball, tint: THREE.Color, originZ: number, time: number, active = true) {
    this.now.value = time;
    const touching = ball.grounded && !ball.wornOut && active;
    const travelled = Math.hypot(ball.x - this.lastX, ball.z - this.lastZ);
    if (travelled > MAX_POINT_GAP) this.laying = false;
    if (touching && !this.laying) {
      // Touchdown: start a fresh stretch, invisible at its first point so
      // nothing bridges the gap from wherever the last stretch ended.
      this.lay(ball, tint, time, 0);
      this.laying = true;
    } else if (touching && travelled >= this.look.spacing) {
      this.lay(ball, tint, time, 1);
    } else if (!touching && this.laying) {
      // Lift-off: close the stretch with an invisible point.
      this.lay(ball, tint, time, 0);
      this.laying = false;
    }

    const { positions, worldX, worldY, worldZ } = this;
    const vertices = this.count * VERTICES_PER_POINT;
    for (let v = 0, p = 0; v < vertices; v++, p += 3) {
      positions[p] = worldX[v]; positions[p + 1] = worldY[v]; positions[p + 2] = worldZ[v] - originZ;
    }
    const geometry = this.mesh.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.setDrawRange(0, Math.max(0, this.count - 1) * INDICES_PER_SEGMENT);
    // Nothing to draw until there is at least one segment.
    this.mesh.visible = this.count > 1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /** Add one cross-section under the jelly, dropping the oldest if the ribbon is full. */
  private lay(ball: Ball, tint: THREE.Color, time: number, strength: number) {
    if (this.count === this.look.maxPoints) this.dropOldest();
    // Across the direction of travel; a stationary jelly smears across the slope instead.
    const speed = Math.hypot(ball.vx, ball.vz);
    const rightX = speed > 0 ? -ball.vz / speed : 1;
    const rightZ = speed > 0 ? ball.vx / speed : 0;
    const halfWidth = ball.radius * this.look.halfWidth;
    terrainNormal(ball.x, ball.z, this.normal);
    for (let side = 0; side < VERTICES_PER_POINT; side++) {
      const sign = side === 0 ? -1 : 1;
      const v = this.count * VERTICES_PER_POINT + side;
      const x = ball.x + rightX * halfWidth * sign;
      const z = ball.z + rightZ * halfWidth * sign;
      this.worldX[v] = x; this.worldZ[v] = z;
      this.worldY[v] = terrainHeight(x, z) + LIFT;
      this.normals[v * 3] = this.normal.x; this.normals[v * 3 + 1] = this.normal.y; this.normals[v * 3 + 2] = this.normal.z;
      this.colors[v * 3] = tint.r; this.colors[v * 3 + 1] = tint.g; this.colors[v * 3 + 2] = tint.b;
      this.meta[v * META_SIZE] = time; this.meta[v * META_SIZE + 1] = sign; this.meta[v * META_SIZE + 2] = strength;
    }
    this.count++;
    this.lastX = ball.x; this.lastZ = ball.z;
    const { attributes } = this.mesh.geometry;
    attributes.normal.needsUpdate = true; attributes.slimeColor.needsUpdate = true; attributes.slimeMeta.needsUpdate = true;
  }

  private dropOldest() {
    this.worldX.copyWithin(0, VERTICES_PER_POINT); this.worldY.copyWithin(0, VERTICES_PER_POINT); this.worldZ.copyWithin(0, VERTICES_PER_POINT);
    this.normals.copyWithin(0, VERTICES_PER_POINT * 3); this.colors.copyWithin(0, VERTICES_PER_POINT * 3);
    this.meta.copyWithin(0, VERTICES_PER_POINT * META_SIZE);
    this.count--;
  }
}
