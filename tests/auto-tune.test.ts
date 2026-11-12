import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoTune, CANDIDATES, FRAME_BUDGET_MS, type Candidate } from '../src/water/auto-tune.ts';

/** A pretend device: how long a frame takes for each candidate. */
function device(costs: (c: Candidate) => number) {
  let current = CANDIDATES[0];
  const applied: Candidate[] = [];
  return {
    applied,
    apply: (c: Candidate) => { current = c; applied.push(c); },
    frame: async () => costs(current),
    splash: () => {},
  };
}

test('a fast device keeps the best look and stops after one try', async () => {
  const d = device(() => 4);
  const result = await autoTune(d.apply, d.frame, d.splash);
  assert.equal(result.candidate, CANDIDATES[0]);
  assert.equal(d.applied.length, 1);
});

test('a slower device steps down until a candidate fits the budget', async () => {
  // Cost falls with intensity and with render scale.
  const d = device(c => 0.45 * c.intensity * c.scale + 4);
  const result = await autoTune(d.apply, d.frame, d.splash);
  assert.ok(result.medianMs <= FRAME_BUDGET_MS, `${result.medianMs}`);
  // It is the first that fits: the one above it was over budget.
  const index = CANDIDATES.indexOf(result.candidate);
  assert.ok(index > 0);
  const above = result.tried[result.tried.length - 2];
  assert.ok(above.medianMs > FRAME_BUDGET_MS);
});

test('a hopeless device ends on the cheapest setting without trying everything slowly', async () => {
  const d = device(() => 200);
  const result = await autoTune(d.apply, d.frame, d.splash);
  assert.equal(result.candidate, CANDIDATES[CANDIDATES.length - 1]);
  assert.ok(d.applied.length < CANDIDATES.length, 'it should skip candidates once it is clear it is hopeless');
});

test('one slow frame (a shader compiling) does not decide it: the median is used', async () => {
  let frames = 0;
  const d = device(() => 4);
  const result = await autoTune(d.apply, async () => { frames++; return frames === 7 ? 500 : 4; }, d.splash);
  assert.equal(result.candidate, CANDIDATES[0]);
});

test('the first frames of each try are thrown away', async () => {
  let frames = 0;
  const result = await autoTune(() => {}, async () => (frames++ < 4 ? 300 : 5), () => {});
  assert.equal(result.candidate, CANDIDATES[0]);
});
