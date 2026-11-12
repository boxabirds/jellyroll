import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { JellyBody, PHYS } from '../src/world/jelly-letters/jelly-body.ts';

const SIZE = 0.07;
const SECONDS = 3;

/** Drop a letter and let it settle; one that toppled is stood back up, as the stage does after it has lain still. */
function drop(character: string, tilt: number) {
  const stage = { bounds: { x0: -SIZE, x1: SIZE * 10, z0: -SIZE * 1.6, z1: SIZE * 1.6 }, t: 0, onThud: () => { thuds++; } };
  let thuds = 0;
  const body = new JellyBody(stage, character, new THREE.MeshBasicMaterial(), 0.05, SIZE);
  const settle = () => {
    for (let step = 0; step < SECONDS / PHYS.step; step++) {
      if (!body.begin(PHYS.step)) break;
      for (let pass = 0; pass < PHYS.iterations; pass++) body.iterate(PHYS.step, pass);
      body.finish(PHYS.step);
    }
  };
  body.place(SIZE * 1.4, tilt);
  settle();
  if (body.isFallen()) { body.cx = body.homeX; body.place(SIZE * 0.2, 0); settle(); }
  let lowest = Infinity, highest = -Infinity;
  for (let i = 0; i < body.N; i++) { lowest = Math.min(lowest, body.x[i * 3 + 1]); highest = Math.max(highest, body.x[i * 3 + 1]); }
  return { body, thuds, standing: (highest - lowest) / body.height };
}

test('every letter and digit lands with a thud and comes to rest standing, dropped slightly tilted either way', () => {
  const problems: string[] = [];
  for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    for (const tilt of [-0.06, 0.06]) {
      const { body, thuds, standing } = drop(character, tilt);
      if (!Number.isFinite(body.x[0])) problems.push(`${character} blew up`);
      else if (thuds < 1) problems.push(`${character} was not heard landing`);
      else if (Math.min(...Array.from({ length: body.N }, (_, i) => body.x[i * 3 + 1])) < -1e-9) problems.push(`${character} sank through the floor`);
      else if (standing < 0.7) problems.push(`${character} (tilt ${tilt}) is lying down: ${(standing * 100).toFixed(0)}% of its height`);
    }
  }
  assert.deepEqual(problems, []);
});

/** The stage needs a window's matchMedia; a stand-in is enough to run its physics. */
function stubBrowser() {
  (globalThis as any).matchMedia = () => ({ matches: false });
}

test('typing a name one letter at a time leaves every letter standing, in order, side by side', async () => {
  stubBrowser();
  const { LetterStage } = await import('../src/world/jelly-letters/letter-stage.ts');
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
  camera.position.set(0, 3, 0); camera.lookAt(0, 0, -10);
  const frame = Number(process.env.FRAME_DT ?? 1 / 30);
  for (let attempt = 0; attempt < 6; attempt++) {
    const stage = new LetterStage();
    stage.show(camera);
    const landed: boolean[] = []; stage.onLand = soft => { landed.push(soft); };
    for (const ch of 'JELLY') {
      stage.add(ch);
      for (let f = 0; f < 0.3 / frame; f++) stage.update(frame, camera);
    }
    for (let f = 0; f < 4 / frame; f++) stage.update(frame, camera);
    const { letters } = stage.boxes;
    assert.equal(stage.text, 'JELLY');
    const tall = letters.map(l => (l.hi[1] - l.lo[1]) / SIZE);
    assert.ok(tall.every(t => t > 0.6), `attempt ${attempt}: all standing, heights ${tall.map(t => t.toFixed(2)).join(' ')} of a letter's size`);
    const centres = letters.map(l => (l.lo[0] + l.hi[0]) / 2);
    assert.ok(centres.every((c, i) => i === 0 || c > centres[i - 1]), `attempt ${attempt}: in order, centres ${centres.map(c => c.toFixed(3)).join(' ')}`);
    assert.ok(letters.every(l => Math.abs((l.lo[2] + l.hi[2]) / 2) < SIZE * 0.5), `attempt ${attempt}: not shoved forwards or back: ${JSON.stringify(letters.map(l => [l.character, l.lo.map(v => +(v / SIZE).toFixed(2)), l.hi.map(v => +(v / SIZE).toFixed(2))]))}`);
    assert.ok(landed.filter(s => !s).length >= 5, `attempt ${attempt}: every letter is heard landing`);
    stage.hide();
  }
});

test('typing fast (a letter every tenth of a second) still ends with nine letters standing apart, in order', async () => {
  stubBrowser();
  const { LetterStage } = await import('../src/world/jelly-letters/letter-stage.ts');
  const camera = new THREE.PerspectiveCamera(72, 1.6, 0.1, 100);
  camera.position.set(0, 3, 0); camera.lookAt(0, 0, -10);
  const frame = 1 / 60;
  const problems: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const stage = new LetterStage();
    stage.show(camera);
    for (const ch of 'ABCDEFGHI') {
      stage.add(ch);
      for (let f = 0; f < 0.1 / frame; f++) stage.update(frame, camera);
    }
    for (let f = 0; f < 12 / frame; f++) stage.update(frame, camera);
    const { letters } = stage.boxes;
    const heights = letters.map(l => (l.hi[1] - l.lo[1]) / SIZE);
    if (!heights.every(h => h > 0.6)) problems.push(`attempt ${attempt}: lying ${letters.filter((_, i) => heights[i] <= 0.6).map(l => l.character).join('')}`);
    const overlaps = letters.filter((l, i) => i > 0 && l.lo[0] < letters[i - 1].hi[0] - SIZE * 0.05).map(l => l.character);
    if (overlaps.length) problems.push(`attempt ${attempt}: overlapping ${overlaps.join('')} ${JSON.stringify(letters.map((l: any) => [l.character, +(l.lo[0] / SIZE).toFixed(2), +(l.hi[0] / SIZE).toFixed(2), 'home', +(l.home / SIZE).toFixed(2), 'disp', +(l.displaced / SIZE).toFixed(2), l.asleep, +l.rest.toFixed(1)]))}`);
    stage.hide();
  }
  assert.deepEqual(problems, []);
});
