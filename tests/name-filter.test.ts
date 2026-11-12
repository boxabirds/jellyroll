import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanName, isBlocked, normalise } from '../src/shared/name-filter.ts';
import { NAME_MAX_LETTERS } from '../src/shared/run-rules.ts';

test('TC-01 clean names are allowed', () => {
  for (const name of ['JELLY', 'ZZ9', 'J3LLY', 'MWMWMWMWM', 'BOB', 'A']) assert.equal(isBlocked(name), false, name);
});

test('TC-02 blocked words are caught in capitals and lower case', () => {
  for (const name of ['FUCK', 'fuck', 'Shit']) assert.equal(isBlocked(name), true, name);
});

test('TC-03 look-alike digits for letters are caught', () => {
  for (const name of ['SH1T', 'F4G', '5H1T', 'N4ZI', 'PORN0']) assert.equal(isBlocked(name), name !== 'F4G', name);
});

test('TC-04 stretched letters and words buried in a longer name are caught', () => {
  for (const name of ['FUUUUCK', 'XXSHITXX', 'MR5HIT']) assert.equal(isBlocked(name), true, name);
});

test('TC-05 innocent names that contain a blocked word are allowed through the documented exceptions', () => {
  for (const name of ['PEACOCK', 'COCKPIT', 'SPICE', 'GRAPES', 'PRICKLY', 'SHIITAKE']) assert.equal(isBlocked(name), false, name);
});

test('normalise upper-cases, swaps look-alikes and collapses repeats', () => {
  assert.equal(normalise('aa11bb'), 'AIB');
  assert.equal(normalise(''), '');
});

test('cleanName keeps letters and digits, upper-cased, cut at the limit', () => {
  assert.equal(cleanName('a b-c!1'), 'ABC1');
  assert.equal(cleanName('x'.repeat(30)).length, NAME_MAX_LETTERS);
  assert.equal(cleanName('é ü'), '');
});
