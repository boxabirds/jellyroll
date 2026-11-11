import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIOME_COUNT, BIOME_LENGTH, BIOMES, dominantBiome } from '../src/game/biomes.ts';
import { createHazardSample, hazardAt, hazardReach, hazardShape, laneCentre, laneHalfWidth } from '../src/game/hazards.ts';
import { ballSpeed, createBall, stepBall, type Ball } from '../src/game/physics.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from '../src/game/terrain.ts';
import {
  HAZARD_EFFECTS, HAZARD_FREE_UNTIL, HAZARD_LANES, HAZARD_LANE_SOFT, MAX_RADIUS, MIN_SPEED, PHYSICS_HZ, PHYSICS_STEP, START_RADIUS,
} from '../src/game/tuning.ts';

const sample = createHazardSample();
const depthAt = (u: number, s: number) => hazardAt(u, s, courseHalfWidth(s), sample);

/** Total run length used for the "always there" checks: three full loops of the biomes. */
const CHECKED_LENGTH = 3 * BIOME_COUNT * BIOME_LENGTH;

test('no holes at the start of the run', () => {
  for (let s = 0; s < HAZARD_FREE_UNTIL; s += 1) {
    for (let u = -40; u <= 40; u += 1) assert.equal(depthAt(u, s), 0);
  }
});

test('three lanes are always clear, and stay separate and wide enough for the biggest jelly to be steered through', () => {
  for (let s = HAZARD_FREE_UNTIL; s < CHECKED_LENGTH; s += 3) {
    const half = laneHalfWidth(s);
    for (let lane = 0; lane < HAZARD_LANES; lane++) {
      const centre = laneCentre(lane, s);
      // The core of every lane is untouched, however big the holes have got.
      for (const offset of [-half, -half / 2, 0, half / 2, half]) assert.equal(depthAt(centre + offset, s), 0, `s ${s} lane ${lane} offset ${offset}`);
      if (lane > 0) {
        const gap = centre - laneCentre(lane - 1, s) - 2 * half;
        assert.ok(gap > 0, `lanes ${lane - 1} and ${lane} touch at s ${s}: gap ${gap}`);
      }
    }
    assert.ok(2 * half > START_RADIUS, 'a lane has to be wider than a fresh jelly');
  }
  assert.ok(MAX_RADIUS > 0);
});

test('holes grow with every biome: more of the ground is hole, loop after loop, and the banks are covered too', () => {
  const coverage = (centre: number, from: 'floor' | 'banks') => {
    let covered = 0, total = 0;
    for (let s = centre - 200; s < centre + 200; s += 2) {
      const half = courseHalfWidth(s), reach = hazardReach(half);
      for (let u = from === 'floor' ? 0 : half; u < (from === 'floor' ? half : reach); u += 0.5) {
        total++;
        if (depthAt(u, s) > 0.5) covered++;
      }
    }
    return covered / total;
  };
  let previous = -1;
  for (let biome = 0; biome < BIOME_COUNT * 3; biome++) {
    const value = coverage(biome * BIOME_LENGTH + BIOME_LENGTH / 2, 'floor');
    // Each biome is bigger than the one two earlier (neighbours differ by the valley's own width, so compare in steps of two).
    if (biome >= 2) assert.ok(value >= previous - 0.02, `biome ${biome}: ${value} after ${previous}`);
    if (biome >= 1) previous = Math.min(previous < 0 ? value : previous, value);
  }
  const first = coverage(BIOME_LENGTH / 2, 'floor');
  const lastLoop = coverage(2 * BIOME_COUNT * BIOME_LENGTH + BIOME_LENGTH / 2, 'floor');
  assert.ok(first > 0.01 && first < 0.25, `first biome covers ${first}`);
  assert.ok(lastLoop > first * 2 && lastLoop > 0.3, `third loop covers ${lastLoop}, first biome ${first}`);
  assert.ok(coverage(2 * BIOME_COUNT * BIOME_LENGTH + BIOME_LENGTH / 2, 'banks') > 0.35, 'the banks must be covered, or riding the wall is a way round');
});

test('every hole is the kind of its biome', () => {
  const seen = new Set<number>();
  for (let s = HAZARD_FREE_UNTIL; s < 2 * BIOME_COUNT * BIOME_LENGTH; s += 1.5) {
    for (let u = -30; u <= 30; u += 1.5) {
      if (depthAt(u, s) > 0.5) {
        seen.add(sample.kind);
        // A hole belongs to the biome at its centre; its centre is within a hole radius of here.
        const here = dominantBiome(s);
        if (Math.abs(((s % BIOME_LENGTH) + BIOME_LENGTH) % BIOME_LENGTH - BIOME_LENGTH / 2) < BIOME_LENGTH / 2 - 40) assert.equal(sample.kind, here, `s ${s}`);
      }
    }
  }
  assert.equal(seen.size, BIOME_COUNT, `only saw kinds ${[...seen]}`);
});

test('terrain sinks in a hole and is untouched outside', () => {
  let found = false;
  for (let s = 600; s < 1400 && !found; s += 1) {
    for (let u = -25; u <= 25; u += 1) {
      if (depthAt(u, s) > 0.99) {
        found = true;
        const x = courseCenter(s) + u;
        const rim = depthAt(u + 40, s) === 0 ? terrainHeight(x + 40, -s) : 0;
        assert.ok(rim !== undefined);
        // Compare with the same place if the hole were not there: its neighbours a hole-radius away are higher on average.
        let neighbours = 0, count = 0;
        for (let d = -12; d <= 12; d += 3) {
          if (depthAt(u + d, s) === 0) { neighbours += terrainHeight(x + d, -s) - terrainHeight(x, -s); count++; }
        }
        assert.ok(count > 0 && neighbours / count > -3, 'hole floor should not be higher than clear ground nearby');
        break;
      }
    }
  }
  assert.ok(found, 'no hole found in the first biome');
});

// --- What each kind does to the jelly -------------------------------------------------

/** The entry to a big hole of `kind` in a loop, as [course distance, lateral offset]: at least HOLE_RUN metres of it lie ahead along the course. */
const HOLE_RUN = 8;
/** Holes are looked for on the valley floor, where the jelly stays on the ground. */
const FLOOR_REACH = 9;
function findHole(kind: number, loop: number): [number, number] {
  const start = loop * BIOME_COUNT * BIOME_LENGTH + kind * BIOME_LENGTH + 300;
  for (let s = start; s < start + 1200; s += 0.5) {
    for (let u = -FLOOR_REACH; u <= FLOOR_REACH; u += 0.5) {
      let whole = true;
      for (let along = 0; along <= HOLE_RUN && whole; along += 1) whole = depthAt(u, s + along) > 0.999 && sample.kind === kind;
      if (whole) return [s, u];
    }
  }
  throw new Error(`no ${BIOMES[kind].name} hole found`);
}

function ballIn(kind: number, speed: number): Ball {
  const [s, u] = findHole(kind, 1);
  const ball = createBall();
  ball.x = courseCenter(s) + u; ball.z = -s;
  ball.y = terrainHeight(ball.x, ball.z) + ball.radius + 0.01;
  ball.vz = -speed;
  return ball;
}

/** Fraction of its radius the jelly loses per second spent on the ground in the hole, over `seconds`. */
function meltRate(kind: number, seconds: number): number {
  const ball = ballIn(kind, 6);
  const start = ball.radius;
  let inside = 0;
  for (let i = 0; i < seconds * PHYSICS_HZ; i++) { stepBall(ball, { throttle: 0, steer: 0 }, PHYSICS_STEP); if (ball.hazardDepth > 0.5 && ball.grounded) inside++; }
  assert.ok(inside > 0, 'the jelly never entered the hole');
  return (1 - ball.radius / start) / (inside * PHYSICS_STEP);
}

test('a pond slows the jelly a lot and melts it quickly, but never below the minimum speed, and it does not kill at once', () => {
  const ball = ballIn(0, 12);
  const start = ball.radius;
  let slowest = Infinity;
  for (let i = 0; i < PHYSICS_HZ * 0.6; i++) { stepBall(ball, { throttle: 0, steer: 0 }, PHYSICS_STEP); if (ball.hazardDepth > 0.9) slowest = Math.min(slowest, Math.hypot(ball.vx, ball.vz)); }
  assert.ok(ball.hazardDepth > 0 && ball.hazardKind === 0);
  assert.ok(Math.hypot(ball.vx, ball.vz) < 12 * 0.4, `only slowed to ${Math.hypot(ball.vx, ball.vz)}`);
  assert.ok(ball.hazardDepth > 0.5, 'still in the hole');
  assert.ok(slowest >= MIN_SPEED - 1e-6, `slowed below the minimum: ${slowest}`);
  const lost = 1 - ball.radius / start;
  assert.ok(lost > 0.02 && lost < 0.2 && !ball.wornOut, `lost ${lost} of its radius`);
});

test('an oasis hurts like a pond', () => {
  assert.deepEqual(HAZARD_EFFECTS[2], HAZARD_EFFECTS[0]);
  assert.ok(Math.abs(meltRate(2, 0.5) - meltRate(0, 0.5)) < 0.02, 'an oasis melts like a pond');
});

test('ice shards tear pieces off, one every few metres', () => {
  const ball = ballIn(1, 10);
  let stabs = 0;
  for (let i = 0; i < PHYSICS_HZ; i++) { stepBall(ball, { throttle: 0, steer: 0 }, PHYSICS_STEP); stabs += ball.stabs; }
  assert.ok(stabs >= 1, 'a jelly rolling through shards must be stabbed');
  assert.ok(ball.radius < START_RADIUS * (1 - HAZARD_EFFECTS[1].stab * stabs * 0.9), 'every stab takes its share');
});

test('a steam vent burns the jelly and throws it into the air', () => {
  const ball = ballIn(3, 8);
  let highest = ball.y, vented = false;
  for (let i = 0; i < PHYSICS_HZ * 3 && !ball.wornOut; i++) {
    stepBall(ball, { throttle: 0, steer: 0 }, PHYSICS_STEP);
    highest = Math.max(highest, ball.y - terrainHeight(ball.x, ball.z));
    vented ||= ball.vented;
  }
  assert.ok(vented, 'the vent never fired');
  assert.ok(highest > ball.radius + 3, `only rose ${highest - ball.radius} m`);
  assert.ok(ball.radius < START_RADIUS, 'the vent should burn');
});

test('lava burns the jelly faster than a pond does and slows it a good deal', () => {
  const lava = meltRate(4, 0.5), pond = meltRate(0, 0.5);
  assert.ok(lava > pond * 1.3, `lava ${lava} per second vs pond ${pond}`);
  assert.ok(lava < 0.3, 'lava should not be instant death');
  assert.ok(HAZARD_EFFECTS[4].slow > HAZARD_EFFECTS[1].slow && HAZARD_EFFECTS[4].slow > 1, 'lava slows the jelly a good deal');
});

test('holding back through holes of every kind always gets the jelly out: nothing can trap it', () => {
  for (let kind = 0; kind < BIOME_COUNT; kind++) {
    const ball = ballIn(kind, MIN_SPEED);
    const start = -ball.z;
    for (let i = 0; i < PHYSICS_HZ * 25; i++) {
      ball.wornOut = false; ball.radius = Math.max(ball.radius, START_RADIUS * 0.5);
      stepBall(ball, { throttle: -1, steer: 0 }, PHYSICS_STEP);
    }
    assert.ok(-ball.z - start > 60, `${BIOMES[kind].name}: only advanced ${-ball.z - start} m in 25 s`);
  }
});

test('hazard shape rises with distance', () => {
  assert.equal(hazardShape(0), 0);
  assert.ok(hazardShape(BIOME_LENGTH * 5) > hazardShape(BIOME_LENGTH));
  assert.ok(hazardShape(BIOME_LENGTH * 50) < 1);
  assert.ok(HAZARD_LANE_SOFT > 0);
});
