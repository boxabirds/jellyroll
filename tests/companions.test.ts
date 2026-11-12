import assert from 'node:assert/strict';
import test from 'node:test';
import { BIOME_COUNT, BIOME_LENGTH, ICE, MEADOW } from '../src/game/biomes.ts';
import { addBee, beeSpeed } from '../src/game/bees.ts';
import { createBall, grantGlass, meltBy, resetBall, stepBall, wear } from '../src/game/physics.ts';
import { beeCapacity, beeLevel, shieldFactorAt, shieldLevel, stepProgress } from '../src/game/progression.ts';
import { pickupInSegment, createSpot } from '../src/game/pickups.ts';
import { BEE_PICKUP, GLASS_PICKUP } from '../src/game/pickup-kinds.ts';
import { courseCenter, terrainHeight } from '../src/game/terrain.ts';
import { PHYSICS_STEP } from '../src/game/tuning.ts';
import { createMushroom, mushroomCellIndex, mushroomInCell } from '../src/game/mushrooms.ts';

const idle = { throttle: 0, steer: 0, jump: false };

test('shield levels follow 100, +200, +300', () => {
  assert.deepEqual([0, 99, 100, 299, 300, 599, 600, 5000].map(shieldLevel), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(stepProgress(150, [100, 200, 300]), { into: 50, cost: 200 });
  assert.deepEqual(stepProgress(9999, [100, 200, 300]), { into: 0, cost: 0 });
});

test('bees carry 1, 2, 3, 4, 5 as 100, +200, +300, +400 are delivered', () => {
  assert.deepEqual([0, 100, 300, 600, 1000, 99999].map(beeCapacity), [1, 2, 3, 4, 5, 5]);
  assert.equal(beeLevel(99), 0);
});

test('a shield takes 10%, 30%, 60% off its own biome only', () => {
  const levels = Array.from({ length: BIOME_COUNT }, () => 0);
  assert.equal(shieldFactorAt(100, levels), 1);
  levels[MEADOW] = 1;
  assert.ok(Math.abs(shieldFactorAt(100, levels) - 0.9) < 1e-9);
  levels[MEADOW] = 3;
  assert.ok(Math.abs(shieldFactorAt(100, levels) - 0.4) < 1e-9);
  // The meadow is first in the course; deep in the next biome the meadow shield no longer counts.
  assert.equal(shieldFactorAt(BIOME_LENGTH + 700, levels), 1);
});

test('a meadow shield cuts meadow wear but not wear elsewhere', () => {
  const worn = (shield: number, s: number) => {
    const ball = createBall();
    ball.z = -s; ball.shieldLevels[MEADOW] = shield; ball.shieldLevels[ICE] = 0;
    const before = ball.radius;
    wear(ball, 100);
    return before - ball.radius;
  };
  assert.ok(Math.abs(worn(2, 100) / worn(0, 100) - 0.7) < 1e-9);
  assert.equal(worn(2, BIOME_LENGTH * 2 + 700), worn(0, BIOME_LENGTH * 2 + 700));
});

test('glass takes no wear, and counts down', () => {
  const ball = createBall();
  grantGlass(ball);
  const before = ball.radius;
  wear(ball, 1000);
  assert.equal(ball.radius, before);
  for (let i = 0; i < 30 / PHYSICS_STEP; i++) stepBall(ball, idle, PHYSICS_STEP);
  assert.equal(ball.glassSeconds, 0);
  assert.ok(ball.radius < before + 1e-6 || ball.wornOut === false);
});

test('hazard damage is tallied for the damage numbers; plain rolling wear is not', () => {
  const ball = createBall();
  wear(ball, 500);
  assert.equal(ball.lost, 0);
  // Stand in a meadow pond: it melts the jelly.
  const before = ball.radius;
  ball.z = -0; ball.hazardKind = 0;
  meltBy(ball, 0.05);
  assert.ok(Math.abs(ball.lost - before * 0.05) < 1e-12);
  assert.ok(ball.radius < before);
});

test('glass and bee pickups exist, away from the start, at most one a stretch', () => {
  const spot = createSpot();
  let glass = 0, bees = 0;
  for (let segment = 0; segment < 60; segment++) if (pickupInSegment(GLASS_PICKUP, segment, spot)) glass++;
  for (let segment = 0; segment < 40; segment++) if (pickupInSegment(BEE_PICKUP, segment, spot)) { bees++; assert.ok(-spot.z >= BEE_PICKUP.freeUntil); }
  assert.ok(glass >= 18 && glass <= 42, `glass ${glass}`);
  assert.ok(bees > 8 && bees < 32, `bees ${bees}`);
});

test('a bee fetches a collectible and the jelly absorbs it; a full flock refuses more', () => {
  // Find a patch of collectibles far enough down the course.
  const m = createMushroom();
  let s = 400, found = false;
  for (; s < 2000 && !found; s += 2) {
    const z = -s, x = courseCenter(s);
    for (let dx = -2; dx <= 2 && !found; dx++) found = mushroomInCell(mushroomCellIndex(x) + dx, mushroomCellIndex(z), m);
  }
  assert.ok(found, 'no collectible found');
  const ball = createBall();
  ball.z = -s + 6; ball.x = m.x; ball.y = terrainHeight(ball.x, ball.z) + ball.radius;
  ball.vx = 0; ball.vz = -3; ball.vy = 0;
  assert.equal(addBee(ball.flock, ball.x + 1, ball.y + 1, ball.z), true);
  for (let i = 0; i < 4; i++) addBee(ball.flock, ball.x, ball.y, ball.z);
  assert.equal(ball.flock.count, 4);
  assert.equal(addBee(ball.flock, 0, 0, 0), false);
  const merges = ball.merges;
  for (let i = 0; i < 6 / PHYSICS_STEP; i++) { stepBall(ball, idle, PHYSICS_STEP); ball.vx = 0; ball.vz = -3; }
  assert.ok(ball.flock.delivered > 0 || ball.merges > merges, `delivered ${ball.flock.delivered} merges ${ball.merges - merges}`);
  assert.equal(ball.shieldCounts.reduce((a, b) => a + b, 0), ball.merges);
});

test('bees are always faster than the jelly', () => {
  for (const speed of [0, 10, 40, 100]) assert.ok(beeSpeed(speed) > speed);
});

test('a new run clears shields, bees and glass', () => {
  const ball = createBall();
  ball.shieldCounts[MEADOW] = 500; ball.shieldLevels[MEADOW] = 2; ball.glassSeconds = 3; addBee(ball.flock, 0, 0, 0); ball.lost = 1;
  resetBall(ball);
  assert.equal(ball.shieldCounts[MEADOW], 0);
  assert.equal(ball.shieldLevels[MEADOW], 0);
  assert.equal(ball.glassSeconds, 0);
  assert.equal(ball.flock.count, 0);
  assert.equal(ball.lost, 0);
});

test('a glass marble smashes a rock it hits and rolls on; plain jelly bounces off and leaves it', async () => {
  const { createRock, isRockBroken, rockCellIndex, rockInCell } = await import('../src/game/rocks.ts');
  const rock = createRock();
  let found = false;
  for (let s = 400; s < 2500 && !found; s += 3) {
    const z = -s, x = courseCenter(s);
    for (let dx = -3; dx <= 3 && !found; dx++) found = rockInCell(rockCellIndex(x) + dx, rockCellIndex(z), rock) && rock.radius > 0.8;
  }
  assert.ok(found, 'no rock found');
  const cellX = rockCellIndex(rock.x), cellZ = rockCellIndex(rock.z);
  const roll = (glass: boolean) => {
    const ball = createBall();
    ball.x = rock.x; ball.y = rock.y + rock.radius * 0.5; ball.z = rock.z + rock.radius + ball.radius + 1.5;
    ball.vx = 0; ball.vy = 0; ball.vz = -12;
    if (glass) grantGlass(ball);
    let smashed = 0;
    for (let i = 0; i < 1 / PHYSICS_STEP; i++) { stepBall(ball, idle, PHYSICS_STEP); smashed += ball.brokenCount; }
    return { ball, smashed };
  };
  const glass = roll(true);
  assert.equal(glass.smashed, 1);
  assert.ok(isRockBroken(glass.ball.brokenRocks, cellX, cellZ));
  assert.ok(glass.ball.z < rock.z - rock.radius, 'the marble rolled on through where the rock was');
  const plain = roll(false);
  assert.equal(plain.smashed, 0);
  assert.equal(isRockBroken(plain.ball.brokenRocks, cellX, cellZ), false);
});
