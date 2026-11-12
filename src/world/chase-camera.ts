/**
 * Follows the jelly from behind and above. All smoothing is done in world
 * coordinates; the render origin is only subtracted when the camera is posed.
 */
import { ceilingHeight, insideCave } from '../game/cave.ts';
import * as THREE from 'three/webgpu';
import { clamp } from '../game/noise.ts';
import type { Ball } from '../game/physics.ts';
import { courseDrift, terrainHeight } from '../game/terrain.ts';
import { CRUISE_SPEED, HEADING_MIN_SPEED } from '../game/tuning.ts';
import { VIEW_DISTANCE } from './terrain-mesh.ts';

const NEAR = 0.3;
const FAR = VIEW_DISTANCE * 1.5;
/**
 * A tall, narrow screen would crop the sides of the hill, so the view widens until at least this much of the
 * scene fits across, but never past MAX_FOV (a very wide lens distorts the jelly).
 */
const MIN_HORIZONTAL_FOV = 66;
const MAX_FOV = 92;
/**
 * Speed is shown by the lens, not by the camera's position: the field of view opens from FOV_SLOW to FOV_FAST as the jelly speeds up,
 * and the camera stays the same distance behind and above it. (Pulling the camera back with speed made a fast jelly look as if it were
 * going slowly.) The camera does not follow the jelly's size either, so a grown jelly looks bigger and a worn one smaller.
 */
const FOV_SLOW = 56;
const FOV_FAST = 82;
/** Speed (m/s) at which the view is fully widened. */
const FAST_SPEED = CRUISE_SPEED;
const DISTANCE = 5.2;
const HEIGHT = 3.2;
const LOOK_AHEAD = 8;
const LOOK_HEIGHT = 0.9;
/** Keep the lens this far above the ground under it. */
const GROUND_CLEARANCE = 1.1;
/** How much the camera heading favours the course over the jelly's own velocity. */
const COURSE_BIAS = 0.35;
const HEADING_RATE = 2.6;
const POSITION_RATE = 16;
const HEIGHT_RATE = 4;
const ZOOM_RATE = 1.6;
/**
 * Smoothing makes the camera trail a fast jelly. It may fall this many times
 * its intended distance behind, no further.
 */
const MAX_TRAIL = 1.5;

/** The camera keeps this far below the cave's roof. */
const ROOF_CLEARANCE = 2;

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(FOV_SLOW, 1, NEAR, FAR);
  private headingX = 0;
  private headingZ = -1;
  private x = 0;
  private y = 0;
  private z = 0;
  /** 0 (slow) to 1 (fast): how far the lens has opened. */
  private zoom = 0;
  private readonly target = new THREE.Vector3();

  /** Jump straight to the resting pose behind the ball. */
  snap(ball: Ball, originZ: number) {
    this.aim(ball, 1);
    this.zoom = 0;
    this.x = ball.x - this.headingX * DISTANCE;
    this.z = ball.z - this.headingZ * DISTANCE;
    this.y = Math.max(ball.y + HEIGHT, terrainHeight(this.x, this.z) + GROUND_CLEARANCE);
    this.underRoof();
    this.pose(ball, originZ);
  }

  update(ball: Ball, originZ: number, dt: number) {
    this.aim(ball, 1 - Math.exp(-HEADING_RATE * dt));
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    this.zoom += (clamp(speed / FAST_SPEED, 0, 1) - this.zoom) * (1 - Math.exp(-ZOOM_RATE * dt));
    const distance = DISTANCE, height = HEIGHT;
    const follow = 1 - Math.exp(-POSITION_RATE * dt);
    this.x += (ball.x - this.headingX * distance - this.x) * follow;
    this.z += (ball.z - this.headingZ * distance - this.z) * follow;
    const behind = Math.hypot(ball.x - this.x, ball.z - this.z);
    if (behind > distance * MAX_TRAIL) {
      const pull = (distance * MAX_TRAIL) / behind;
      this.x = ball.x + (this.x - ball.x) * pull;
      this.z = ball.z + (this.z - ball.z) * pull;
    }
    // Height follows more lazily, so hops read as hops rather than camera shake.
    this.y += (ball.y + height - this.y) * (1 - Math.exp(-HEIGHT_RATE * dt));
    // The same limit vertically, for long falls.
    this.y = Math.min(Math.max(this.y, ball.y + height - distance * MAX_TRAIL), ball.y + height + distance * MAX_TRAIL);
    this.y = Math.max(this.y, terrainHeight(this.x, this.z) + GROUND_CLEARANCE);
    this.underRoof();
    this.pose(ball, originZ);
  }

  /** In the cave the camera stays under the roof (and still above the ground, which matters more). */
  private underRoof() {
    if (!insideCave(-this.z)) return;
    const ground = terrainHeight(this.x, this.z) + GROUND_CLEARANCE;
    this.y = Math.max(ground, Math.min(this.y, ceilingHeight(this.x, -this.z) - ROOF_CLEARANCE));
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
    let fov = FOV_SLOW + (FOV_FAST - FOV_SLOW) * this.zoom;
    if (camera.aspect < 1) {
      const wide = 2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * Math.PI) / 360) / camera.aspect) * (180 / Math.PI);
      fov = Math.min(MAX_FOV, Math.max(fov, wide));
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.position.set(this.x, this.y, this.z - originZ);
    this.target.set(
      ball.x + this.headingX * LOOK_AHEAD,
      ball.y + LOOK_HEIGHT,
      ball.z + this.headingZ * LOOK_AHEAD - originZ,
    );
    camera.lookAt(this.target);
  }
}
