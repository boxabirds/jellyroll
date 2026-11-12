import assert from 'node:assert/strict';
import test from 'node:test';
import { BIOME_COUNT, BIOME_LENGTH, ICE, MEADOW } from '../src/game/biomes.ts';
import { addBee, beeSpeed } from '../src/game/bees.ts';
import { createBall, grantGlass, meltBy, resetBall, stepBall, wear } from '../src/game/physics.ts';
import { beeCapacity, beeLevel, shieldFactorAt, shieldLevel, stepProgress } from '../src/game/progression.ts';
import { pickupInSegment, createSpot } from '../src/game/pickups.ts';
import { BEE_PICKUP, GLASS_PICKUP } from '../src/game/pickup-kinds.ts';
import { courseCenter, terrainHeight } from '../src/game/terrain.ts';
import { GLASS_PER_BIOME_MAX, GLASS_PER_BIOME_MIN, GLASS_SLOTS, PHYSICS_STEP } from '../src/game/tuning.ts';
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
  // The scree comes right after the first meadow, so a meadow shield does nothing there.
  assert.equal(worn(2, BIOME_LENGTH + 700), worn(0, BIOME_LENGTH + 700));
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

test('every biome has two to four marbles to find, in a different set of places; bees are at most one a stretch', () => {
  const spot = createSpot();
  const BIOMES_CHECKED = 40;
  const perBiome: number[] = [], places = new Set<string>();
  for (let biome = 0; biome < BIOMES_CHECKED; biome++) {
    let count = 0;
    for (let slot = 0; slot < GLASS_SLOTS; slot++) {
      if (pickupInSegment(GLASS_PICKUP, biome * GLASS_SLOTS + slot, spot)) { count++; places.add(`${biome % 7}:${slot}`); }
    }
    perBiome.push(count);
  }
  assert.ok(perBiome.every(count => count >= GLASS_PER_BIOME_MIN && count <= GLASS_PER_BIOME_MAX), `marbles per biome: ${perBiome}`);
  for (const count of [2, 3, 4]) assert.ok(perBiome.includes(count), `no biome with ${count} marbles in ${perBiome}`);
  assert.ok(places.size > GLASS_SLOTS, 'the same places are used in every biome');
  let bees = 0;
  for (let segment = 0; segment < 40; segment++) if (pickupInSegment(BEE_PICKUP, segment, spot)) { bees++; assert.ok(-spot.z >= BEE_PICKUP.freeUntil); }
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

test('the glass marble is twice as heavy: it comes down harder and bounces much less than the jelly', () => {
  const drop = (glass: boolean) => {
    const ball = createBall();
    ball.x = courseCenter(300); ball.z = -300;
    ball.y = terrainHeight(ball.x, ball.z) + ball.radius + 6;
    ball.vx = 0; ball.vy = 0; ball.vz = -6;
    if (glass) grantGlass(ball);
    let landedAt = -1, rebound = 0, seconds = 0;
    for (let i = 0; i < 3 / PHYSICS_STEP; i++) {
      stepBall(ball, idle, PHYSICS_STEP); seconds += PHYSICS_STEP;
      if (landedAt < 0 && ball.impact > 0) landedAt = seconds;
      else if (landedAt >= 0 && seconds - landedAt < 1) rebound = Math.max(rebound, ball.vy);
    }
    return { landedAt, rebound };
  };
  const jelly = drop(false), marble = drop(true);
  assert.ok(jelly.landedAt > 0 && marble.landedAt > 0, 'both land');
  assert.ok(marble.landedAt < jelly.landedAt, `the marble falls faster (${marble.landedAt.toFixed(2)} s vs ${jelly.landedAt.toFixed(2)} s)`);
  assert.ok(jelly.rebound > 1, `the jelly bounces (${jelly.rebound.toFixed(2)} m/s up)`);
  assert.ok(marble.rebound < jelly.rebound * 0.6, `the marble bounces much less (${marble.rebound.toFixed(2)} vs ${jelly.rebound.toFixed(2)} m/s up)`);
});
