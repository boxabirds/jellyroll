import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STICK_DEADZONE, TILT_DEADZONE_DEGREES, TILT_FULL_DEGREES, screenRoll, stickValue, tiltSteer, type StickValue,
} from '../src/app/touch-math.ts';

const RADIUS = 60;
const out = (): StickValue => ({ x: 0, y: 0 });

test('the stick: centred does nothing, up accelerates, down brakes, right steers right', () => {
  assert.deepEqual(stickValue(0, 0, RADIUS, out()), { x: 0, y: 0 });
  assert.deepEqual(stickValue(RADIUS * STICK_DEADZONE * 0.9, 0, RADIUS, out()), { x: 0, y: 0 }, 'inside the dead zone');
  const up = stickValue(0, -RADIUS, RADIUS, out());
  assert.ok(Math.abs(up.y - 1) < 1e-9 && up.x === 0, 'screen-up is +1 (accelerate)');
  const down = stickValue(0, RADIUS, RADIUS, out());
  assert.ok(Math.abs(down.y + 1) < 1e-9, 'screen-down is -1 (decelerate)');
  const right = stickValue(RADIUS, 0, RADIUS, out());
  assert.ok(Math.abs(right.x - 1) < 1e-9 && right.y === 0, 'right is +1');
  assert.ok(stickValue(-RADIUS, 0, RADIUS, out()).x < -0.99);
});

test('the stick is smooth: rises from zero at the dead zone, never exceeds 1, even when dragged past its edge', () => {
  let previous = 0;
  for (let pixels = 0; pixels <= RADIUS * 3; pixels += 0.5) {
    const value = stickValue(pixels, 0, RADIUS, out());
    assert.ok(value.x >= previous - 1e-12, 'must not decrease as the thumb moves out');
    assert.ok(value.x - previous < 0.05, 'no jumps');
    assert.ok(Math.hypot(value.x, value.y) <= 1 + 1e-9);
    previous = value.x;
  }
  const diagonal = stickValue(RADIUS * 5, -RADIUS * 5, RADIUS, out());
  assert.ok(Math.hypot(diagonal.x, diagonal.y) <= 1 + 1e-9, 'a diagonal drag past the edge is clamped to a unit vector');
  assert.ok(diagonal.x > 0 && diagonal.y > 0);
  assert.deepEqual(stickValue(10, 10, 0, out()), { x: 0, y: 0 }, 'a zero-size stick does nothing');
});

/** Independent check: roll to the right is how far the screen's right edge points below the horizon. */
function rollByMatrices(alpha: number, beta: number, gamma: number, screenAngle: number): number {
  const d = Math.PI / 180;
  const [a, b, g, s] = [alpha * d, beta * d, gamma * d, screenAngle * d];
  const mul = (m: number[][], n: number[][]) => m.map((row, i) => n[0].map((_, j) => row.reduce((sum, _x, k) => sum + m[i][k] * n[k][j], 0)));
  const rz = [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const rx = [[1, 0, 0], [0, Math.cos(b), -Math.sin(b)], [0, Math.sin(b), Math.cos(b)]];
  const ry = [[Math.cos(g), 0, Math.sin(g)], [0, 1, 0], [-Math.sin(g), 0, Math.cos(g)]];
  const device = mul(mul(rz, rx), ry); // device frame to earth frame (earth z is up)
  const right = [Math.cos(s), -Math.sin(s), 0]; // the screen's right edge, in device coordinates
  const worldZ = device[2][0] * right[0] + device[2][1] * right[1] + device[2][2] * right[2];
  return Math.asin(-worldZ) / d;
}

test('roll: tilting a flat phone right (portrait) is positive, left is negative, level is zero', () => {
  assert.ok(Math.abs(screenRoll(0, 0, 0)) < 1e-9);
  assert.ok(Math.abs(screenRoll(0, 20, 0) - 20) < 1e-9, 'gamma 20 degrees is 20 degrees of roll');
  assert.ok(Math.abs(screenRoll(0, -20, 0) + 20) < 1e-9);
});

test('roll agrees with an independent matrix calculation for any way of holding the phone', () => {
  let checked = 0;
  for (const angle of [0, 90, 180, 270]) {
    for (let beta = -170; beta <= 170; beta += 17) {
      for (let gamma = -85; gamma <= 85; gamma += 17) {
        const expected = rollByMatrices(37, beta, gamma, angle);
        assert.ok(Math.abs(screenRoll(beta, gamma, angle) - expected) < 1e-6, `beta ${beta} gamma ${gamma} screen ${angle}: ${screenRoll(beta, gamma, angle)} vs ${expected}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 400);
});

test('holding the phone upright and rolling it like a steering wheel steers the right way', () => {
  // Upright portrait is beta 90. Rolling it 45 degrees clockwise (right edge down) is beta 45, gamma 90.
  assert.ok(Math.abs(screenRoll(45, 90, 0) - 45) < 1e-6, `${screenRoll(45, 90, 0)}`);
  assert.ok(Math.abs(screenRoll(45, -90, 0) + 45) < 1e-6);
  assert.ok(Math.abs(screenRoll(90, 0, 0)) < 1e-9, 'upright and not rolled is level');
  const clockwise = screenRoll(60, 90, 0), anticlockwise = screenRoll(60, -90, 0);
  assert.ok(clockwise > 20 && anticlockwise < -20, `${clockwise}, ${anticlockwise}`);
  // Turned sideways, the same physical roll must still read as the same direction.
  for (const angle of [90, 270]) {
    const sideways = rollByMatrices(0, 0, 0, angle);
    assert.ok(Math.abs(sideways) < 1e-9, 'a flat phone is level in any rotation');
  }
});

test('tilt steering: still inside the dead zone, ramps to full, left and right are mirror images, relative to where you started', () => {
  assert.equal(tiltSteer(0, 0), 0);
  assert.equal(tiltSteer(TILT_DEADZONE_DEGREES, 0), 0);
  assert.ok(tiltSteer(TILT_DEADZONE_DEGREES + 1, 0) > 0);
  assert.equal(tiltSteer(TILT_FULL_DEGREES, 0), 1);
  assert.equal(tiltSteer(TILT_FULL_DEGREES * 3, 0), 1);
  for (let tilt = 0; tilt <= 40; tilt += 0.5) assert.ok(tiltSteer(-tilt, 0) === -tiltSteer(tilt, 0), `not mirrored at ${tilt}`);
  // Held at 15 degrees to begin with: that is "straight", and tilting from there steers.
  assert.equal(tiltSteer(15, 15), 0);
  assert.ok(tiltSteer(15 + TILT_FULL_DEGREES, 15) === 1 && tiltSteer(15 - TILT_FULL_DEGREES, 15) === -1);
  let previous = 0;
  for (let tilt = 0; tilt <= 30; tilt += 0.25) { const v = tiltSteer(tilt, 0); assert.ok(v >= previous && v - previous < 0.05); previous = v; }
});
