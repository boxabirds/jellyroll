import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDistance } from '../src/shared/distance.ts';

test('TC-10 a distance is shown in metres below a kilometre and kilometres from one, as the HUD does', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(999.9), '999 m');
  assert.equal(formatDistance(1000), '1.00 km');
  assert.equal(formatDistance(2280), '2.28 km');
});
