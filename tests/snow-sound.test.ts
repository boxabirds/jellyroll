import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SNOW_LOOP_SECONDS, renderSnowLoop } from '../src/audio/snow-sounds.ts';

const SAMPLE_RATE = 44100;

function rms(samples: Float32Array) {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / samples.length);
}

test('the snow rolling loop is audible, never clips, and joins up with no click', () => {
  const loop = renderSnowLoop(SAMPLE_RATE);
  assert.equal(loop.length, Math.round(SNOW_LOOP_SECONDS * SAMPLE_RATE));
  let peak = 0;
  for (const value of loop) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); }
  assert.ok(peak > 0.7 && peak <= 0.81, `peak ${peak}`);
  assert.ok(rms(loop) > 0.02, `rms ${rms(loop)}: too quiet to hear`);
  // Looping jumps from the last sample to the first: that step is no bigger than the steps inside the loop.
  let biggest = 0;
  for (let i = 1; i < loop.length; i++) biggest = Math.max(biggest, Math.abs(loop[i] - loop[i - 1]));
  const seam = Math.abs(loop[0] - loop[loop.length - 1]);
  assert.ok(seam <= biggest, `the seam steps ${seam} against the largest step ${biggest} in the loop`);
});

test('the loop is the same every time', () => {
  assert.deepEqual(renderSnowLoop(SAMPLE_RATE), renderSnowLoop(SAMPLE_RATE));
});
