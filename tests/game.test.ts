import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mushroomCellIndex, mushroomInCell, createMushroom } from '../src/game/mushrooms.ts';
import { ballSpeed, createBall, grow, stepBall, wear, type Ball, type ControlInput } from '../src/game/physics.ts';
import { createRock, rockCellIndex, rockInCell } from '../src/game/rocks.ts';
import { courseCenter, courseHalfWidth, terrainHeight, terrainNormal } from '../src/game/terrain.ts';
import {
  MUSHROOM_CELL, MUSHROOM_MAX_RADIUS, MUSHROOM_MIN_RADIUS, MAX_RADIUS, MEAN_SLOPE, MIN_RADIUS, MIN_SPEED, PHYSICS_HZ, PHYSICS_STEP,
  RIDGE_DISTANCE, ROCK_CELL, START_RADIUS,
} from '../src/game/tuning.ts';
import { createWobble, stepWobble } from '../src/game/wobble.ts';

const COAST: ControlInput = { throttle: 0, steer: 0 };
const BOOST: ControlInput = { throttle: 1, steer: 0 };
const BRAKE: ControlInput = { throttle: -1, steer: 0 };
const LEFT: ControlInput = { throttle: 0, steer: -1 };
const RIGHT: ControlInput = { throttle: 0, steer: 1 };

const RUN_SECONDS = 60;
const LONG_RUN_SECONDS = 600;
const SINK_TOLERANCE = 0.02;

/**
 * Runs the simulation. `immortal` holds the jelly at its starting size, for
 * tests that are about motion over a long run rather than about wear.
 */
function simulate(input: ControlInput, seconds: number, each?: (ball: Ball, time: number) => void, immortal = false): Ball {
  const ball = createBall();
  const steps = Math.round(seconds * PHYSICS_HZ);
  for (let i = 0; i < steps; i++) {
    if (immortal) { ball.radius = START_RADIUS; ball.wornOut = false; }
    stepBall(ball, input, PHYSICS_STEP);
    each?.(ball, (i + 1) * PHYSICS_STEP);
  }
  return ball;
}

test('the course descends on every 1 km stretch', () => {
  const STRETCH = 1000;
  const STRETCHES = 50;
  for (let i = 0; i < STRETCHES; i++) {
    const top = terrainHeight(courseCenter(i * STRETCH), -i * STRETCH);
    const bottom = terrainHeight(courseCenter((i + 1) * STRETCH), -(i + 1) * STRETCH);
    const slope = (top - bottom) / STRETCH;
    assert.ok(slope > MEAN_SLOPE * 0.5, `stretch ${i} slope ${slope}`);
  }
});

test('the landscape varies: slope and width are not constant', () => {
  const SAMPLE = 50;
  const SAMPLES = 200;
  let minSlope = Infinity, maxSlope = -Infinity, minWidth = Infinity, maxWidth = -Infinity;
  for (let i = 1; i < SAMPLES; i++) {
    const s = i * SAMPLE;
    const slope = (terrainHeight(courseCenter(s), -s) - terrainHeight(courseCenter(s + SAMPLE), -(s + SAMPLE))) / SAMPLE;
    minSlope = Math.min(minSlope, slope); maxSlope = Math.max(maxSlope, slope);
    minWidth = Math.min(minWidth, courseHalfWidth(s)); maxWidth = Math.max(maxWidth, courseHalfWidth(s));
  }
  assert.ok(maxSlope - minSlope > 0.2, `slope range ${minSlope}..${maxSlope}`);
  assert.ok(maxWidth - minWidth > 10, `width range ${minWidth}..${maxWidth}`);
});

test('terrain normals are unit length and point up', () => {
  const n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 500; i++) {
    terrainNormal(i * 7.3 - 900, -i * 41.7, n);
    assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9);
    assert.ok(n.y > 0);
  }
});

test('with no input the jelly rolls downhill and stays finite, on the ground and in the valley', () => {
  let maxOutside = 0;
  const ball = simulate(COAST, LONG_RUN_SECONDS, b => {
    assert.ok(Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz), 'state went non-finite');
    const sink = terrainHeight(b.x, b.z) + b.radius * b.ny - b.y;
    assert.ok(sink < b.radius * 0.5 + SINK_TOLERANCE, `ball sank ${sink} m into the ground`);
    const outside = Math.abs(b.x - courseCenter(-b.z)) - courseHalfWidth(-b.z);
    maxOutside = Math.max(maxOutside, outside);
  }, true);
  assert.ok(ball.distance > LONG_RUN_SECONDS * MIN_SPEED, `only travelled ${ball.distance} m`);
  assert.ok(maxOutside < 25, `climbed ${maxOutside} m up the valley wall`);
});

test('S cannot stop the jelly: it never stays slow, even after hitting rocks head-on', () => {
  const SLOW = MIN_SPEED * 0.8;
  const MAX_SLOW_SECONDS = 1.5;
  const WINDOW = 3;
  let slowFor = 0, longestSlow = 0;
  let windowStartS = 0, nextCheck = WINDOW, slowestProgress = Infinity;
  simulate(BRAKE, LONG_RUN_SECONDS, (ball, time) => {
    slowFor = Math.hypot(ball.vx, ball.vz) < SLOW ? slowFor + PHYSICS_STEP : 0;
    longestSlow = Math.max(longestSlow, slowFor);
    if (time < nextCheck) return;
    slowestProgress = Math.min(slowestProgress, (-ball.z - windowStartS) / WINDOW);
    windowStartS = -ball.z; nextCheck += WINDOW;
  }, true);
  assert.ok(longestSlow < MAX_SLOW_SECONDS, `stayed under ${SLOW} m/s for ${longestSlow} s`);
  // A rock bounce costs some ground, but every window still ends further down.
  assert.ok(slowestProgress > 0, `a ${WINDOW} s window advanced ${slowestProgress} m/s down the course`);
});

test('W goes further than coasting, S goes less far', () => {
  const boost = simulate(BOOST, RUN_SECONDS, undefined, true).distance;
  const coast = simulate(COAST, RUN_SECONDS, undefined, true).distance;
  const brake = simulate(BRAKE, RUN_SECONDS, undefined, true).distance;
  assert.ok(boost > coast * 1.15, `boost ${boost} vs coast ${coast}`);
  assert.ok(brake < coast * 0.75, `brake ${brake} vs coast ${coast}`);
});

test('S holds the jelly near minimum speed, W makes it fast', () => {
  const SETTLE = 10;
  let brakeSum = 0, boostSum = 0, samples = 0;
  simulate(BRAKE, RUN_SECONDS, (ball, time) => { if (time > SETTLE) { brakeSum += ballSpeed(ball); samples++; } }, true);
  simulate(BOOST, RUN_SECONDS, (ball, time) => { if (time > SETTLE) boostSum += ballSpeed(ball); }, true);
  const brakeMean = brakeSum / samples, boostMean = boostSum / samples;
  assert.ok(brakeMean < MIN_SPEED * 2, `mean braking speed ${brakeMean}`);
  assert.ok(boostMean > brakeMean * 2.5, `mean boost speed ${boostMean} vs brake ${brakeMean}`);
});

test('A steers left (-x) and D steers right (+x) of the coasting line', () => {
  const STEER_SECONDS = 2;
  const coast = simulate(COAST, STEER_SECONDS).x;
  const left = simulate(LEFT, STEER_SECONDS).x;
  const right = simulate(RIGHT, STEER_SECONDS).x;
  assert.ok(left < coast - 3, `left ${left} vs coast ${coast}`);
  assert.ok(right > coast + 3, `right ${right} vs coast ${coast}`);
});

test('rocks are deterministic, sit on the ground, and get hit on a long run', () => {
  const a = createRock(), b = createRock();
  let found = 0;
  for (let cz = -400; cz < 0; cz++) {
    for (let cx = -3; cx <= 3; cx++) {
      const hasA = rockInCell(cx, cz, a), hasB = rockInCell(cx, cz, b);
      assert.equal(hasA, hasB);
      if (!hasA) continue;
      found++;
      assert.deepEqual(a, b);
      assert.equal(rockCellIndex(a.x), cx);
      assert.equal(rockCellIndex(a.z), cz);
      assert.ok(Math.abs(a.y - terrainHeight(a.x, a.z)) < a.radius, 'rock floats or is buried');
    }
  }
  assert.ok(found > 100, `only ${found} rocks in ${400 * ROCK_CELL} m`);
  let hits = 0;
  simulate(COAST, LONG_RUN_SECONDS, ball => { if (ball.rockImpact > 0) hits++; }, true);
  assert.ok(hits > 0, 'a coasting run never touched a rock');
});

test('the jelly gets airborne on a boosted run and wobble stays bounded', () => {
  const wobble = createWobble();
  let airborneSteps = 0, maxSquash = 0;
  simulate(BOOST, LONG_RUN_SECONDS, ball => {
    stepWobble(wobble, ball, PHYSICS_STEP);
    if (!ball.grounded) airborneSteps++;
    maxSquash = Math.max(maxSquash, Math.abs(wobble.squash));
    assert.ok(Number.isFinite(wobble.squash + wobble.leanX + wobble.leanZ));
    assert.ok(Math.abs(wobble.squash) <= 0.5 && Math.hypot(wobble.leanX, wobble.leanZ) < 0.5);
  }, true);
  assert.ok(airborneSteps > PHYSICS_HZ, 'never left the ground');
  assert.ok(maxSquash > 0.12, `wobble never exceeded ${maxSquash}`);
});

test('steering flat out into either bank never carries the jelly over the ridge', () => {
  for (const steer of [-1, 1]) {
    let farthest = 0;
    simulate({ throttle: 1, steer }, LONG_RUN_SECONDS, ball => {
      farthest = Math.max(farthest, Math.abs(ball.x - courseCenter(-ball.z)) - courseHalfWidth(-ball.z));
    }, true);
    assert.ok(farthest < RIDGE_DISTANCE, `steer ${steer} reached ${farthest} m past the valley edge`);
  }
});

test('Space hops the jelly: it leaves the ground, clears a metre, and holding does not repeat', () => {
  const SETTLE = 2, WATCH = 1.2;
  const ball = createBall();
  const input: ControlInput = { throttle: -1, steer: 0, jump: false };
  for (let i = 0; i < SETTLE * PHYSICS_HZ; i++) stepBall(ball, input, PHYSICS_STEP);
  assert.ok(ball.grounded, 'not settled on the ground before the jump');
  input.jump = true;
  let jumps = 0, peak = -Infinity;
  for (let i = 0; i < WATCH * PHYSICS_HZ; i++) {
    stepBall(ball, input, PHYSICS_STEP);
    if (ball.jumped) jumps++;
    peak = Math.max(peak, ball.y - ball.radius - terrainHeight(ball.x, ball.z));
  }
  assert.equal(jumps, 1, 'holding Space must jump exactly once');
  assert.ok(peak > 1, `hop only cleared ${peak} m`);
  input.jump = false;
  for (let i = 0; i < SETTLE * PHYSICS_HZ; i++) stepBall(ball, input, PHYSICS_STEP);
  input.jump = true;
  stepBall(ball, input, PHYSICS_STEP);
  assert.ok(ball.jumped || !ball.grounded, 'a fresh press after landing should jump again');
});

test('no jump without Space, and no jump in mid-air', () => {
  const ball = createBall();
  ball.y += 30;
  let jumps = 0;
  for (let i = 0; i < PHYSICS_HZ; i++) {
    stepBall(ball, { throttle: 0, steer: 0, jump: i % 20 === 0 }, PHYSICS_STEP);
    if (ball.jumped) jumps++;
  }
  assert.equal(jumps, 0, 'jumped while falling from 30 m');
});

test('wear is a threat: with no mushrooms a fresh jelly shrinks to nothing in about a kilometre', () => {
  const ball = createBall();
  let metres = 0, previous = ball.radius;
  while (!ball.wornOut && metres < 10_000) {
    wear(ball, 1);
    metres++;
    assert.ok(ball.radius < previous || ball.wornOut, 'wear must always shrink the jelly');
    previous = ball.radius;
  }
  assert.equal(ball.wornOut, true);
  assert.ok(metres > 700 && metres < 1500, `a fresh jelly lasted ${metres} m`);
  assert.equal(ball.radius, MIN_RADIUS);
  assert.ok(MIN_RADIUS < START_RADIUS * 0.1, 'worn out should mean shrunk to (nearly) nothing');
  const before = { x: ball.x, z: ball.z };
  stepBall(ball, COAST, PHYSICS_STEP);
  assert.deepEqual({ x: ball.x, z: ball.z }, before, 'a worn-out jelly must hold still');
});

test('a bigger jelly wears faster than a small one', () => {
  const small = createBall(), big = createBall();
  big.radius = START_RADIUS * 2;
  const smallBefore = small.radius, bigBefore = big.radius;
  wear(small, 100); wear(big, 100);
  assert.ok(bigBefore - big.radius > smallBefore - small.radius);
});

test('rolling straight past the mushrooms ends the run; it is the merging that keeps a jelly alive', () => {
  // Boosting dead straight for ten minutes is known to starve (measured: gone in ~100 s).
  const starved = simulate(BOOST, LONG_RUN_SECONDS);
  assert.equal(starved.wornOut, true, `a straight boosted run survived at radius ${starved.radius}`);
  assert.ok(starved.merges > 0, 'it should at least have clipped a few mushrooms on the way');
});

test('merging conserves volume when small and never exceeds the maximum size', () => {
  const ball = createBall();
  const mushroomRadius = 0.3;
  const room = 1 - (START_RADIUS / MAX_RADIUS) ** 3;
  grow(ball, mushroomRadius);
  assert.ok(Math.abs(ball.radius ** 3 - (START_RADIUS ** 3 + mushroomRadius ** 3 * room)) < 1e-9);
  assert.ok(ball.radius > START_RADIUS);
  for (let i = 0; i < 5000; i++) grow(ball, MUSHROOM_MAX_RADIUS);
  assert.ok(ball.radius <= MAX_RADIUS && ball.radius > MAX_RADIUS * 0.95, `radius ${ball.radius}`);
});

test('mushrooms are plentiful, deterministic, varied, and sit in the valley', () => {
  const a = createMushroom(), b = createMushroom();
  const looks = new Set<number>(), colors = new Set<number>();
  let found = 0;
  const LENGTH_CELLS = 500, HALF_CELLS = 12;
  for (let cz = -LENGTH_CELLS; cz < 0; cz++) {
    const s = -(cz + 0.5) * MUSHROOM_CELL;
    const centreCell = mushroomCellIndex(courseCenter(s));
    for (let cx = centreCell - HALF_CELLS; cx <= centreCell + HALF_CELLS; cx++) {
      const has = mushroomInCell(cx, cz, a);
      assert.equal(has, mushroomInCell(cx, cz, b));
      if (!has) continue;
      found++;
      assert.deepEqual(a, b);
      assert.ok(a.radius >= MUSHROOM_MIN_RADIUS && a.radius <= MUSHROOM_MAX_RADIUS);
      assert.notEqual(a.color, a.color2);
      assert.ok(a.y > terrainHeight(a.x, a.z), 'mushroom is underground');
      looks.add(a.look); colors.add(a.color);
    }
  }
  // 2 km of valley, in patches with bare ground between: still "lots and lots".
  assert.ok(found > 1000, `only ${found} mushrooms in ${LENGTH_CELLS * MUSHROOM_CELL} m`);
  assert.equal(looks.size, 12, 'not every look appears');
  assert.equal(colors.size, 6, 'not every colour appears');
});

test('rolling through mushrooms merges each one once, and every merge makes the jelly bigger', () => {
  const seen = new Set<string>();
  let reported = 0, before = START_RADIUS;
  const ball = simulate(COAST, RUN_SECONDS, b => {
    if (b.pickupCount > 0) assert.ok(b.radius > before, `radius ${b.radius} after a merge, ${before} before`);
    before = b.radius;
    for (let i = 0; i < b.pickupCount; i++) {
      reported++;
      const p = b.pickups[i];
      assert.ok(Math.abs(Math.hypot(p.dx, p.dy, p.dz) - 1) < 1e-9, 'pickup direction is not unit length');
      seen.add(`${p.seed}`);
    }
  }, true);
  assert.ok(ball.merges > 5, `only ${ball.merges} merges in ${RUN_SECONDS} s of coasting`);
  assert.equal(reported, ball.merges);
  assert.equal(seen.size, ball.merges, 'a mushroom was absorbed twice');
});

test('air time counts exactly the seconds spent off the ground, and a jump adds to it', () => {
  const SETTLE = 2, WATCH = 2;
  const ball = createBall();
  const input: ControlInput = { throttle: -1, steer: 0, jump: false };
  let airborneSteps = 0;
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * PHYSICS_HZ; i++) {
      stepBall(ball, input, PHYSICS_STEP);
      if (!ball.grounded) airborneSteps++;
    }
  };
  run(SETTLE);
  const before = ball.airSeconds;
  input.jump = true;
  run(WATCH);
  assert.ok(Math.abs(ball.airSeconds - airborneSteps * PHYSICS_STEP) < 1e-9, 'air time disagrees with airborne steps');
  assert.ok(ball.airSeconds - before > 0.5, `a jump added only ${ball.airSeconds - before} s of air time`);
});
