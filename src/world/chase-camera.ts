/**
 * Follows the jelly from behind and above. All smoothing is done in world
 * coordinates; the render origin is only subtracted when the camera is posed.
 */
import * as THREE from 'three/webgpu';
import { clamp } from '../game/noise.ts';
import type { Ball } from '../game/physics.ts';
import { courseDrift, terrainHeight } from '../game/terrain.ts';
import { HEADING_MIN_SPEED, START_RADIUS } from '../game/tuning.ts';
import { VIEW_DISTANCE } from './terrain-mesh.ts';

const NEAR = 0.3;
const FAR = VIEW_DISTANCE * 1.5;
const FOV_SLOW = 56;
const FOV_FAST = 72;
/** Speed (m/s) at which the camera is fully pulled back and widened. */
const FAST_SPEED = 42;
const DISTANCE_SLOW = 4.6;
const DISTANCE_FAST = 6.6;
const HEIGHT_SLOW = 1.9;
const HEIGHT_FAST = 2.9;
const LOOK_AHEAD = 6;
const LOOK_HEIGHT = 0.9;
/** Keep the lens this far above the ground under it. */
const GROUND_CLEARANCE = 1.1;
/** How much the camera heading favours the course over the jelly's own velocity. */
const COURSE_BIAS = 0.35;
const HEADING_RATE = 2.6;
const POSITION_RATE = 16;
const HEIGHT_RATE = 4;
const ZOOM_RATE = 1.6;
/** The rig scales with the jelly so a grown one still fits the frame. */
const SCALE_RATE = 2;
/** ...but it stops closing in on a jelly that is wearing away to a speck. */
const MIN_SCALE = 0.4;

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(FOV_SLOW, 1, NEAR, FAR);
  private headingX = 0;
  private headingZ = -1;
  private x = 0;
  private y = 0;
  private z = 0;
  private zoom = 0;
  private scale = 1;
  private readonly target = new THREE.Vector3();

  /** Jump straight to the resting pose behind the ball. */
  snap(ball: Ball, originZ: number) {
    this.aim(ball, 1);
    this.zoom = 0;
    this.scale = Math.max(MIN_SCALE, ball.radius / START_RADIUS);
    const height = HEIGHT_SLOW * this.scale, distance = DISTANCE_SLOW * this.scale;
    this.x = ball.x - this.headingX * distance;
    this.z = ball.z - this.headingZ * distance;
    this.y = Math.max(ball.y + height, terrainHeight(this.x, this.z) + GROUND_CLEARANCE);
    this.pose(ball, originZ);
  }

  update(ball: Ball, originZ: number, dt: number) {
    this.aim(ball, 1 - Math.exp(-HEADING_RATE * dt));
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    this.zoom += (clamp(speed / FAST_SPEED, 0, 1) - this.zoom) * (1 - Math.exp(-ZOOM_RATE * dt));
    this.scale += (Math.max(MIN_SCALE, ball.radius / START_RADIUS) - this.scale) * (1 - Math.exp(-SCALE_RATE * dt));
    const distance = (DISTANCE_SLOW + (DISTANCE_FAST - DISTANCE_SLOW) * this.zoom) * this.scale;
    const height = (HEIGHT_SLOW + (HEIGHT_FAST - HEIGHT_SLOW) * this.zoom) * this.scale;
    const follow = 1 - Math.exp(-POSITION_RATE * dt);
    this.x += (ball.x - this.headingX * distance - this.x) * follow;
    this.z += (ball.z - this.headingZ * distance - this.z) * follow;
    // Height follows more lazily, so hops read as hops rather than camera shake.
    this.y += (ball.y + height - this.y) * (1 - Math.exp(-HEIGHT_RATE * dt));
    this.y = Math.max(this.y, terrainHeight(this.x, this.z) + GROUND_CLEARANCE);
    this.pose(ball, originZ);
  }

  private aim(ball: Ball, blend: number) {
    const drift = courseDrift(-ball.z);
    const courseLength = Math.hypot(drift, 1);
    let wantX = drift / courseLength, wantZ = -1 / courseLength;
    const horizontalSpeed = Math.hypot(ball.vx, ball.vz);
    if (horizontalSpeed > HEADING_MIN_SPEED) {
      wantX = wantX * COURSE_BIAS + (ball.vx / horizontalSpeed) * (1 - COURSE_BIAS);
      wantZ = wantZ * COURSE_BIAS + (ball.vz / horizontalSpeed) * (1 - COURSE_BIAS);
    }
    const x = this.headingX + (wantX - this.headingX) * blend;
    const z = this.headingZ + (wantZ - this.headingZ) * blend;
    const length = Math.hypot(x, z);
    if (length > 0) { this.headingX = x / length; this.headingZ = z / length; }
  }

  private pose(ball: Ball, originZ: number) {
    const { camera } = this;
    const fov = FOV_SLOW + (FOV_FAST - FOV_SLOW) * this.zoom;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.position.set(this.x, this.y, this.z - originZ);
    this.target.set(
      ball.x + this.headingX * LOOK_AHEAD * this.scale,
      ball.y + LOOK_HEIGHT * this.scale,
      ball.z + this.headingZ * LOOK_AHEAD * this.scale - originZ,
    );
    camera.lookAt(this.target);
  }
}
