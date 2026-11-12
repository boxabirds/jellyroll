import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIOME_COUNT, BIOME_LENGTH, BIOMES, ICE, dominantBiome, positionOfBiome } from '../src/game/biomes.ts';
import { Stain, NO_STAIN, STAIN_FADE_SECONDS } from '../src/game/stain.ts';
import { holeLevel } from '../src/game/terrain.ts';
import { createHazardSample, hazardAt, hazardReach, hazardShape, isLiquidKind, laneCentre, laneHalfWidth, setHazardLevelBias } from '../src/game/hazards.ts';
import { ballSpeed, createBall, stepBall, wear, type Ball } from '../src/game/physics.ts';
import { courseCenter, courseHalfWidth, holeEffectAt, terrainHeight } from '../src/game/terrain.ts';
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
        if (depthAt(u, s) > 0.15) covered++;
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
  assert.ok(lastLoop > first * 2 && lastLoop > 0.15, `third loop covers ${lastLoop}, first biome ${first}`);
  assert.ok(coverage(2 * BIOME_COUNT * BIOME_LENGTH + BIOME_LENGTH / 2, 'banks') > 0.25, 'the banks must be covered, or riding the wall is a way round');
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
const SHARD_RUN = 7;
const WATER_RUN = 3, WATER_DEPTH = 0.6;
/** Holes are looked for on the valley floor, where the jelly stays on the ground. */
const FLOOR_REACH = 9;
function findHole(kind: number, loop: number, wetRun = WATER_RUN): [number, number] {
  // A pond has a wide, gentle bank, so less of it is fully wet.
  const run = isLiquidKind(kind) ? wetRun : HOLE_RUN, needed = isLiquidKind(kind) ? WATER_DEPTH : 0.999;
  const start = loop * BIOME_COUNT * BIOME_LENGTH + positionOfBiome(kind) * BIOME_LENGTH + 300;
  for (let s = start; s < start + 1200; s += 0.5) {
    for (let u = -FLOOR_REACH; u <= FLOOR_REACH; u += 0.5) {
      let whole = true;
      for (let along = 0; along <= run && whole; along += 1) whole = holeEffectAt(courseCenter(s + along) + u, -(s + along), sample) > needed && sample.kind === kind;
      if (whole) return [s, u];
    }
  }
  throw new Error(`no ${BIOMES[kind].name} hole found`);
}

function ballIn(kind: number, speed: number, wetRun = WATER_RUN): Ball {
  const [s, u] = findHole(kind, 2, wetRun);
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
  const ball = ballIn(0, 8);
  const start = ball.radius;
  let slowest = Infinity, inside = 0;
  for (let i = 0; i < PHYSICS_HZ * 0.5; i++) {
    stepBall(ball, { throttle: 0, steer: 0 }, PHYSICS_STEP);
    if (ball.hazardDepth > 0.5) { inside++; slowest = Math.min(slowest, Math.hypot(ball.vx, ball.vz)); }
  }
  assert.ok(inside > 0 && ball.hazardKind === 0, 'the jelly never got into the pond');
  assert.ok(slowest < 8 * 0.7, `only slowed to ${slowest}`);
  assert.ok(slowest >= MIN_SPEED - 1e-6, `slowed below the minimum: ${slowest}`);
  const lost = 1 - ball.radius / start;
  assert.ok(lost > 0.005 && lost < 0.2 && !ball.wornOut, `lost ${lost} of its radius`);
});

test('an oasis hurts like a pond', () => {
  assert.deepEqual(HAZARD_EFFECTS[2], HAZARD_EFFECTS[0]);
  const oasis = meltRate(2, 0.5), pond = meltRate(0, 0.5);
  assert.ok(oasis > 0.04 && pond > 0.04, `oasis ${oasis} per second, pond ${pond}: both should melt the jelly`);
});

test('ice shards tear pieces off, one every few metres', () => {
  // A stretch of shards long enough to be sure of a stab (one comes every HAZARD_STAB_SPACING metres).
  const ball = ballIn(1, 10, SHARD_RUN);
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
  assert.ok(highest > ball.radius + 2, `only rose ${highest - ball.radius} m`);
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

test('liquids lie flat and are held in: the surface is one height, and ground rises to it on every side of the wet part', () => {
  let wet = 0, spilled = 0;
  const kinds = new Set<number>();
  const AROUND = 2, DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let s = 600; s < 8000; s += 2) {
    for (let u = -9; u <= 9; u += 1) {
      const x = courseCenter(s) + u;
      if (holeEffectAt(x, -s, sample) < 0.5 || !isLiquidKind(sample.kind)) continue;
      kinds.add(sample.kind);
      const surface = holeLevel(sample);
      wet++;
      assert.ok(surface > terrainHeight(x, -s), `ground above the water at s ${s} u ${u}`);
      // Water must not hang over ground lower than itself just outside the hole: that would be water holding itself up.
      for (const [dx, dz] of DIRECTIONS) {
        const nx = x + dx * AROUND, nz = -s + dz * AROUND;
        // Another hole there is another scoop, and water may spill into it; only open ground counts.
        if (hazardAt(nx - courseCenter(-nz), -nz, courseHalfWidth(-nz), sample) > 0) continue;
        if (terrainHeight(nx, nz) < surface - 0.3) { spilled++; break; }
      }
    }
  }
  assert.ok(wet > 200, `only ${wet} wet points found`);
  assert.deepEqual([...kinds].sort(), [0, 1, 2, 4, 5], 'ponds, icy water, oases, lava and cave pools are all liquids');
  // The lowest point of the rim is where the liquid spills, so some wet points are always next to ground below the surface.
  assert.ok(spilled / wet < 0.12, `${spilled} of ${wet} wet points have water hanging over lower ground`);
});

test('the ground never jumps where two holes overlap', () => {
  let worst = 0;
  // Fine steps measure the true gradient; a jump would show as a slope that grows without bound as the step shrinks.
  const STEP = 0.01;
  for (let s = 600; s < 16000; s += 3) {
    for (const u of [-12, -4, 4, 12]) {
      const x = courseCenter(s) + u;
      worst = Math.max(worst, Math.abs(terrainHeight(x, -(s + STEP)) - terrainHeight(x, -s)) / STEP);
    }
  }
  assert.ok(worst < 6, `the ground changes by ${worst} m per metre somewhere`);
});

test('the jelly is stained by what it touches, and the stain wears off', () => {
  const stain = new Stain();
  const ball = createBall();
  ball.grounded = true; ball.hazardDepth = 1; ball.hazardKind = 4;
  for (let i = 0; i < PHYSICS_HZ / 2; i++) stain.step(ball, PHYSICS_STEP);
  assert.equal(stain.kind, 4);
  assert.ok(stain.level > 0.9, `lava stain ${stain.level}`);
  ball.hazardDepth = 0;
  for (let i = 0; i < PHYSICS_HZ * STAIN_FADE_SECONDS * 1.1; i++) stain.step(ball, PHYSICS_STEP);
  assert.equal(stain.level, 0);
  assert.equal(stain.kind, NO_STAIN);
  ball.hazardKind = 1; ball.stabs = 1; ball.hazardDepth = 1;
  stain.step(ball, PHYSICS_STEP);
  assert.equal(stain.kind, 1, 'a shard stab leaves white');
  assert.equal(stain.level, 1);
  ball.stabs = 0; ball.hazardKind = 0; ball.hazardDepth = 1;
  stain.reset(); stain.step(ball, PHYSICS_STEP);
  assert.ok(stain.kind === 0 && stain.level > 0, 'water stains blue');
});

// --- Snow ----------------------------------------------------------------------------

const ICE_START = positionOfBiome(ICE) * BIOME_LENGTH + 600;

function rollInSnow(seconds: number, throttle: number, from = ICE_START): Ball {
  const ball = createBall();
  ball.x = courseCenter(from); ball.z = -from;
  ball.y = terrainHeight(ball.x, ball.z) + ball.radius + 0.05;
  ball.vz = -8;
  for (let i = 0; i < seconds * PHYSICS_HZ; i++) {
    ball.wornOut = false; ball.radius = Math.max(ball.radius, START_RADIUS * 0.5);
    stepBall(ball, { throttle, steer: 0 }, PHYSICS_STEP);
  }
  return ball;
}

test('rolling fast through snow packs it on, which protects against wear and takes away steering', () => {
  const ball = rollInSnow(12, 1);
  assert.ok(ball.snow > 0.5, `only ${ball.snow} snow after 12 s of W in the snow`);
  // The same stretch of rolling wears a snowy jelly less.
  const clean = createBall(), packed = createBall();
  packed.snow = 1;
  wear(clean, 100); wear(packed, 100);
  assert.ok(START_RADIUS - packed.radius < (START_RADIUS - clean.radius) * 0.3, 'a full coat should protect against most of the wear');
  // And steers far less: how far sideways a second of steering moves it, compared with not steering at all.
  const steered = (snow: number) => {
    const sideways = (steer: number) => {
      const b = createBall(); b.snow = snow; b.vz = -10;
      b.x = courseCenter(ICE_START); b.z = -ICE_START; b.y = terrainHeight(b.x, b.z) + b.radius + 0.05;
      for (let i = 0; i < PHYSICS_HZ; i++) { b.wornOut = false; b.snow = snow; stepBall(b, { throttle: 0, steer }, PHYSICS_STEP); }
      return b.x;
    };
    return Math.abs(sideways(1) - sideways(0));
  };
  assert.ok(steered(1) < steered(0) * 0.5, `a snowy jelly steered ${steered(1)} m against ${steered(0)} m clean`);
});

test('slowing down lets the snow fall off, and leaving the snow melts it', () => {
  const ball = rollInSnow(12, 1);
  const packed = ball.snow;
  // Holding S slows to the minimum speed: the coat comes off.
  for (let i = 0; i < PHYSICS_HZ * 14; i++) { ball.wornOut = false; ball.radius = Math.max(ball.radius, START_RADIUS * 0.5); stepBall(ball, { throttle: -1, steer: 0 }, PHYSICS_STEP); }
  assert.ok(ball.snow < packed * 0.5, `snow only fell from ${packed} to ${ball.snow}`);
  // Out of the snow altogether, it melts away.
  const meadow = rollInSnow(1, 0, 600);
  meadow.snow = 1;
  for (let i = 0; i < PHYSICS_HZ * 20; i++) { meadow.wornOut = false; stepBall(meadow, { throttle: 0, steer: 0 }, PHYSICS_STEP); }
  assert.ok(meadow.snow < 0.5, `snow still ${meadow.snow} 20 s after leaving the snow`);
});

test('snow is scraped off in proportion to how much of the ground under the jelly is not snow, including across a changeover', () => {
  const lose = (from: number) => {
    const ball = rollInSnow(0.1, 0, from);
    ball.snow = 1;
    const before = ball.snow;
    for (let i = 0; i < PHYSICS_HZ * 2; i++) { ball.wornOut = false; ball.radius = Math.max(ball.radius, START_RADIUS * 0.5); stepBall(ball, { throttle: 1, steer: 0 }, PHYSICS_STEP); }
    return before - ball.snow;
  };
  // Right in the ice: nothing lost to the ground (speed is high). Half way into the next biome: some. Fully out: most.
  const ICE_MIDDLE = positionOfBiome(ICE) * BIOME_LENGTH + BIOME_LENGTH / 2;
  const NEXT_BOUNDARY = (positionOfBiome(ICE) + 1) * BIOME_LENGTH;
  const inSnow = lose(ICE_MIDDLE), halfway = lose(NEXT_BOUNDARY), out = lose(NEXT_BOUNDARY + 600);
  assert.ok(inSnow < 0.05, `lost ${inSnow} of the coat in the snow`);
  assert.ok(halfway > inSnow + 0.1, `lost ${halfway} half way out of the snow`);
  assert.ok(out > halfway, `lost ${out} fully out of the snow against ${halfway} half way`);
});

test('the jelly is a sphere on the ground: no ground under its sides is ever inside it, however sharp the pit', () => {
  setHazardLevelBias(6);
  try {
    // Roll a long way through the biggest holes, and at every step look at the ground all round under the sphere.
    const ball = createBall();
    ball.z = -700; ball.x = courseCenter(700); ball.y = terrainHeight(ball.x, ball.z) + ball.radius;
    let worst = 0;
    for (let i = 0; i < 40 * PHYSICS_HZ && !ball.wornOut; i++) {
      ball.radius = START_RADIUS;
      stepBall(ball, { throttle: 0, steer: Math.sin(i / 200) }, PHYSICS_STEP);
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * Math.PI * 2, d = ball.radius * 0.7;
        const ground = terrainHeight(ball.x + Math.cos(angle) * d, ball.z + Math.sin(angle) * d);
        // The sphere's underside there is sqrt(r^2 - d^2) below its centre.
        worst = Math.max(worst, ground - (ball.y - Math.sqrt(ball.radius ** 2 - d ** 2)));
      }
    }
    assert.ok(worst < 0.02, `the ground was ${worst} m inside the jelly`);
  } finally {
    setHazardLevelBias(0);
  }
});
