import assert from 'node:assert/strict';
import { test } from 'node:test';
import { METAL_LOOP_SECONDS, renderMetalLoop } from '../src/audio/metal-sounds.ts';
import { DamageNumbers } from '../src/game/damage.ts';
import { DAMAGE_POPUP_GAP_SECONDS } from '../src/game/tuning.ts';

const SAMPLE_RATE = 44100;

test('the metal rolling loop is audible, never clips, joins up with no click, and is repeatable', () => {
  const loop = renderMetalLoop(SAMPLE_RATE);
  assert.equal(loop.length, Math.round(METAL_LOOP_SECONDS * SAMPLE_RATE));
  let peak = 0, sum = 0, biggest = 0;
  for (let i = 0; i < loop.length; i++) {
    assert.ok(Number.isFinite(loop[i]));
    peak = Math.max(peak, Math.abs(loop[i]));
    sum += loop[i] * loop[i];
    if (i > 0) biggest = Math.max(biggest, Math.abs(loop[i] - loop[i - 1]));
  }
  assert.ok(peak > 0.7 && peak <= 0.81, `peak ${peak}`);
  assert.ok(Math.sqrt(sum / loop.length) > 0.03, 'too quiet to hear');
  assert.ok(Math.abs(loop[0] - loop[loop.length - 1]) <= biggest, 'the seam is a click');
  assert.deepEqual(renderMetalLoop(SAMPLE_RATE), loop);
});

test('damage numbers add small losses up, and show them no faster than the gap allows', () => {
  const numbers = new DamageNumbers();
  // 0.4 cm of diameter a step: nothing until it comes to a whole centimetre.
  const tinyLoss = 0.002;
  assert.equal(numbers.step(tinyLoss, 0.01), 0);
  assert.equal(numbers.step(tinyLoss, 0.01), 0);
  assert.equal(numbers.step(tinyLoss, 0.01), 1);
  // Right after one, even a big loss waits for the gap, and is not forgotten.
  assert.equal(numbers.step(0.01, 0.01), 0);
  assert.equal(numbers.step(0, DAMAGE_POPUP_GAP_SECONDS), 2);
});

test('stone impacts are short, dry and louder when harder; the glass tap rings on', async () => {
  const { renderLayers } = await import('../src/audio/sfx-render.ts');
  const { stoneImpact, glassPickup } = await import('../src/audio/companion-sounds.ts');
  const measure = (samples: Float32Array) => {
    let peak = 0, last = 0;
    for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); peak = Math.max(peak, a); if (a > 0.02) last = i; }
    return { peak, seconds: last / SAMPLE_RATE };
  };
  const soft = measure(renderLayers(stoneImpact(0.1, () => 0.5), SAMPLE_RATE));
  const hard = measure(renderLayers(stoneImpact(1, () => 0.5), SAMPLE_RATE));
  assert.ok(hard.peak > soft.peak, `${hard.peak} vs ${soft.peak}`);
  assert.ok(hard.peak <= 1.0 && hard.peak > 0.2);
  assert.ok(hard.seconds < 0.4, `a rock knock lasts ${hard.seconds}s`);
  const tap = measure(renderLayers(glassPickup(() => 0.5), SAMPLE_RATE));
  assert.ok(tap.seconds > 1, `a glass ring lasts ${tap.seconds}s`);
});

test('the bee buzz loop is audible, joins up, and is repeatable', async () => {
  const { renderBuzzLoop } = await import('../src/audio/bee-sounds.ts');
  const loop = renderBuzzLoop(SAMPLE_RATE);
  let peak = 0, biggest = 0, sum = 0;
  for (let i = 0; i < loop.length; i++) { peak = Math.max(peak, Math.abs(loop[i])); sum += loop[i] ** 2; if (i) biggest = Math.max(biggest, Math.abs(loop[i] - loop[i - 1])); }
  assert.ok(peak > 0.7 && peak <= 0.81, `peak ${peak}`);
  assert.ok(Math.sqrt(sum / loop.length) > 0.1);
  assert.ok(Math.abs(loop[0] - loop[loop.length - 1]) <= biggest, 'the seam is a click');
  assert.deepEqual(renderBuzzLoop(SAMPLE_RATE), loop);
});

test('a bee is louder the nearer it is, and silent far away', async () => {
  const { buzzLevel, BUZZ_RANGE } = await import('../src/audio/bee-sounds.ts');
  const levels = [0.5, 3, 6, 12, 25, 50].map(buzzLevel);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1], `level rises with distance at ${i}`);
  assert.ok(levels[0] > 0.98);
  assert.equal(buzzLevel(BUZZ_RANGE), 0);
  assert.ok(levels[3] < 0.5 * levels[0]);
});

test('Doppler: closing raises the pitch, leaving lowers it, and the shift is slight', async () => {
  const { dopplerRate } = await import('../src/audio/bee-sounds.ts');
  assert.equal(dopplerRate(0), 1);
  assert.ok(dopplerRate(30) > 1 && dopplerRate(-30) < 1);
  assert.ok(dopplerRate(40) < 1.1 && dopplerRate(-40) > 0.9, 'more than slight at bee speeds');
  assert.ok(dopplerRate(1e6) <= 1.2 + 1e-9 && dopplerRate(-1e6) >= 0.8 - 1e-9);
});
