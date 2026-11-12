import assert from 'node:assert/strict';
import test from 'node:test';
import { LEADERBOARD_SIZE, MS_PER_SECOND, maxDistance } from '../src/shared/run-rules.ts';
import { makeStack, runStatus, scoreCount, START_MS } from './worker-helpers.ts';
import type { Stack } from './worker-helpers.ts';

let nextId = 0;
async function insert(stack: Stack, name: string, distance: number) {
  const id = (++nextId).toString(16).padStart(32, '0');
  await stack.db.prepare('INSERT INTO scores (id, run_id, name, distance, created_ms) VALUES (?1, ?1, ?2, ?3, ?4)').bind(id, name, distance, START_MS - 1000 + nextId).run();
  return id;
}
/** A full leaderboard: ten rolls from 1000 m down to 910 m. */
async function fill(stack: Stack, count = LEADERBOARD_SIZE) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(await insert(stack, `P${i}`, 1000 - i * 10));
  return ids;
}
/** A run that has been going long enough to have rolled `distance` at most. */
async function run(stack: Stack) {
  const token = await stack.start();
  stack.clock.now += 120 * MS_PER_SECOND;
  return token;
}
const finish = (stack: Stack, token: string, distance: number) => stack.call('POST', '/api/run/finish', { token, distance });

test('an empty leaderboard: any verified roll qualifies as first, and asking writes nothing', async () => {
  const stack = await makeStack();
  try {
    const token = await run(stack);
    const reply = await finish(stack, token, 50);
    assert.deepEqual([reply.status, reply.body], [200, { qualifies: true, rank: 1 }]);
    assert.equal(await scoreCount(stack), 0);
    assert.equal(await runStatus(stack, token), 'registered');
  } finally { await stack.close(); }
});

test('one place short of full: the lowest roll still qualifies, in last place', async () => {
  const stack = await makeStack();
  try {
    await fill(stack, LEADERBOARD_SIZE - 1);
    const reply = await finish(stack, await run(stack), 5);
    assert.deepEqual(reply.body, { qualifies: true, rank: LEADERBOARD_SIZE });
  } finally { await stack.close(); }
});

test('a full leaderboard: just above the tenth qualifies, equal to it does not (earlier wins a tie), below it does not', async () => {
  const stack = await makeStack();
  try {
    await fill(stack);
    assert.deepEqual((await finish(stack, await run(stack), 911)).body, { qualifies: true, rank: LEADERBOARD_SIZE });
    assert.deepEqual((await finish(stack, await run(stack), 910)).body, { qualifies: false, rank: LEADERBOARD_SIZE + 1 });
    assert.deepEqual((await finish(stack, await run(stack), 100)).body, { qualifies: false, rank: LEADERBOARD_SIZE + 1 });
    assert.deepEqual((await finish(stack, await run(stack), 1001)).body, { qualifies: true, rank: 1 });
  } finally { await stack.close(); }
});

test('a row the owner removed opens a place', async () => {
  const stack = await makeStack();
  try {
    const ids = await fill(stack);
    assert.equal((await finish(stack, await run(stack), 905)).body.qualifies, false);
    await stack.call('DELETE', `/api/admin/scores/${ids[3]}`, undefined, { 'x-admin-secret': stack.env.ADMIN_SECRET });
    assert.equal((await finish(stack, await run(stack), 905)).body.qualifies, true);
  } finally { await stack.close(); }
});

test('a roll that could not have happened is not told it qualifies, and the reason is general', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += 10 * MS_PER_SECOND;
    const impossible = await finish(stack, token, maxDistance(10) + 1);
    assert.deepEqual([impossible.status, impossible.body], [422, { qualifies: false, reason: 'not-possible' }]);
    const forged = await finish(stack, `${token.slice(0, -1)}0`, 5);
    assert.deepEqual([forged.status, forged.body.qualifies, forged.body.reason], [401, false, 'not-verified']);
    const unverified = await stack.start();
    stack.clock.now += 5 * MS_PER_SECOND;
    await stack.call('POST', '/api/run/beat', { token: unverified, distance: maxDistance(5) + 1 });
    assert.equal((await finish(stack, unverified, 5)).body.reason, 'not-verified');
  } finally { await stack.close(); }
});

test('posting a name for a roll that does not make the leaderboard is refused, writes nothing, and keeps the run', async () => {
  const stack = await makeStack();
  try {
    await fill(stack);
    const token = await run(stack);
    const reply = await stack.call('POST', '/api/score', { token, distance: 100, name: 'LOW' });
    assert.deepEqual([reply.status, reply.body], [422, { accepted: false, reason: 'not-top' }]);
    assert.equal(await scoreCount(stack), LEADERBOARD_SIZE);
    assert.equal(await runStatus(stack, token), 'registered');
  } finally { await stack.close(); }
});

test('a roll that qualifies is accepted at the rank it was told', async () => {
  const stack = await makeStack();
  try {
    await fill(stack);
    const token = await run(stack);
    const asked = (await finish(stack, token, 955)).body;
    const posted = await stack.call('POST', '/api/score', { token, distance: 955, name: 'ZOE' });
    assert.equal(posted.body.accepted, true);
    assert.equal(posted.body.rank, asked.rank);
  } finally { await stack.close(); }
});
