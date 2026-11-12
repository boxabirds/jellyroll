import assert from 'node:assert/strict';
import test from 'node:test';
import { FLOOD_ALLOWANCE, FLOOD_WINDOW_SECONDS, MS_PER_SECOND } from '../src/shared/run-rules.ts';
import { ALWAYS_FAILS, ALWAYS_PASSES, makeStack, runStatus, scoreCount } from './worker-helpers.ts';
import type { Stack } from './worker-helpers.ts';

async function post(stack: Stack, name: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const token = await stack.start();
  stack.clock.now += 5 * MS_PER_SECOND;
  const reply = await stack.call('POST', '/api/score', { token, distance: 100, name, ...extra }, headers);
  return { token, ...reply };
}

test('TC-06 and TC-07 a blocked name is refused, leaves the run registered, and the same run then succeeds with another name', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += 5_000;
    for (const bad of ['FUCK', 'sh1t', 'FUUUCK', 'N4ZI']) {
      const reply = await stack.call('POST', '/api/score', { token, distance: 100, name: bad });
      assert.equal(reply.status, 422);
      assert.equal(reply.body.reason, 'bad-name');
      assert.equal(JSON.stringify(reply.body).toLowerCase().includes(bad.toLowerCase()), false, 'the reply must not name the word');
    }
    assert.equal(await scoreCount(stack), 0);
    assert.equal(await runStatus(stack, token), 'registered');
    assert.equal((await stack.call('POST', '/api/score', { token, distance: 100, name: 'JELLY' })).body.accepted, true);
  } finally { await stack.close(); }
});

test('an empty name, or one made only of symbols, is refused', async () => {
  const stack = await makeStack();
  try {
    assert.equal((await post(stack, '')).status, 422);
    assert.equal((await post(stack, '!!! ???')).status, 422);
    assert.equal(await scoreCount(stack), 0);
  } finally { await stack.close(); }
});

test('a long name is cut to nine letters and shown in capitals', async () => {
  const stack = await makeStack();
  try {
    assert.equal((await post(stack, 'abcdefghijklmnop')).body.accepted, true);
    assert.equal((await stack.db.prepare('SELECT name FROM scores').first<{ name: string }>())!.name, 'ABCDEFGHI');
  } finally { await stack.close(); }
});

test('TC-08 TC-09 TC-10 the flood limit: the allowance is accepted, one over is refused and keeps its run, and a new window works', async () => {
  const stack = await makeStack();
  try {
    for (let i = 0; i < FLOOD_ALLOWANCE; i++) assert.equal((await post(stack, `P${i}`)).body.accepted, true);
    const over = await post(stack, 'OVER');
    assert.equal(over.status, 429);
    assert.equal(over.body.reason, 'busy');
    assert.equal(await runStatus(stack, over.token), 'registered');
    assert.equal(await scoreCount(stack), FLOOD_ALLOWANCE);
    stack.clock.now += FLOOD_WINDOW_SECONDS * MS_PER_SECOND;
    // The refused run has been silent for longer than the allowed gap by now, so a new run is needed.
    assert.equal((await post(stack, 'LATER')).body.accepted, true);
  } finally { await stack.close(); }
});

test('the flood limit is per address', async () => {
  const stack = await makeStack();
  try {
    for (let i = 0; i < FLOOD_ALLOWANCE; i++) await post(stack, `P${i}`, {}, { 'cf-connecting-ip': '203.0.113.1' });
    assert.equal((await post(stack, 'OTHER', {}, { 'cf-connecting-ip': '203.0.113.2' })).body.accepted, true);
    const stored = await stack.db.prepare('SELECT bucket FROM flood').all<{ bucket: string }>();
    assert.equal(stored.results.some((r) => r.bucket.includes('203.0.113')), false, 'addresses are never stored raw');
  } finally { await stack.close(); }
});

test('TC-11 a missing challenge is refused when the server asks for one', async () => {
  const stack = await makeStack({ TURNSTILE_SECRET: ALWAYS_PASSES });
  try {
    const reply = await post(stack, 'JELLY');
    assert.equal(reply.status, 403);
    assert.equal(reply.body.reason, 'challenge');
    assert.equal(await runStatus(stack, reply.token), 'registered');
    assert.equal(await scoreCount(stack), 0);
  } finally { await stack.close(); }
});

test('TC-12 a failing challenge is refused (against Cloudflare\'s real verifier and its published test secret)', async () => {
  const stack = await makeStack({ TURNSTILE_SECRET: ALWAYS_FAILS });
  try {
    const reply = await post(stack, 'JELLY', { challenge: 'XXXX.DUMMY.TOKEN.XXXX' });
    assert.equal(reply.status, 403);
    assert.equal(await scoreCount(stack), 0);
  } finally { await stack.close(); }
});

test('TC-13 a passing challenge is accepted', async () => {
  const stack = await makeStack({ TURNSTILE_SECRET: ALWAYS_PASSES });
  try {
    const reply = await post(stack, 'JELLY', { challenge: 'XXXX.DUMMY.TOKEN.XXXX' });
    assert.equal(reply.body.accepted, true);
  } finally { await stack.close(); }
});

test('without a Turnstile secret the challenge is skipped locally but never in production', async () => {
  const local = await makeStack();
  const production = await makeStack({ ENVIRONMENT: 'production' });
  try {
    assert.equal((await post(local, 'JELLY')).body.accepted, true);
    assert.equal((await post(production, 'JELLY')).status, 403);
  } finally { await local.close(); await production.close(); }
});

test('TC-14 TC-15 TC-16 owner removal: right secret removes, wrong secret does not, unknown id is 404', async () => {
  const stack = await makeStack();
  try {
    const posted = await post(stack, 'GONE');
    const id = posted.body.id as string;
    const secret = { 'x-admin-secret': stack.env.ADMIN_SECRET };

    for (const headers of [{}, { 'x-admin-secret': 'wrong' }]) {
      assert.equal((await stack.call('DELETE', `/api/admin/scores/${id}`, undefined, headers)).status, 401);
      assert.equal((await stack.call('GET', '/api/admin/scores', undefined, headers)).status, 401);
    }
    assert.equal(((await stack.call('GET', '/api/scores')).body.rows as unknown[]).length, 1, 'a wrong secret removes nothing');

    assert.equal((await stack.call('DELETE', `/api/admin/scores/${'0'.repeat(32)}`, undefined, secret)).status, 404);
    const listed = (await stack.call('GET', '/api/admin/scores', undefined, secret)).body.scores as { id: string }[];
    assert.equal(listed[0].id, id);
    assert.equal((await stack.call('DELETE', `/api/admin/scores/${id}`, undefined, secret)).status, 200);
    assert.equal(((await stack.call('GET', '/api/scores')).body.rows as unknown[]).length, 0);
    assert.equal((await stack.call('DELETE', `/api/admin/scores/${id}`, undefined, secret)).status, 404, 'removing twice is a not-found, not a second change');
    // The run stays spent, so the same score cannot be posted again.
    assert.equal((await stack.call('POST', '/api/score', { token: posted.token, distance: 100, name: 'AGAIN' })).status, 409);
  } finally { await stack.close(); }
});
