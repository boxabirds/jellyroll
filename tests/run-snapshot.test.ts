import assert from 'node:assert/strict';
import test from 'node:test';
import { RESUME_MAX_AGE_MS, RESUME_MIN_METRES, SNAPSHOT_VERSION, assignDeep, canResume, type RunSnapshot } from '../src/app/run-snapshot.ts';
import { createBall, grantGlass, stepBall, wantPowerup } from '../src/game/physics.ts';
import { courseCenter, terrainHeight } from '../src/game/terrain.ts';
import { PHYSICS_STEP, POWERUP_SEEDS } from '../src/game/tuning.ts';

const KEY_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'radius', 'merges', 'distance', 'glassSeconds', 'magnetSeconds'] as const;

/** Drive the jelly down the course with a fixed pattern of steering and the odd power-up, so two runs can be compared exactly. */
function drive(ball: ReturnType<typeof createBall>, steps: number, from = 0) {
  for (let i = from; i < from + steps; i++) {
    if (i === 300) wantPowerup(ball, POWERUP_SEEDS);
    stepBall(ball, { throttle: 1, steer: Math.sin(i / 90), jump: i % 500 === 499 }, PHYSICS_STEP);
  }
}

function startedBall() {
  const ball = createBall();
  ball.x = courseCenter(1200); ball.z = -1200; ball.y = terrainHeight(ball.x, ball.z) + ball.radius;
  ball.stock[POWERUP_SEEDS] = 2;
  grantGlass(ball);
  return ball;
}

test('a run saved through a worker message and put into a fresh jelly carries on exactly as the original did', () => {
  const original = startedBall();
  drive(original, 8 * 120);
  assert.ok(original.merges > 0 || original.distance > 50, 'the run did something');
  // What the worker round trip does to it: a structured copy (typed arrays, maps and sets included).
  const saved = structuredClone(original);
  const restored = createBall();
  assignDeep(restored as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>);
  for (const key of KEY_FIELDS) assert.equal(restored[key], original[key], `${key} right after restoring`);
  drive(original, 6 * 120, 8 * 120);
  drive(restored, 6 * 120, 8 * 120);
  for (const key of KEY_FIELDS) assert.equal(restored[key], original[key], `${key} after carrying on`);
  assert.deepEqual([...restored.stock], [...original.stock]);
  assert.equal(restored.flock.count, original.flock.count);
  assert.equal(restored.seeds.items.filter(i => i.alive).length, original.seeds.items.filter(i => i.alive).length);
});

test('restoring keeps the objects the rest of the game holds on to', () => {
  const ball = createBall();
  const { stock, flock, seeds, shieldLevels } = ball;
  const saved = startedBall();
  drive(saved, 3 * 120);
  assignDeep(ball as unknown as Record<string, unknown>, structuredClone(saved) as unknown as Record<string, unknown>);
  assert.equal(ball.stock, stock);
  assert.equal(ball.flock, flock);
  assert.equal(ball.seeds, seeds);
  assert.equal(ball.shieldLevels, shieldLevels);
  assert.equal(ball.x, saved.x);
});

test('a saved run is offered back only while it is recent, real, the right version, and not already over', () => {
  const now = 1_000_000_000;
  const ball = startedBall(); ball.distance = RESUME_MIN_METRES + 10;
  const good: RunSnapshot = { version: SNAPSHOT_VERSION, savedAt: now - 5_000, ball, frost: [], token: 't', debugUsed: false };
  assert.equal(canResume(good, now), true);
  assert.equal(canResume(null, now), false);
  assert.equal(canResume({ ...good, version: SNAPSHOT_VERSION + 1 }, now), false, 'another version');
  assert.equal(canResume({ ...good, savedAt: now - RESUME_MAX_AGE_MS - 1 }, now), false, 'too old for the score server to still trust');
  assert.equal(canResume({ ...good, savedAt: now + 60_000 }, now), false, 'from the future');
  assert.equal(canResume({ ...good, ball: { ...ball, distance: RESUME_MIN_METRES - 1 } as typeof ball }, now), false, 'too short to matter');
  assert.equal(canResume({ ...good, ball: { ...ball, wornOut: true } as typeof ball }, now), false, 'the run had ended');
  assert.ok(RESUME_MAX_AGE_MS < 300_000, 'inside the server\'s limit on silence between check-ins');
});
