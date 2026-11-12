import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_GAP_SECONDS, MAX_RUN_SECONDS, MS_PER_SECOND, SLACK_METRES, maxDistance } from '../src/shared/run-rules.ts';
import { signToken, verifyToken } from '../worker/src/token.ts';
import { makeStack, runStatus, scoreCount } from './worker-helpers.ts';

const seconds = (n: number) => n * MS_PER_SECOND;

test('TC-01 starting a run registers it with the server time and returns a token', async () => {
  const stack = await makeStack();
  try {
    const { status, body } = await stack.call('POST', '/api/run');
    assert.equal(status, 200);
    assert.match(body.token, /^[0-9a-f]{32}\.\d+\.[0-9a-f]{64}$/);
    assert.equal(await runStatus(stack, body.token), 'registered');
    const row = await stack.db.prepare('SELECT started_ms FROM runs').first<{ started_ms: number }>();
    assert.equal(row!.started_ms, stack.clock.now);
  } finally { await stack.close(); }
});

test('TC-02 a heartbeat inside the bound is stored and leaves the run registered', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += seconds(5);
    const beat = await stack.call('POST', '/api/run/beat', { token, distance: 100 });
    assert.equal(beat.status, 200);
    assert.deepEqual(beat.body, {}, 'the reply must not say whether the run is verified');
    assert.equal(await runStatus(stack, token), 'registered');
    const row = await stack.db.prepare('SELECT last_distance FROM runs').first<{ last_distance: number }>();
    assert.equal(row!.last_distance, 100);
  } finally { await stack.close(); }
});

test('TC-03 a heartbeat beyond the bound marks the run unverified, and TC-08 its score is then refused', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += seconds(5);
    const beat = await stack.call('POST', '/api/run/beat', { token, distance: maxDistance(5) + 1 });
    assert.equal(beat.status, 200);
    assert.equal(await runStatus(stack, token), 'unverified');
    const score = await stack.call('POST', '/api/score', { token, distance: 10, name: 'JELLY' });
    assert.equal(score.status, 409);
    assert.equal(score.body.reason, 'not-verified');
    assert.equal(await scoreCount(stack), 0);
  } finally { await stack.close(); }
});

test('TC-04 a heartbeat exactly on the bound stays registered', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += seconds(5);
    await stack.call('POST', '/api/run/beat', { token, distance: maxDistance(5) });
    assert.equal(await runStatus(stack, token), 'registered');
  } finally { await stack.close(); }
});

test('TC-05 a heartbeat after the longest gap marks the run unverified; exactly on the gap does not', async () => {
  const stack = await makeStack();
  try {
    const onGap = await stack.start();
    stack.clock.now += seconds(MAX_GAP_SECONDS);
    await stack.call('POST', '/api/run/beat', { token: onGap, distance: 0 });
    assert.equal(await runStatus(stack, onGap), 'registered');
    const late = await stack.start();
    stack.clock.now += seconds(MAX_GAP_SECONDS + 1);
    await stack.call('POST', '/api/run/beat', { token: late, distance: 0 });
    assert.equal(await runStatus(stack, late), 'unverified');
  } finally { await stack.close(); }
});

test('TC-06 a score inside the bound is accepted and spends the run', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += seconds(60);
    const { status, body } = await stack.call('POST', '/api/score', { token, distance: 700, name: 'jelly' });
    assert.equal(status, 200);
    assert.equal(body.accepted, true);
    assert.equal(body.rank, 1);
    assert.equal(await runStatus(stack, token), 'spent');
    const row = await stack.db.prepare('SELECT name, distance FROM scores').first<{ name: string; distance: number }>();
    assert.deepEqual(row, { name: 'JELLY', distance: 700 });
  } finally { await stack.close(); }
});

test('TC-07 a score beyond the bound is refused as not possible, writes nothing, and the run can still score honestly', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += seconds(10);
    const fake = await stack.call('POST', '/api/score', { token, distance: maxDistance(10) + 1, name: 'CHEAT' });
    assert.equal(fake.status, 422);
    assert.equal(fake.body.reason, 'not-possible');
    assert.equal(await scoreCount(stack), 0);
    assert.equal(await runStatus(stack, token), 'registered');
    assert.equal(JSON.stringify(fake.body).includes(String(Math.floor(maxDistance(10)))), false, 'the limit must not be revealed');
    const real = await stack.call('POST', '/api/score', { token, distance: 50, name: 'REAL' });
    assert.equal(real.body.accepted, true);
  } finally { await stack.close(); }
});

test('TC-09 a spent run cannot score twice', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += seconds(30);
    assert.equal((await stack.call('POST', '/api/score', { token, distance: 100, name: 'ONE' })).body.accepted, true);
    const again = await stack.call('POST', '/api/score', { token, distance: 100, name: 'TWO' });
    assert.equal(again.status, 409);
    assert.equal(again.body.reason, 'not-verified');
    assert.equal(await scoreCount(stack), 1);
    const beat = await stack.call('POST', '/api/run/beat', { token, distance: 100 });
    assert.equal(beat.status, 409, 'a heartbeat on a spent run changes nothing');
  } finally { await stack.close(); }
});

test('TC-10 a run older than the longest run is refused as too long; exactly on the limit it is not', async () => {
  const stack = await makeStack();
  try {
    const exact = await stack.start();
    stack.clock.now += seconds(MAX_RUN_SECONDS);
    // Exactly at the limit the run is not too long (the silence rule refuses it instead, as no heartbeat came).
    const onLimit = await stack.call('POST', '/api/score', { token: exact, distance: 10, name: 'SLOW' });
    assert.notEqual(onLimit.body.reason, 'too-long');
    const over = await stack.start();
    stack.clock.now += seconds(MAX_RUN_SECONDS + 1);
    const reply = await stack.call('POST', '/api/score', { token: over, distance: 10, name: 'SLOW' });
    assert.equal(reply.status, 410);
    assert.equal(reply.body.reason, 'too-long');
  } finally { await stack.close(); }
});

test('TC-11 and TC-12 forged, altered and foreign tokens write nothing', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    const [id, started] = token.split('.');
    const forged = `${id}.${started}.${'0'.repeat(64)}`;
    const other = await signToken('another-secret', id, Number(started));
    const edited = await signToken(stack.env.RUN_SECRET, id, Number(started) + 1);
    stack.clock.now += seconds(10);
    for (const bad of [forged, other, edited, 'nonsense', '']) {
      const reply = await stack.call('POST', '/api/score', { token: bad, distance: 10, name: 'FORGE' });
      assert.equal(reply.status, 401);
      assert.equal(reply.body.reason, 'not-verified');
    }
    assert.equal(await scoreCount(stack), 0);
    assert.equal(await runStatus(stack, token), 'registered');
  } finally { await stack.close(); }
});

test('TC-13 two submissions at once: exactly one is accepted', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += seconds(30);
    const replies = await Promise.all([
      stack.call('POST', '/api/score', { token, distance: 100, name: 'AAA' }),
      stack.call('POST', '/api/score', { token, distance: 100, name: 'BBB' }),
    ]);
    assert.equal(replies.filter((r) => r.body.accepted === true).length, 1);
    assert.equal(await scoreCount(stack), 1);
  } finally { await stack.close(); }
});

test('TC-14 and TC-15 the bound: only the slack at zero seconds, and top speed times the longest run plus slack', () => {
  assert.equal(maxDistance(0), SLACK_METRES);
  assert.ok(maxDistance(MAX_RUN_SECONDS) > maxDistance(MAX_RUN_SECONDS - 1));
  assert.equal(maxDistance(-5), SLACK_METRES, 'negative elapsed time must not shrink the bound below the slack');
});

test('TC-16 a token altered by one character does not verify', async () => {
  const token = await signToken('secret', 'a'.repeat(32), 1234);
  assert.deepEqual(await verifyToken('secret', token), { runId: 'a'.repeat(32), startedMs: 1234 });
  const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
  assert.equal(await verifyToken('secret', flipped), null);
  assert.equal(await verifyToken('other', token), null);
  assert.equal(await verifyToken('secret', 42), null);
});

test('bad request shapes are refused without touching the database', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    for (const body of [{ token, distance: -1, name: 'A' }, { token, distance: 'far', name: 'A' }, { token, distance: 1e12, name: 'A' }, { token, distance: 5 }]) {
      assert.equal((await stack.call('POST', '/api/score', body)).status, 400);
    }
    assert.equal((await stack.call('POST', '/api/run/beat', { token })).status, 400);
    assert.equal(await scoreCount(stack), 0);
  } finally { await stack.close(); }
});
