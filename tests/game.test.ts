import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BIOME_COUNT, BIOME_LENGTH, BIOME_ORDER, BIOME_TRANSITION, BIOMES, ICE, LAVA, MEADOW, SCREE, positionOfBiome, biomeBlend, biomeStretch, collectibleKind, dominantBiome,
  hillScale, speedScale, steerScale, wearScale, widthScale,
} from '../src/game/biomes.ts';
import { KIND_NAMES, LOOK, mushroomCellIndex, mushroomInCell, createMushroom } from '../src/game/mushrooms.ts';
import { LOOKS } from '../src/render/jelly-looks.ts';
import { createMagnet, magnetInSegment, magnetSegment } from '../src/game/magnets.ts';
import { ballSpeed, createBall, grantMagnet, grow, magnetActive, stepBall, wear, type Ball, type ControlInput } from '../src/game/physics.ts';
import { createRock, rockCellIndex, rockInCell } from '../src/game/rocks.ts';
import { courseCenter, courseHalfWidth, terrainHeight, terrainNormal } from '../src/game/terrain.ts';
import {
  MUSHROOM_CELL, MUSHROOM_MAX_RADIUS, MUSHROOM_MIN_RADIUS, MAX_RADIUS, MEAN_SLOPE, MIN_RADIUS, MIN_SPEED, PHYSICS_HZ, PHYSICS_STEP,
  RIDGE_DISTANCE, ROCK_CELL, START_RADIUS, KMH_PER_MS, MAX_SPEED, CRUISE_SPEED, GRAVITY, BOOST_ACCEL, NUDGE_ACCEL, ROLLER_WAVELENGTH, KNOLL_WAVELENGTH, MAGNET_RADIUS, MAGNET_SECONDS, MAGNET_SPACING,
  MAGNET_FLOAT_HEIGHT, MUSHROOM_TOUCH,
} from '../src/game/tuning.ts';
import { createWobble, stepWobble } from '../src/game/wobble.ts';

const COAST: ControlInput = { throttle: 0, steer: 0 };
const BOOST: ControlInput = { throttle: 1, steer: 0 };
const BRAKE: ControlInput = { throttle: -1, steer: 0 };
const LEFT: ControlInput = { throttle: 0, steer: -1 };
const RIGHT: ControlInput = { throttle: 0, steer: 1 };

/** A point well inside the meadow, where every biome multiplier is exactly 1. */
const MEADOW_MIDDLE = BIOME_LENGTH * (MEADOW + 0.5);
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
  // At speed the jelly rides high up the banks, but never over the ridge.
  assert.ok(maxOutside < RIDGE_DISTANCE, `climbed ${maxOutside} m up the valley wall`);
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

test('wear is a threat: in the meadow, with nothing to eat, a fresh jelly shrinks to nothing in about a kilometre', () => {
  const ball = createBall();
  ball.z = -MEADOW_MIDDLE;
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
  small.z = big.z = -MEADOW_MIDDLE;
  big.radius = START_RADIUS * 2;
  const smallBefore = small.radius, bigBefore = big.radius;
  wear(small, 100); wear(big, 100);
  assert.ok(bigBefore - big.radius > smallBefore - small.radius);
});

test('the cap is 150 km/h and never passed; holding W gets close to it, coasting stays slow, and nothing is skipped at speed', () => {
  let fastest = 0, merges = 0;
  simulate(BOOST, LONG_RUN_SECONDS, ball => {
    const speed = ballSpeed(ball);
    fastest = Math.max(fastest, speed);
    merges = ball.merges;
    assert.ok(speed <= MAX_SPEED * (1 + 1e-9), `${speed * KMH_PER_MS} km/h is over the limit`);
    assert.ok(terrainHeight(ball.x, ball.z) - ball.y < ball.radius, 'the jelly went through the ground at speed');
  }, true);
  assert.equal(Math.round(MAX_SPEED * KMH_PER_MS), 150);
  assert.ok(fastest > MAX_SPEED * 0.9, `only reached ${fastest * KMH_PER_MS} km/h`);
  assert.ok(merges > 0, 'a fast jelly should still be able to merge with mushrooms it rolls through');
  // Left alone, the jelly rolls well below cruise speed on average: W is what gets it there.
  let total = 0, steps = 0;
  simulate(COAST, RUN_SECONDS, ball => { total += ballSpeed(ball); steps++; }, true);
  const coasting = total / steps;
  assert.ok(coasting < CRUISE_SPEED * 0.65, `coasting averaged ${coasting * KMH_PER_MS} km/h`);
});

test('each loop of the biomes raises the minimum and default speeds by 20%', () => {
  const loopMiddle = (loop: number) => loop * BIOME_COUNT * BIOME_LENGTH + BIOME_LENGTH / 2;
  for (let loop = 0; loop < 3; loop++) {
    assert.ok(Math.abs(speedScale(loopMiddle(loop)) - 1.2 ** loop) < 1e-9, `loop ${loop}: ${speedScale(loopMiddle(loop))}`);
  }
  // Blended across the boundary, not a step.
  const boundary = BIOME_COUNT * BIOME_LENGTH;
  assert.ok(Math.abs(speedScale(boundary - BIOME_TRANSITION) - 1) < 1e-9);
  assert.ok(Math.abs(speedScale(boundary + BIOME_TRANSITION) - 1.2) < 1e-9);
  assert.ok(speedScale(boundary) > 1.05 && speedScale(boundary) < 1.15);
});

test('the speed a jelly coasts at, and the slowest it can be braked to, rise with each loop', () => {
  const meanSpeed = (loop: number, input: ControlInput) => {
    const ball = createBall();
    const start = loop * BIOME_COUNT * BIOME_LENGTH + BIOME_LENGTH / 4;
    ball.z = -start; ball.x = courseCenter(start); ball.y = terrainHeight(ball.x, ball.z) + ball.radius + 0.1;
    ball.vz = -MIN_SPEED * 1.2 ** loop;
    let total = 0, steps = 0;
    for (let i = 0; i < PHYSICS_HZ * 40; i++) {
      ball.radius = START_RADIUS; ball.wornOut = false;
      stepBall(ball, input, PHYSICS_STEP);
      if (i > PHYSICS_HZ * 10) { total += Math.hypot(ball.vx, ball.vz); steps++; }
    }
    return total / steps;
  };
  for (const input of [COAST, BRAKE]) {
    const first = meanSpeed(0, input), second = meanSpeed(1, input);
    assert.ok(second > first * 1.12, `${JSON.stringify(input)}: ${second} vs ${first}`);
  }
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
  // The meadow, where every look grows.
  const LENGTH_CELLS = 340, HALF_CELLS = 12, FIRST = -Math.round((BIOME_LENGTH * MEADOW + 30) / MUSHROOM_CELL);
  for (let cz = FIRST - LENGTH_CELLS; cz < FIRST; cz++) {
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
  // 1.3 km of valley, in patches with bare ground between: still "lots and lots".
  assert.ok(found > 700, `only ${found} mushrooms in ${LENGTH_CELLS * MUSHROOM_CELL} m`);
  assert.equal(looks.size, 12, 'not every look appears');
  assert.equal(colors.size, 6, 'not every colour appears');
});

test('rolling through mushrooms merges each one once, and every merge makes the jelly bigger', () => {
  // Slower travel covers less ground per second, so this watches three times the 60 s used elsewhere.
  const MERGE_RUN_SECONDS = RUN_SECONDS * 3;
  const seen = new Set<string>();
  let reported = 0, before = START_RADIUS;
  const ball = simulate(COAST, MERGE_RUN_SECONDS, b => {
    // A hole melting the jelly in the same step is a different effect; this checks the merge itself.
    // The run is kept alive by resetting the radius every step, so a merge is judged against that.
    if (b.pickupCount > 0 && b.hazardDepth === 0) assert.ok(b.radius > START_RADIUS, `radius ${b.radius} after a merge, ${START_RADIUS} at the start of the step`);
    before = b.radius;
    for (let i = 0; i < b.pickupCount; i++) {
      reported++;
      const p = b.pickups[i];
      assert.ok(Math.abs(Math.hypot(p.dx, p.dy, p.dz) - 1) < 1e-9, 'pickup direction is not unit length');
      seen.add(`${p.seed}`);
    }
  }, true);
  assert.ok(ball.merges > 5, `only ${ball.merges} merges in ${MERGE_RUN_SECONDS} s of coasting`);
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

/** A mushroom that exists, and a spot `gap` metres up the course from it, for placing a jelly beside it. */
function findMushroom(fromS: number) {
  const mushroom = createMushroom();
  for (let cz = mushroomCellIndex(-fromS); cz > mushroomCellIndex(-fromS) - 400; cz--) {
    const centre = mushroomCellIndex(courseCenter(-cz * MUSHROOM_CELL));
    for (let cx = centre - 6; cx <= centre + 6; cx++) if (mushroomInCell(cx, cz, mushroom)) return mushroom;
  }
  throw new Error('no mushroom found');
}

/** A jelly at rest `away` metres to the side of a mushroom, clear of the ground so nothing shoves it. */
function ballBeside(mushroom: { x: number; y: number; z: number }, away: number): Ball {
  const CLEARANCE = 0.2;
  const ball = createBall();
  ball.x = mushroom.x + away; ball.z = mushroom.z;
  ball.y = Math.max(mushroom.y, terrainHeight(ball.x, ball.z) + ball.radius + CLEARANCE);
  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  return ball;
}

const distanceTo = (ball: Ball, point: { x: number; y: number; z: number }) =>
  Math.hypot(point.x - ball.x, point.y - ball.y, point.z - ball.z);

test('magnets are placed deterministically, float above the valley floor, and appear along the course', () => {
  const a = createMagnet(), b = createMagnet();
  let found = 0;
  const SEGMENTS = 100;
  for (let segment = 0; segment < SEGMENTS; segment++) {
    const has = magnetInSegment(segment, a);
    assert.equal(has, magnetInSegment(segment, b));
    if (!has) continue;
    found++;
    assert.deepEqual(a, b);
    assert.equal(magnetSegment(-a.z), segment);
    assert.ok(Math.abs(a.x - courseCenter(-a.z)) < courseHalfWidth(-a.z), 'magnet is outside the valley');
    assert.ok(Math.abs(a.y - terrainHeight(a.x, a.z) - MAGNET_FLOAT_HEIGHT) < 1e-9);
    assert.ok(-a.z > 50, 'a magnet sits on the start line');
  }
  assert.ok(found > SEGMENTS / 2 && found < SEGMENTS, `${found} magnets in ${SEGMENTS * MAGNET_SPACING} m`);
});

test('rolling through a magnet switches it on for ten seconds, once', () => {
  const magnet = createMagnet();
  let segment = 0;
  while (!magnetInSegment(segment, magnet)) segment++;
  const ball = createBall();
  ball.x = magnet.x; ball.y = magnet.y; ball.z = magnet.z + 3;
  ball.vx = 0; ball.vy = 0; ball.vz = -15;
  assert.equal(magnetActive(ball), false);
  let picked = 0;
  for (let i = 0; i < PHYSICS_HZ; i++) { stepBall(ball, COAST, PHYSICS_STEP); if (ball.magnetPicked) picked++; }
  assert.equal(picked, 1, 'the magnet should be picked up exactly once');
  assert.ok(magnetActive(ball));
  assert.ok(ball.magnetSeconds > MAGNET_SECONDS - 1.1 && ball.magnetSeconds <= MAGNET_SECONDS);
  assert.equal(MAGNET_SECONDS, 10);
});

test('a magnet pulls in mushrooms the jelly is not touching, only within its radius, and only while it lasts', () => {
  const mushroom = findMushroom(400);
  const NEAR = START_RADIUS + MAGNET_RADIUS * 0.6;
  const FAR = START_RADIUS + MAGNET_RADIUS + mushroom.radius * MUSHROOM_TOUCH + 3;
  const mergedIt = (ball: Ball) => {
    for (let i = 0; i < ball.pickupCount; i++) if (ball.pickups[i].seed === mushroom.seed) return ball.pickups[i];
    return undefined;
  };

  const without = ballBeside(mushroom, NEAR);
  stepBall(without, COAST, PHYSICS_STEP);
  assert.equal(mergedIt(without), undefined, 'merged from a distance with no magnet');

  const withMagnet = ballBeside(mushroom, NEAR);
  grantMagnet(withMagnet);
  const before = withMagnet.radius, apart = distanceTo(withMagnet, mushroom);
  assert.ok(apart > START_RADIUS + 3, 'the test should start well clear of the mushroom');
  stepBall(withMagnet, COAST, PHYSICS_STEP);
  const pickup = mergedIt(withMagnet);
  assert.ok(pickup, 'the magnet did not pull in a mushroom inside its radius');
  assert.ok(Math.abs(pickup.distance - apart) < 0.1, `pickup reports ${pickup.distance} m, the mushroom was ${apart} m away`);
  assert.ok(withMagnet.radius > before, 'a pulled-in mushroom should make the jelly grow');

  const tooFar = ballBeside(mushroom, FAR);
  grantMagnet(tooFar);
  stepBall(tooFar, COAST, PHYSICS_STEP);
  assert.equal(mergedIt(tooFar), undefined, 'the magnet reached beyond its radius');

  const expired = ballBeside(mushroom, NEAR);
  grantMagnet(expired);
  expired.magnetSeconds = PHYSICS_STEP / 2;
  stepBall(expired, COAST, PHYSICS_STEP);
  assert.equal(magnetActive(expired), false, 'the magnet outlasted its time');
  assert.equal(mergedIt(expired), undefined, 'an expired magnet still pulled');
});

test('a magnet makes a run collect far more mushrooms', () => {
  const SECONDS = 10, PATCH_START = 585;
  const run = (magnet: boolean) => {
    const ball = createBall();
    // Just uphill of a dense patch (found by scanning the course).
    ball.z = -PATCH_START; ball.x = courseCenter(PATCH_START); ball.y = terrainHeight(ball.x, ball.z) + ball.radius;
    if (magnet) grantMagnet(ball);
    for (let i = 0; i < SECONDS * PHYSICS_HZ; i++) {
      ball.radius = START_RADIUS; ball.wornOut = false;
      stepBall(ball, COAST, PHYSICS_STEP);
    }
    return ball.merges;
  };
  const plain = run(false), pulled = run(true);
  assert.ok(pulled > plain * 3 && pulled > 10, `${pulled} merges with a magnet vs ${plain} without`);
});

test('the run starts in the meadow, then goes scree, ice, dunes, cave, lava, and each biome is the biome in its place', () => {
  assert.deepEqual(BIOME_ORDER.map(kind => BIOMES[kind].name), ['Meadow', 'Scree', 'Ice', 'Dunes', 'Cave', 'Lava']);
  assert.equal(dominantBiome(0), MEADOW);
  assert.equal(dominantBiome(BIOME_LENGTH * 1.5), SCREE);
  assert.equal(dominantBiome(BIOME_LENGTH * 2.5), ICE);
  assert.equal(BIOME_LENGTH, 1500);
  for (let position = 0; position < BIOME_COUNT; position++) {
    const kind = BIOME_ORDER[position];
    const middle = BIOME_LENGTH * (position + 0.5);
    assert.equal(dominantBiome(middle), kind);
    assert.equal(positionOfBiome(kind), position);
    assert.ok(Math.abs(wearScale(middle) - BIOMES[kind].wear) < 1e-12, `wear in the middle of ${BIOMES[kind].name}`);
  }
});

test('biomes change over 400 m, smoothly, with no jump anywhere', () => {
  assert.equal(BIOME_TRANSITION, 400);
  const boundary = BIOME_LENGTH;
  assert.equal(biomeBlend(boundary - 201, 0), 0);
  assert.equal(biomeBlend(boundary + 201, 0), 1);
  assert.ok(Math.abs(biomeBlend(boundary, 0) - 0.5) < 1e-12);
  // Every blended quantity, and the ground itself, is continuous across three biomes' worth of course.
  const STEP = 0.5;
  let previousBlend = 0, previousHeight = terrainHeight(courseCenter(0), 0);
  let previous = [wearScale(0), steerScale(0), hillScale(0), widthScale(0)];
  for (let s = STEP; s < BIOME_LENGTH * 3; s += STEP) {
    const values = [wearScale(s), steerScale(s), hillScale(s), widthScale(s)];
    values.forEach((value, i) => assert.ok(Math.abs(value - previous[i]) < 0.02, `quantity ${i} jumps at ${s} m`));
    previous = values;
    const height = terrainHeight(courseCenter(s), -s);
    assert.ok(Math.abs(height - previousHeight) < 1.5, `the ground steps ${height - previousHeight} m at ${s} m`);
    previousHeight = height;
    if (biomeStretch(s) === biomeStretch(s - STEP)) assert.ok(biomeBlend(s) >= previousBlend - 1e-12, 'blend must not run backwards');
    previousBlend = biomeBlend(s);
  }
});

test('after the last biome the sequence repeats, harder', () => {
  const lap = BIOME_LENGTH * BIOME_COUNT;
  for (let position = 0; position < BIOME_COUNT; position++) {
    const middle = BIOME_LENGTH * (position + 0.5);
    assert.equal(dominantBiome(middle + lap), BIOME_ORDER[position]);
    assert.ok(wearScale(middle + lap) > wearScale(middle) * 1.2, `${BIOMES[BIOME_ORDER[position]].name} is no harder second time round`);
  }
  assert.ok(wearScale(BIOME_LENGTH * (positionOfBiome(LAVA) + 0.5)) > wearScale(BIOME_LENGTH * (positionOfBiome(MEADOW) + 0.5)) * 3);
});

test('each biome grows its own kind of thing; only transitions mix two kinds', () => {
  assert.deepEqual([...KIND_NAMES], ['mushroom', 'snowball', 'cactus', 'ore', 'ember', 'crystal']);
  assert.deepEqual(Object.keys(LOOK).map(name => name.toLowerCase()), LOOKS.map(name => name.replace('-', '')), 'look ids out of step with the renderer');
  const item = createMushroom();
  const kindsNear = (s: number, span: number) => {
    const kinds = new Set<number>();
    for (let cz = mushroomCellIndex(-(s + span)); cz <= mushroomCellIndex(-(s - span)); cz++) {
      const centre = mushroomCellIndex(courseCenter(-cz * MUSHROOM_CELL));
      for (let cx = centre - 10; cx <= centre + 10; cx++) if (mushroomInCell(cx, cz, item)) kinds.add(item.kind);
    }
    return kinds;
  };
  for (let position = 0; position < BIOME_COUNT; position++) {
    const kind = BIOME_ORDER[position];
    assert.deepEqual([...kindsNear(BIOME_LENGTH * (position + 0.5), 400)], [kind], `the middle of ${BIOMES[kind].name} should grow only ${KIND_NAMES[kind]}s`);
  }
  assert.deepEqual([...kindsNear(BIOME_LENGTH, 60)].sort(), [MEADOW, SCREE].sort(), 'the meadow-to-scree transition should mix mushrooms and crystals');
  assert.equal(collectibleKind(BIOME_LENGTH - 250, 0.99), MEADOW);
});

test('ice is slippery: the same steering moves the jelly less than in the meadow', () => {
  const drift = (s: number) => {
    const at = (steer: number) => {
      const ball = createBall();
      ball.z = -s; ball.x = courseCenter(s); ball.y = terrainHeight(ball.x, ball.z) + ball.radius;
      for (let i = 0; i < PHYSICS_HZ; i++) stepBall(ball, { throttle: 0, steer }, PHYSICS_STEP);
      return ball.x;
    };
    return at(1) - at(0);
  };
  const ice = drift(BIOME_LENGTH * (positionOfBiome(ICE) + 0.5)), meadow = drift(MEADOW_MIDDLE);
  assert.ok(ice > 0.5 && meadow > 0.5, 'steering right should move right in both');
  assert.ok(ice < meadow * 0.85, `ice ${ice} m vs meadow ${meadow} m`);
});

test('the ground has relief at several scales, not one smooth undulation', () => {
  // Height along the valley floor with the overall descent taken out, then how
  // much of its movement happens at each scale.
  const STEP = 0.5, LENGTH = 1200, START = 200;
  const heights: number[] = [];
  for (let s = START; s < START + LENGTH; s += STEP) heights.push(terrainHeight(courseCenter(s), -s) + MEAN_SLOPE * s);
  /** Mean absolute change in height over `metres`, after removing the change over twice that span. */
  const energyAt = (metres: number) => {
    const half = Math.round(metres / 2 / STEP);
    let total = 0, count = 0;
    for (let i = half; i < heights.length - half; i++) {
      total += Math.abs(heights[i] - (heights[i - half] + heights[i + half]) / 2);
      count++;
    }
    return total / count;
  };
  assert.ok(energyAt(KNOLL_WAVELENGTH) > 0.05, `knoll-scale relief is only ${energyAt(KNOLL_WAVELENGTH)} m`);
  assert.ok(energyAt(ROLLER_WAVELENGTH) > 0.15, `roller-scale relief is only ${energyAt(ROLLER_WAVELENGTH)} m`);
  assert.ok(energyAt(140) > 0.5, `hill-scale relief is only ${energyAt(140)} m`);
});

test('nothing can trap the jelly: no slope in any biome is steeper than the course can pull it up', () => {
  // The pull that keeps the jelly moving is NUDGE_ACCEL; gravity on a slope is
  // g x slope. Check every metre of valley floor through all five biomes.
  const climbable = NUDGE_ACCEL / GRAVITY;
  const STEP = 0.5, FLOOR = [-9, -6, 0, 6, 9], BANKS = [-18, -12, 12, 18];
  // On the banks a liquid hole is a scoop that must be deeper than its lowest rim point, so the face of it
  // toward the course can be steeper than the floor's; there the nudge and W together still climb it.
  const bankClimbable = (NUDGE_ACCEL + BOOST_ACCEL) / GRAVITY;
  let steepestFloor = 0, steepestBank = 0;
  for (let s = 0; s < BIOME_LENGTH * BIOME_COUNT; s += 1) {
    for (const offset of [...FLOOR, ...BANKS]) {
      const x = courseCenter(s) + offset;
      // Travel is toward larger s, so a positive rise here is uphill.
      const rise = (terrainHeight(x, -(s + STEP)) - terrainHeight(x, -s)) / STEP;
      if (BANKS.includes(offset)) steepestBank = Math.max(steepestBank, rise); else steepestFloor = Math.max(steepestFloor, rise);
    }
  }
  // The floor's own hills reach about 0.7, so holes cannot be held to the old 0.8 of climbable; the dynamic test below (holding S through every kind of hole) is what shows the jelly gets out.
  assert.ok(steepestFloor < climbable * 0.95, `an uphill of ${steepestFloor} on the floor against a climbable ${climbable}`);
  assert.ok(steepestBank < bankClimbable * 0.9, `an uphill of ${steepestBank} on the banks against a climbable ${bankClimbable}`);
});

test('holding S through every biome, the jelly is never held up', () => {
  const SLOW = MIN_SPEED * 0.8, MAX_SLOW_SECONDS = 1.5, SECONDS = 150;
  for (let biome = 0; biome < BIOME_COUNT; biome++) {
    const ball = createBall();
    const start = BIOME_LENGTH * biome + 250;
    ball.z = -start; ball.x = courseCenter(start); ball.y = terrainHeight(ball.x, ball.z) + ball.radius;
    let slowFor = 0, longest = 0;
    for (let i = 0; i < SECONDS * PHYSICS_HZ; i++) {
      ball.radius = START_RADIUS; ball.wornOut = false;
      stepBall(ball, BRAKE, PHYSICS_STEP);
      slowFor = Math.hypot(ball.vx, ball.vz) < SLOW ? slowFor + PHYSICS_STEP : 0;
      longest = Math.max(longest, slowFor);
    }
    assert.ok(longest < MAX_SLOW_SECONDS, `${BIOMES[biome].name}: stayed under ${SLOW} m/s for ${longest} s`);
    assert.ok(-ball.z - start > SECONDS * MIN_SPEED * 0.5, `${BIOMES[biome].name}: only advanced ${-ball.z - start} m`);
  }
});
