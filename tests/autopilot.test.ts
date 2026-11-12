import assert from 'node:assert/strict';
import test from 'node:test';
import { autoSteer } from '../src/game/autopilot.ts';
import { createBall, grantGlass, grantMagnet, stepBall } from '../src/game/physics.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from '../src/game/terrain.ts';
import { PHYSICS_STEP, START_RADIUS } from '../src/game/tuning.ts';

/** Let the autopilot drive from `start` metres for `seconds`; the jelly is kept from wearing away, as in the demo. */
function drive(start: number, seconds: number, lane: number | null = null, magnet = false, glass = false) {
  const ball = createBall();
  if (magnet) grantMagnet(ball);
  if (glass) grantGlass(ball);
  ball.z = -start; ball.x = courseCenter(start) + (lane ?? 0); ball.y = terrainHeight(ball.x, ball.z) + ball.radius; ball.vz = -6;
  let outside = 0, worst = 0, clock = 0;
  const control = { throttle: 1, steer: 0, jump: false };
  for (let i = 0; i < seconds / PHYSICS_STEP; i++) {
    if (i % 4 === 0) control.steer = autoSteer(ball, clock, lane);
    stepBall(ball, control, PHYSICS_STEP);
    if (magnet && ball.magnetSeconds < 1) grantMagnet(ball);
    if (ball.radius < START_RADIUS * 0.7) ball.radius = START_RADIUS * 0.7;
    clock += PHYSICS_STEP;
    const out = Math.abs(ball.x - courseCenter(-ball.z)) / courseHalfWidth(-ball.z);
    worst = Math.max(worst, out);
    if (out > 0.9) outside++;
  }
  return { ball, outside, worst };
}

test('the autopilot rolls down the meadow collecting mushrooms and stays in the valley', () => {
  // (Mushrooms are thin on the ground at speed, so the demo gives the jelly a magnet here, as a player would.)
  const run = drive(300, 45, null, true);
  assert.ok(run.ball.merges >= 8, `${run.ball.merges} merges in 45 s`);
  assert.ok(-run.ball.z > 300 + 200, `it got ${(-run.ball.z - 300).toFixed(0)} m`);
  assert.ok(run.worst < 0.95, `it reached ${run.worst.toFixed(2)} of the valley's half width`);
});

test('as a glass marble in the scree the autopilot goes for the rocks and smashes them, staying in the valley', () => {
  const run = drive(1800, 20, null, false, true);
  assert.ok(run.ball.brokenRocks.total >= 4, `${run.ball.brokenRocks.total} rocks smashed in 20 s`);
  assert.ok(-run.ball.z - 1800 > 150, `it got ${(-run.ball.z - 1800).toFixed(0)} m through the rocks`);
  assert.ok(run.worst < 0.95, `it reached ${run.worst.toFixed(2)} of the valley's half width`);
});

test('told to hold a line, it holds it', () => {
  const run = drive(8170, 6, -4.5);
  assert.ok(Math.abs(run.ball.x - courseCenter(-run.ball.z) + 4.5) < 3, `it drifted to ${(run.ball.x - courseCenter(-run.ball.z)).toFixed(1)} m off the middle`);
});

test('every demo scene starts in the biome it is about, and the splash scene really does roll through a pond', async () => {
  const { SCENES } = await import('../src/app/demo.ts');
  const { BIOMES, CAVE, ICE, LAVA, MEADOW, SCREE, dominantBiome } = await import('../src/game/biomes.ts');
  const { createHazardSample, isLiquidKind } = await import('../src/game/hazards.ts');
  const { holeEffectAt } = await import('../src/game/terrain.ts');
  const wanted: Record<string, number> = { 'Roll through it': MEADOW, 'Bring friends': MEADOW, 'Go solid': SCREE, 'Make a splash': MEADOW, 'Sow a garden': MEADOW, 'Slide on ice': ICE, 'Into the cave': CAVE, Lava: LAVA };
  assert.equal(SCENES.length, Object.keys(wanted).length);
  for (const scene of SCENES) {
    // The cave scene starts just outside its mouth, so look a little way in.
    const at = scene.title === 'Into the cave' ? scene.s + 200 : scene.s + 100;
    assert.equal(dominantBiome(at), wanted[scene.title], `${scene.title} starts in ${BIOMES[dominantBiome(at)].name}`);
    assert.ok(scene.seconds >= 10 && scene.seconds <= 25, `${scene.title} runs ${scene.seconds} s`);
    assert.ok(scene.s > 0, 'a real place');
  }
  const splash = SCENES.find(scene => scene.title === 'Make a splash')!;
  const sample = createHazardSample();
  let run = 0, longest = 0;
  for (let s = splash.s; s < splash.s + 200; s += 1) {
    const wet = holeEffectAt(courseCenter(s) + splash.lane!, -s, sample) > 0.6 && isLiquidKind(sample.kind);
    run = wet ? run + 1 : 0; longest = Math.max(longest, run);
  }
  assert.ok(longest >= 8, `the line held in the splash scene crosses ${longest} m of water`);
});
