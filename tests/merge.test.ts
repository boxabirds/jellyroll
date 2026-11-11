import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PHASE_APPROACH, PHASE_BLEND, PHASE_CONTACT, PHASE_DONE, createMergeShape, createMergeSpec, dentDepth, mergeDuration, mergeShape,
  setMergeSpec, smoothMax, sphereExit, unionRadius,
} from '../src/game/merge-timeline.ts';
import { Alarm, CRITICAL_LIFE_FRACTION, criticalSeverity, pulseRate } from '../src/game/alarm.ts';
import { growthCentimetres, MIN_VISIBLE_GROWTH_CM } from '../src/game/growth.ts';
import { Merges } from '../src/game/merges.ts';
import { createBall, stepBall, type Pickup } from '../src/game/physics.ts';
import {
  MAX_RADIUS, MAX_MERGES, MIN_RADIUS, MERGE_APPROACH_MAX_SECONDS, MERGE_BLEND_SECONDS, MERGE_CONTACT_SECONDS, MERGE_FUSE_FRACTION, MUSHROOM_TOUCH, PHYSICS_STEP,
  START_RADIUS,
} from '../src/game/tuning.ts';

const R = START_RADIUS, r = 0.4;
const TOUCHING = R + r * MUSHROOM_TOUCH;
const FAR = R + 6;
const FRAME = 1 / 60;
/** The fastest the mushroom can travel while flying in: twice the mean speed of the longest flight. */
const MAX_APPROACH_METRES_PER_SECOND = 80;

function specFor(distance: number) {
  return setMergeSpec(createMergeSpec(), distance, R, r);
}
function sample(distance: number, age: number) {
  return mergeShape(specFor(distance), age, createMergeShape());
}

test('a merge touched on contact has no approach; one pulled from afar flies in for a bounded time', () => {
  assert.equal(specFor(TOUCHING).approachSeconds, 0);
  assert.equal(specFor(TOUCHING - 0.3).approachSeconds, 0);
  const far = specFor(FAR);
  assert.ok(far.approachSeconds > 0.2 && far.approachSeconds <= MERGE_APPROACH_MAX_SECONDS, `approach ${far.approachSeconds} s`);
  assert.equal(specFor(R + 90).approachSeconds, MERGE_APPROACH_MAX_SECONDS);
  assert.ok(specFor(FAR + 2).approachSeconds >= far.approachSeconds, 'farther must not arrive sooner');
});

test('the phases run in order: approach, contact (squash), blend, done', () => {
  const spec = specFor(FAR);
  const seen: number[] = [];
  const shape = createMergeShape();
  for (let age = 0; age <= mergeDuration(spec) + 0.1; age += FRAME / 4) {
    mergeShape(spec, age, shape);
    if (seen[seen.length - 1] !== shape.phase) seen.push(shape.phase);
  }
  assert.deepEqual(seen, [PHASE_APPROACH, PHASE_CONTACT, PHASE_BLEND, PHASE_DONE]);
  assert.equal(mergeDuration(spec), spec.approachSeconds + MERGE_CONTACT_SECONDS + MERGE_BLEND_SECONDS);
});

test('contact squashes the mushroom and dents the jelly before any blending starts', () => {
  const spec = specFor(TOUCHING);
  const early = mergeShape(spec, 0.02, createMergeShape());
  const pressed = mergeShape(spec, MERGE_CONTACT_SECONDS * 0.99, createMergeShape());
  assert.equal(early.phase, PHASE_CONTACT);
  assert.ok(pressed.squash > 0.9 && pressed.dent > 0.9, `squash ${pressed.squash}, dent ${pressed.dent}`);
  assert.equal(pressed.unionScale, 0, 'the union must not start during contact');
  assert.equal(pressed.transferred, 0);
  assert.ok(pressed.distance < early.distance, 'the mushroom should press inward');
  assert.ok(dentDepth(pressed, r, R) > 0.05, 'the dent should be visible');
});

test('the blend grows the union and the blend radius, draws the centres together, and hands the volume over', () => {
  const spec = specFor(TOUCHING);
  const at = (fraction: number) => mergeShape(spec, MERGE_CONTACT_SECONDS + MERGE_BLEND_SECONDS * fraction, createMergeShape());
  const early = at(0.1), middle = at(0.5), late = at(0.9);
  assert.ok(early.unionScale < middle.unionScale && middle.unionScale >= 0.99, 'union should switch on early in the blend');
  assert.ok(early.k < middle.k && middle.k < late.k, 'the blend radius should grow');
  assert.ok(early.distance > middle.distance && middle.distance > late.distance, 'the centres should draw together');
  assert.ok(early.transferred < middle.transferred && middle.transferred < late.transferred);
  assert.ok(early.size > middle.size && middle.size > late.size, 'the mushroom should shrink as it is absorbed');
  assert.ok(early.squash > late.squash, 'the squash should ease off');
});

test('every quantity is continuous: no jump at a phase boundary, and it ends where piece 2 says', () => {
  const spec = specFor(FAR);
  const previous = createMergeShape(), shape = createMergeShape();
  mergeShape(spec, 0, previous);
  const step = 1 / 2000;
  for (let age = step; age <= mergeDuration(spec); age += step) {
    mergeShape(spec, age, shape);
    for (const key of ['distance', 'size', 'squash', 'tilt', 'dent', 'unionScale', 'k', 'transferred'] as const) {
      // Distance may move as fast as the flight-in does (a few tens of m/s); everything else is dimensionless.
      const allowed = key === 'distance' ? MAX_APPROACH_METRES_PER_SECOND * step : 0.02;
      assert.ok(Math.abs(shape[key] - previous[key]) < allowed, `${key} jumps from ${previous[key]} to ${shape[key]} at ${age} s`);
      previous[key] = shape[key];
    }
  }
  const end = mergeShape(spec, mergeDuration(spec), createMergeShape());
  assert.equal(end.phase, PHASE_DONE);
  assert.ok(Math.abs(end.distance - MERGE_FUSE_FRACTION * (R + r)) < 1e-9);
  assert.ok(end.size < 1e-9 && end.transferred === 1);
});

test('smooth maximum: never below the larger input, exact when they are far apart, smooth in between', () => {
  const K = 0.5;
  for (let a = -2; a <= 2; a += 0.1) {
    for (let b = -2; b <= 2; b += 0.1) {
      const m = smoothMax(a, b, K);
      assert.ok(m >= Math.max(a, b) - 1e-12);
      if (Math.abs(a - b) >= K) assert.ok(Math.abs(m - Math.max(a, b)) < 1e-12);
      assert.ok(m <= Math.max(a, b) + K / 4 + 1e-12, 'extra material is bounded by k/4');
    }
  }
  assert.equal(smoothMax(1, 2, 0), 2);
  let previous = smoothMax(0, 0, K);
  for (let b = 0; b < 1.5; b += 0.001) {
    const m = smoothMax(0, b, K);
    assert.ok(Math.abs(m - previous) < 0.004, 'smoothMax must have no jump');
    previous = m;
  }
});

test('sphere exit distance: right for rays through it, and falls away smoothly for rays that miss', () => {
  // Sphere of radius 1 centred 3 along the ray: the ray leaves it at 4.
  assert.ok(Math.abs(sphereExit(3, 9, 1) - 4) < 1e-12);
  // A ray just grazing it leaves at about its centre's distance.
  assert.ok(Math.abs(sphereExit(Math.sqrt(8), 9, 1) - Math.sqrt(8)) < 1e-6);
  // Continuous across the grazing line. A sphere's silhouette is steep (square-root edge), so the
  // step allowed is larger than elsewhere, but never a jump to a different value.
  const STEP = 0.0005, STEEPEST_STEP = 0.07, GRAZING = Math.sqrt(8);
  let previous = sphereExit(3, 9, 1);
  for (let along = 3; along > 0; along -= STEP) {
    const exit = sphereExit(along, 9, 1);
    assert.ok(Math.abs(exit - previous) < STEEPEST_STEP, `exit jumps at along=${along}`);
    if (Math.abs(along - GRAZING) > 0.05) assert.ok(Math.abs(exit - previous) < 0.01, `exit too steep away from the silhouette at ${along}`);
    previous = exit;
  }
});

test('the union only ever adds material, and does nothing once the sphere is well inside the jelly', () => {
  const dist2 = (R * 0.2) ** 2;
  for (let along = -R * 0.2; along <= R * 0.2; along += 0.01) {
    assert.ok(Math.abs(unionRadius(R, along, dist2, r * 0.3, 0.1) - R) < 1e-9, 'a small sphere deep inside should change nothing');
  }
  const outside = (R + r * 0.8) ** 2;
  assert.ok(unionRadius(R, R + r * 0.8, outside, r * 1.15, 0.2) > R + r * 0.8, 'the sphere should bulge the surface toward it');
  for (let along = -5; along <= 5; along += 0.25) assert.ok(unionRadius(R, along, outside, r, 0.2) >= R - 1e-12);
});

function pickup(distance: number, volume = 0.1): Pickup {
  return { dx: 1, dy: 0, dz: 0, distance, jellyRadius: R, volume, radius: r, kind: 0, look: 0, color: 0, color2: 1, seed: 0.5 };
}

test('merges run to completion, report the finish once, and hand over their volume gradually', () => {
  const merges = new Merges();
  merges.start(pickup(TOUCHING, 0.2));
  assert.equal(merges.pendingVolume(), 0.2);
  let completions = 0, previous = merges.pendingVolume();
  for (let t = 0; t < 4; t += FRAME) {
    merges.update(FRAME);
    assert.ok(merges.pendingVolume() <= previous + 1e-12, 'pending volume must only fall');
    previous = merges.pendingVolume();
    completions += merges.completedCount;
    merges.clearCompleted();
  }
  assert.equal(completions, 1);
  assert.equal(merges.activeCount, 0);
  assert.equal(merges.pendingVolume(), 0);
});

test('with every slot busy, a new merge finishes the oldest at once instead of being dropped', () => {
  const merges = new Merges();
  for (let i = 0; i < MAX_MERGES; i++) { merges.start(pickup(TOUCHING)); merges.update(FRAME); merges.clearCompleted(); }
  assert.equal(merges.activeCount, MAX_MERGES);
  merges.start(pickup(TOUCHING));
  assert.equal(merges.activeCount, MAX_MERGES, 'the new merge takes the oldest slot');
  assert.equal(merges.completedCount, 1, 'the evicted merge is reported finished');
});

test('physics reports the jelly radius just before a merge and the volume it gained', () => {
  const ball = createBall();
  let before = ball.radius, merged: Pickup | undefined, radiusAfter = 0;
  for (let i = 0; i < 120 * 120 && !merged; i++) {
    ball.wornOut = false;
    before = ball.radius;
    stepBall(ball, { throttle: 0, steer: 0 }, PHYSICS_STEP);
    if (ball.pickupCount > 0) { merged = { ...ball.pickups[0] }; radiusAfter = ball.radius; }
  }
  assert.ok(merged, 'coasting never met a mushroom');
  assert.ok(merged.volume > 0, 'a merge must add volume');
  assert.ok(merged.volume <= merged.radius ** 3 + 1e-9, 'it cannot add more than the mushroom holds');
  assert.equal(merged.jellyRadius, before, 'the radius reported is the one just before the merge');
  // Wear is applied later in the same step, so allow for that sliver.
  assert.ok(Math.abs(radiusAfter ** 3 - merged.jellyRadius ** 3 - merged.volume) < 1e-4, 'volume gained is the change in volume');
});

test('the growth shown is the change in diameter in centimetres: bigger mushrooms give more, a full jelly gets none', () => {
  const small = growthCentimetres(R, 0.2 ** 3), big = growthCentimetres(R, 0.5 ** 3);
  assert.ok(small > 0 && big > small, `small ${small} cm, big ${big} cm`);
  // Cross-check against the diameters themselves.
  const volume = 0.4 ** 3;
  const after = Math.cbrt(R ** 3 + volume);
  assert.ok(Math.abs(growthCentimetres(R, volume) - (2 * after - 2 * R) * 100) < 1e-9);
  // The same mushroom is worth less to a bigger jelly.
  assert.ok(growthCentimetres(R * 2, volume) < growthCentimetres(R, volume));
  assert.ok(growthCentimetres(MAX_RADIUS, 0) < MIN_VISIBLE_GROWTH_CM);
});

test('the low-size alarm: silent while healthy, rising as the jelly wears to nothing, pulsing faster', () => {
  assert.equal(criticalSeverity(START_RADIUS), 0);
  assert.equal(criticalSeverity(START_RADIUS * 0.5), 0);
  const threshold = MIN_RADIUS + CRITICAL_LIFE_FRACTION * (START_RADIUS - MIN_RADIUS);
  assert.equal(criticalSeverity(threshold), 0, 'the alarm starts exactly at the threshold');
  assert.ok(criticalSeverity(threshold * 0.9) > 0);
  let previous = 0;
  for (let radius = threshold; radius >= MIN_RADIUS; radius -= 0.005) {
    const severity = criticalSeverity(radius);
    assert.ok(severity >= previous - 1e-12, 'severity must only rise as the jelly shrinks');
    previous = severity;
  }
  assert.equal(criticalSeverity(MIN_RADIUS), 1);
  assert.ok(pulseRate(1) > pulseRate(0.5) && pulseRate(0.5) > pulseRate(0));
  const alarm = new Alarm();
  const seen: number[] = [];
  for (let t = 0; t < 2; t += 1 / 60) { alarm.update(MIN_RADIUS * 1.5, false, 1 / 60); seen.push(alarm.level); }
  assert.ok(Math.max(...seen) > 0.8 && Math.min(...seen) < 0.5, `the pulse should swing: ${Math.min(...seen)}..${Math.max(...seen)}`);
  alarm.update(START_RADIUS, false, 1 / 60);
  assert.equal(alarm.level, 0);
  // Reduced motion: the warning stays on and does not flash.
  const calm = new Alarm();
  calm.steady = true;
  const levels = new Set<number>();
  for (let t = 0; t < 2; t += 1 / 60) { calm.update(MIN_RADIUS * 1.5, false, 1 / 60); levels.add(calm.level); }
  assert.equal(levels.size, 1, 'a steady alarm must not pulse');
  assert.ok([...levels][0] > 0.3);
  alarm.update(MIN_RADIUS, true, 1 / 60);
  assert.equal(alarm.level, 0, 'no alarm once the jelly is gone');
});
