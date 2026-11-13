import assert from 'node:assert/strict';
import test from 'node:test';
import { BIOME_LENGTH, LAVA, MEADOW, firstStretchOf, loopStart, nextStretchOf } from '../src/game/biomes.ts';
import { frostPatches } from '../src/game/frost-store.ts';
import { createHazardSample, isLiquidKind } from '../src/game/hazards.ts';
import { FREEZE_PICKUP } from '../src/game/pickup-kinds.ts';
import { createSpot, pickupInSegment } from '../src/game/pickups.ts';
import { createBall, resetBall, stepBall, usePowerup, wantPowerup } from '../src/game/physics.ts';
import { courseCenter, holeEffectAt, terrainHeight } from '../src/game/terrain.ts';
import { FREEZE_PATCH_RADIUS, GLASS_SLOTS, PHYSICS_STEP, POWERUP_FREEZE } from '../src/game/tuning.ts';

const sample = createHazardSample();
const idle = { throttle: 0, steer: 0, jump: false };

/** A lake of `kind` with at least `run` metres of it wet along the course: [course distance where it starts, offset from the middle]. */
function findLake(kind: number, from: number, run = 14, needed = 0.9): [number, number] {
  for (let s = from; s < from + BIOME_LENGTH; s += 1) {
    for (let u = -9; u <= 9; u += 0.5) {
      let whole = true;
      for (let along = 0; along <= run && whole; along += 1) whole = holeEffectAt(courseCenter(s + along) + u, -(s + along), sample) > needed && sample.kind === kind;
      if (whole) return [s, u];
    }
  }
  throw new Error(`no lake of kind ${kind}`);
}

/** The ball `before` metres ahead of (s, u), rolling down the course. */
function ballAt(s: number, u: number, before: number) {
  const ball = createBall();
  ball.x = courseCenter(s - before) + u; ball.z = -(s - before);
  ball.y = terrainHeight(ball.x, ball.z) + ball.radius + 0.01;
  ball.vx = 0; ball.vy = 0; ball.vz = -10;
  return ball;
}

test('freeze ray crystals are not met before the second loop of the course, and then are two to four in every biome', () => {
  const spot = createSpot();
  const first = loopStart(1) * BIOME_LENGTH;
  assert.equal(FREEZE_PICKUP.freeUntil, first);
  const perBiome: number[] = [];
  for (let biome = 0; biome < 30; biome++) {
    let count = 0;
    for (let slot = 0; slot < GLASS_SLOTS; slot++) {
      if (pickupInSegment(FREEZE_PICKUP, biome * GLASS_SLOTS + slot, spot)) { count++; assert.ok(-spot.z >= first, `a crystal at ${-spot.z} m, before the second loop`); }
    }
    perBiome.push(count);
  }
  assert.ok(perBiome.slice(0, loopStart(1)).every(count => count === 0), `crystals in the first loop: ${perBiome}`);
  const after = perBiome.slice(loopStart(1) + 1);
  assert.ok(after.every(count => count >= 2 && count <= 4), `crystals per biome after the first loop: ${after}`);
  for (const count of [2, 3, 4]) assert.ok(after.includes(count), `no biome with ${count} crystals`);
});

test('the freeze ray is kept, used with key 4, and uses one up', () => {
  const ball = createBall();
  assert.equal(usePowerup(ball, POWERUP_FREEZE), false, 'nothing to use');
  ball.stock[POWERUP_FREEZE] = 2;
  wantPowerup(ball, POWERUP_FREEZE);
  stepBall(ball, idle, PHYSICS_STEP);
  assert.equal(ball.froze, true, 'fired in the step after the key');
  assert.equal(ball.stock[POWERUP_FREEZE], 1);
  stepBall(ball, idle, PHYSICS_STEP);
  assert.equal(ball.froze, false, 'and only in that step');
});

test('on a meadow pond it freezes the water (ice cracks, nothing hisses) and the frozen water no longer hurts', () => {
  const [s, u] = findLake(0, nextStretchOf(MEADOW, 12) * BIOME_LENGTH, 10, 0.6);
  const ball = ballAt(s, u, 2);
  const wetBefore = holeEffectAt(courseCenter(s + 6) + u, -(s + 6), sample);
  assert.ok(wetBefore > 0.6 && isLiquidKind(sample.kind), 'wet before');
  ball.stock[POWERUP_FREEZE] = 1; wantPowerup(ball, POWERUP_FREEZE);
  stepBall(ball, idle, PHYSICS_STEP);
  assert.ok(ball.frostMade.length >= 1, `${ball.frostMade.length} patches made`);
  assert.ok(ball.frostMade.every(patch => patch.kind === 'ice'));
  assert.equal(ball.frozeCrack, true);
  assert.equal(ball.frozeSteam, false);
  const patch = frostPatches[0];
  assert.equal(holeEffectAt(patch.x, patch.z, sample), 0, 'the frozen lake is no longer wet');
  assert.ok(Math.hypot(patch.x - ball.x, patch.z - ball.z) < 15, 'the ice is in front of the jelly');
  resetBall(ball);
  assert.equal(frostPatches.length, 0, 'a new run starts with the lake as it was');
  assert.ok(holeEffectAt(patch.x, patch.z, sample) > 0, 'the water is back in a new run');
});

test('on a lava lake it blackens the lava (steam hisses) and the cooled lake no longer burns', () => {
  const [s, u] = findLake(4, nextStretchOf(LAVA, 12) * BIOME_LENGTH + 100, 12);
  const ball = ballAt(s, u, 2);
  ball.stock[POWERUP_FREEZE] = 1; wantPowerup(ball, POWERUP_FREEZE);
  stepBall(ball, idle, PHYSICS_STEP);
  assert.ok(ball.frostMade.some(patch => patch.kind === 'crust'), 'lava goes black');
  assert.equal(ball.frozeSteam, true);
  for (const patch of frostPatches.filter(p => p.kind === 'crust')) assert.equal(holeEffectAt(patch.x, patch.z, sample), 0, 'cooled lava does not burn');
  resetBall(ball);
});

test('on the lava biome\'s ordinary ground it cools it, with steam', () => {
  const start = firstStretchOf(LAVA) * BIOME_LENGTH + 200;
  let dry = -1;
  for (let s = start; s < start + 900 && dry < 0; s += 1) {
    let clear = true;
    for (let along = 0; along <= 14 && clear; along += 1) for (const u of [-3.5, 0, 3.5]) clear = clear && holeEffectAt(courseCenter(s + along) + u, -(s + along), sample) === 0;
    if (clear) dry = s;
  }
  assert.ok(dry > 0, 'found dry lava ground');
  const ball = ballAt(dry + 14, 0, 14);
  ball.stock[POWERUP_FREEZE] = 1; wantPowerup(ball, POWERUP_FREEZE);
  stepBall(ball, idle, PHYSICS_STEP);
  assert.ok(ball.frostMade.length >= 3 && ball.frostMade.every(patch => patch.kind === 'cool'), `${ball.frostMade.map(p => p.kind)}`);
  assert.equal(ball.frozeSteam, true);
  assert.ok(ball.frostMade.every(patch => patch.radius === FREEZE_PATCH_RADIUS));
  resetBall(ball);
});

test('on plain ground with no lake it sprays ice for show and changes nothing that lasts', () => {
  const ball = ballAt(300, 0, 0);
  ball.stock[POWERUP_FREEZE] = 1; wantPowerup(ball, POWERUP_FREEZE);
  stepBall(ball, idle, PHYSICS_STEP);
  assert.equal(ball.froze, true);
  assert.equal(ball.frostMade.length, 0);
  assert.equal(frostPatches.length, 0);
  assert.equal(ball.frozeCrack || ball.frozeSteam, false);
});

test('a frozen lake is solid: the ground comes up to the water level, and the jelly rolls across instead of sinking', () => {
  for (const kind of [MEADOW, LAVA]) {
    frostPatches.length = 0;
    const [s, u] = kind === LAVA ? findLake(4, nextStretchOf(LAVA, 12) * BIOME_LENGTH + 100, 12) : findLake(0, nextStretchOf(MEADOW, 12) * BIOME_LENGTH, 10, 0.6);
    const x = courseCenter(s + 6) + u, z = -(s + 6);
    const before = terrainHeight(x, z);
    const ball = ballAt(s, u, 2);
    ball.stock[POWERUP_FREEZE] = 1;
    wantPowerup(ball, POWERUP_FREEZE);
    stepBall(ball, idle, PHYSICS_STEP);
    const lakes = frostPatches.filter(patch => patch.kind !== 'cool');
    assert.ok(lakes.length > 0, `kind ${kind}: no lake frozen`);
    const lake = lakes[0];
    assert.ok(Math.abs(terrainHeight(lake.x, lake.z) - lake.level) < 1e-9, 'the lake bed is at the surface at the middle of the patch');
    assert.ok(terrainHeight(x, z) >= before - 1e-9, 'the ground never goes down');
    // Roll across the patch: the jelly stays at the surface, not down in the basin.
    ball.x = lake.x; ball.z = lake.z + lake.radius * 0.8; ball.y = lake.level + ball.radius + 0.01;
    ball.vx = 0; ball.vy = 0; ball.vz = -6;
    let lowest = Infinity;
    for (let i = 0; i < 0.6 / PHYSICS_STEP; i++) { stepBall(ball, idle, PHYSICS_STEP); if (Math.hypot(ball.x - lake.x, ball.z - lake.z) < lake.radius * 0.6) lowest = Math.min(lowest, ball.y - ball.radius); }
    assert.ok(lowest > lake.level - 0.15, `kind ${kind}: the jelly sank to ${lowest.toFixed(2)} below the surface ${lake.level.toFixed(2)}`);
    frostPatches.length = 0;
  }
});

test('the ray covers the water or lava straight ahead of the jelly, out to the end of its reach, not just where a patch happens to be centred', () => {
  for (const kind of [MEADOW, LAVA]) {
    frostPatches.length = 0;
    const [s, u] = kind === LAVA ? findLake(4, nextStretchOf(LAVA, 12) * BIOME_LENGTH + 100, 12) : findLake(0, nextStretchOf(MEADOW, 12) * BIOME_LENGTH, 10, 0.6);
    const ball = ballAt(s, u, 3);
    const dry = (ahead: number, side: number) => {
      const z = ball.z - ahead, x = ball.x + side;
      return !(holeEffectAt(x, z, sample) > 0.25 && isLiquidKind(sample.kind));
    };
    const wet: [number, number][] = [];
    for (let ahead = 1; ahead <= 10; ahead += 1) for (const side of [-1, 0, 1]) if (!dry(ahead, side)) wet.push([ahead, side]);
    assert.ok(wet.length > 0, 'a lake in front');
    ball.stock[POWERUP_FREEZE] = 1; wantPowerup(ball, POWERUP_FREEZE);
    stepBall(ball, idle, PHYSICS_STEP);
    // The ball moves a hair in the step; the patches are checked where the jelly was when it fired.
    const missed = wet.filter(([ahead, side]) => holeEffectAt(ball.x + side, ball.z - ahead, sample) > 0.25);
    assert.equal(missed.length, 0, `kind ${kind}: still wet at ${JSON.stringify(missed.slice(0, 4))}`);
    frostPatches.length = 0;
  }
});
