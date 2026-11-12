import assert from 'node:assert/strict';
import test from 'node:test';
import { applyKey } from '../src/game/name-rules.ts';
import { GLYPHS, contours, segments, signedArea } from '../src/game/glyphs.ts';
import { NAME_MAX_LETTERS } from '../src/shared/run-rules.ts';

/** Feed a list of keys through the rules, as the entry screen does. */
function type(keys: string[], start = '') {
  let name = start;
  const results: string[] = [];
  for (const key of keys) { const outcome = applyKey(name, key); name = outcome.name; results.push(outcome.result); }
  return { name, results };
}

test('TC-01 a capital letter on an empty name is added', () => {
  assert.deepEqual(applyKey('', 'J'), { name: 'J', result: 'added' });
});
test('TC-02 a lower-case letter is stored as a capital', () => {
  assert.deepEqual(applyKey('', 'j'), { name: 'J', result: 'added' });
});
test('TC-03 a digit is accepted', () => {
  assert.deepEqual(applyKey('ABCDE', '7'), { name: 'ABCDE7', result: 'added' });
});
test('TC-04 and TC-05 spaces, punctuation and named keys are ignored', () => {
  for (const key of [' ', '.', '-', '!', 'é', 'Shift', 'Tab', 'ArrowLeft', 'F5', '', 'ab']) assert.deepEqual(applyKey('ABC', key), { name: 'ABC', result: 'ignored' }, JSON.stringify(key));
});
test('TC-06 the ninth letter is accepted and the name is then full', () => {
  const eight = 'ABCDEFGH';
  assert.equal(eight.length, NAME_MAX_LETTERS - 1);
  assert.deepEqual(applyKey(eight, 'I'), { name: 'ABCDEFGHI', result: 'added' });
});
test('TC-07 a tenth letter is refused and the name stays', () => {
  assert.deepEqual(applyKey('ABCDEFGHI', 'J'), { name: 'ABCDEFGHI', result: 'refused' });
  assert.deepEqual(applyKey('ABCDEFGHI', '9'), { name: 'ABCDEFGHI', result: 'refused' });
});
test('TC-08 backspace on an empty name does nothing', () => {
  assert.deepEqual(applyKey('', 'Backspace'), { name: '', result: 'ignored' });
});
test('TC-09 backspace on a full name removes the last letter and typing works again', () => {
  const out = applyKey('ABCDEFGHI', 'Backspace');
  assert.deepEqual(out, { name: 'ABCDEFGH', result: 'removed' });
  assert.equal(applyKey(out.name, 'Z').result, 'added');
});
test('TC-10 Enter with no letters asks for one and does not sign', () => {
  assert.deepEqual(applyKey('', 'Enter'), { name: '', result: 'empty' });
});
test('TC-11 Enter with a letter signs', () => {
  assert.deepEqual(applyKey('J', 'Enter'), { name: 'J', result: 'sign' });
});
test('TC-12 Escape skips at every length', () => {
  for (const name of ['', 'J', 'ABCDEFGHI']) assert.equal(applyKey(name, 'Escape').result, 'skip');
});

test('TC-13 every letter and digit has a closed outline with a positive area, and a drawable path', () => {
  const wanted = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (const character of wanted) {
    const glyph = GLYPHS[character];
    assert.ok(glyph, `missing glyph ${character}`);
    const shapes = contours(glyph.o);
    assert.ok(shapes.length >= 1, character);
    const area = shapes.reduce((sum, shape) => sum + signedArea(shape), 0);
    assert.ok(Math.abs(area) > 10_000, `${character} area ${area}`);
    const steps = segments(glyph.o);
    assert.equal(steps[0].kind, 'm', `${character} starts with a move`);
    assert.ok(steps.every(step => Number.isFinite(step.x) && Number.isFinite(step.y) && (step.kind !== 'q' || (Number.isFinite(step.cx) && Number.isFinite(step.cy)))), `${character}: every number reads`);
    assert.ok(steps.some(step => step.kind === 'q'), `${character} has curves`);
    assert.ok(glyph.ha > 300 && glyph.ha < 1100, `${character} advance ${glyph.ha}`);
  }
});

test('property: no sequence of keys ever gives a name longer than nine, or with anything but capitals and digits', () => {
  const alphabet = [...'abcXYZ019 .-!?', 'Backspace', 'Enter', 'Escape', 'Shift', 'ArrowUp'];
  let seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let trial = 0; trial < 300; trial++) {
    const keys = Array.from({ length: 1 + Math.floor(random() * 60) }, () => alphabet[Math.floor(random() * alphabet.length)]);
    const { name } = type(keys);
    assert.ok(name.length <= NAME_MAX_LETTERS, name);
    assert.match(name, /^[A-Z0-9]*$/);
  }
});

test('typing JELLY gives JELLY and five additions', () => {
  const { name, results } = type([...'jelly']);
  assert.equal(name, 'JELLY');
  assert.deepEqual(results, ['added', 'added', 'added', 'added', 'added']);
});
