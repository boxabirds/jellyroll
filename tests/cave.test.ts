import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIOME_LENGTH, BIOME_ORDER, BIOMES, CAVE, LAVA, DUNES, caveAt, positionOfBiome } from '../src/game/biomes.ts';
import { createHazardSample, hazardAt } from '../src/game/hazards.ts';
import { createBall, grantGlass, stepBall } from '../src/game/physics.ts';
import { isRockBroken } from '../src/game/rocks.ts';
import { createSpike, spikeCellIndex, stalactiteInCell, stalagmiteInCell, type Spike } from '../src/game/spikes.ts';
import { courseCenter, courseHalfWidth } from '../src/game/terrain.ts';
import { PHYSICS_STEP, STALACTITE_DAMAGE } from '../src/game/tuning.ts';

const idle = { throttle: 0, steer: 0, jump: false };
const CAVE_MIDDLE = (positionOfBiome(CAVE) + 0.5) * BIOME_LENGTH;

/** The first spike of a kind near the valley floor in the middle of the cave that passes `ok`. */
function find(inCell: (x: number, z: number, out: Spike) => boolean, ok: (spike: Spike) => boolean): { spike: Spike; cellX: number; cellZ: number } {
  const spike = createSpike();
  for (let s = CAVE_MIDDLE - 300; s < CAVE_MIDDLE + 300; s += 3) {
    const cellZ = spikeCellIndex(-s), centre = spikeCellIndex(courseCenter(s));
    for (let dx = -1; dx <= 1; dx++) if (inCell(centre + dx, cellZ, spike) && ok(spike)) return { spike, cellX: centre + dx, cellZ };
  }
  throw new Error('no spike found');
}

test('the cave comes between the dunes and the lava', () => {
  const position = positionOfBiome(CAVE);
  assert.equal(BIOMES[CAVE].name, 'Cave');
  assert.equal(BIOME_ORDER[position - 1], DUNES);
  assert.equal(BIOME_ORDER[position + 1], LAVA);
  assert.equal(caveAt(CAVE_MIDDLE), 1);
  assert.equal(caveAt(100), 0);
});

test('stalagmites and stalactites are only in the cave, are everywhere in it, and stalagmites keep out of the pools', () => {
  const spike = createSpike(), sample = createHazardSample();
  let standing = 0, hanging = 0, falling = 0, elsewhere = 0;
  for (let s = 0; s < BIOME_LENGTH * BIOME_ORDER.length; s += 6) {
    const cellZ = spikeCellIndex(-s), centre = spikeCellIndex(courseCenter(s));
    for (let dx = -3; dx <= 3; dx++) {
      const ground = stalagmiteInCell(centre + dx, cellZ, spike);
      if (ground) {
        standing++;
        assert.equal(hazardAt(spike.x - courseCenter(-spike.z), -spike.z, courseHalfWidth(-spike.z), sample), 0, 'a stalagmite stands in a pool');
        if (caveAt(-spike.z) === 0) elsewhere++;
      }
      if (stalactiteInCell(centre + dx, cellZ, spike)) { hanging++; if (spike.falls) falling++; if (caveAt(-spike.z) === 0) elsewhere++; }
    }
  }
  assert.equal(elsewhere, 0);
  assert.ok(standing > 150 && hanging > 300, `${standing} standing, ${hanging} hanging`);
  assert.ok(falling > hanging * 0.1 && falling < hanging * 0.35, `${falling} of ${hanging} fall`);
});

test('the jelly bounces off a stalagmite; a glass marble knocks it over and rolls on', () => {
  const { spike, cellX, cellZ } = find(stalagmiteInCell, s => s.radius > 0.5);
  const roll = (glass: boolean) => {
    const ball = createBall();
    ball.x = spike.x; ball.z = spike.z + spike.radius + ball.radius + 2; ball.y = spike.y + ball.radius;
    ball.vx = 0; ball.vy = 0; ball.vz = -10;
    if (glass) grantGlass(ball);
    let toppled = 0, closest = Infinity;
    for (let i = 0; i < 0.6 / PHYSICS_STEP; i++) {
      stepBall(ball, idle, PHYSICS_STEP); toppled += ball.toppledCount;
      closest = Math.min(closest, Math.hypot(ball.x - spike.x, ball.z - spike.z));
    }
    return { ball, toppled, closest };
  };
  const plain = roll(false);
  assert.equal(plain.toppled, 0);
  assert.ok(plain.closest > spike.radius * 0.6, 'the jelly went through the post');
  assert.equal(isRockBroken(plain.ball.toppledSpikes, cellX, cellZ), false);
  const marble = roll(true);
  assert.equal(marble.toppled, 1);
  assert.ok(isRockBroken(marble.ball.toppledSpikes, cellX, cellZ));
  assert.ok(marble.ball.z < spike.z - 1, 'the marble rolled on past where it stood');
});

test('a stalactite lets go as the jelly comes, lands near where the jelly is, and hurts if it strikes (but not a marble)', () => {
  const { spike } = find(stalactiteInCell, s => s.falls);
  const approach = (glass: boolean, park: boolean) => {
    const ball = createBall();
    ball.x = spike.x; ball.z = spike.z + 60; ball.y = spike.y + ball.radius + 3;
    if (glass) grantGlass(ball);
    const before = ball.radius;
    let cracked = 0, landed = 0, hit = false, landedAt = Infinity;
    let along = ball.z;
    // Whichever stalactite on the way lets go first is the one watched.
    let target: { x: number; z: number } | null = null;
    for (let i = 0; i < 8 / PHYSICS_STEP && landed === 0; i++) {
      // Held on course at a steady speed, so the test is of the stalactite and not of the ground.
      // (Carried along at a steady 12 m/s whatever is in the way: a stalagmite in its path must not stop it.)
      along -= 12 * PHYSICS_STEP;
      ball.x = target && park ? target.x : spike.x; ball.z = along; ball.vx = 0; ball.vz = -12;
      // Parked: once one lets go, wait right under it.
      if (park && target) { ball.z = target.z; ball.vz = -1.01; }
      stepBall(ball, idle, PHYSICS_STEP);
      cracked += ball.cracked; landed += ball.landedCount; hit ||= ball.spikeHit;
      if (!target) { const faller = ball.fallers.find(f => f.active); if (faller) target = { x: faller.x, z: faller.z }; }
      if (ball.landedCount > 0) landedAt = Math.abs(ball.z - ball.landed[0].z);
    }
    return { ball, before, cracked, landed, hit, landedAt };
  };
  const passing = approach(false, false);
  assert.ok(passing.cracked >= 1, 'one should let go');
  assert.equal(passing.landed, 1);
  assert.ok(passing.ball.fallenSpikes.total >= 1, 'a fallen stalactite is gone from the ceiling');
  assert.ok(passing.landedAt < 12, `it came down ${passing.landedAt} m from the jelly: timed to where the jelly is going`);
  const under = approach(false, true);
  assert.ok(under.hit, 'a jelly waiting under it is struck');
  // Wear takes a little too; the strike takes its share on top.
  assert.ok(under.ball.radius < under.before * (1 - STALACTITE_DAMAGE * 0.9));
  const marble = approach(true, true);
  assert.ok(marble.hit);
  assert.equal(marble.ball.radius, marble.before, 'a glass marble is not hurt');
});
