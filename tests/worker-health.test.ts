import assert from 'node:assert/strict';
import test from 'node:test';
import { makeStack } from './worker-helpers.ts';

test('health says which build is deployed when the deploy set it, and still answers when it did not', async () => {
  const stamped = await makeStack({ APP_VERSION: '0.2.0', GIT_SHA: 'abc1234', DEPLOYED_AT: '2026-11-13T10:00:00Z', ENVIRONMENT: 'production' });
  try {
    const health = await stamped.call('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok', environment: 'production', version: '0.2.0', sha: 'abc1234', deployedAt: '2026-11-13T10:00:00Z' });
  } finally { await stamped.close(); }
  const plain = await makeStack();
  try {
    assert.deepEqual((await plain.call('GET', '/api/health')).body, { status: 'ok', environment: 'local' });
  } finally { await plain.close(); }
});
