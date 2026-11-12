import assert from 'node:assert/strict';
import test from 'node:test';
import { TABLE_PAGE_SIZE } from '../src/shared/run-rules.ts';
import { handle } from '../worker/src/index.ts';
import { makeStack, scoreCount, START_MS } from './worker-helpers.ts';
import type { Stack } from './worker-helpers.ts';

let nextId = 0;
/** A row written straight into the table, for table sizes that would take too many real runs. */
async function insert(stack: Stack, name: string, distance: number, createdMs = START_MS + nextId) {
  const id = (++nextId).toString(16).padStart(32, '0');
  await stack.db.prepare('INSERT INTO scores (id, run_id, name, distance, created_ms) VALUES (?1, ?1, ?2, ?3, ?4)').bind(id, name, distance, createdMs).run();
  return id;
}

async function table(stack: Stack, query = '') {
  return (await stack.call('GET', `/api/scores${query}`)).body as { rows: { rank: number; name: string; distance: number; mine?: boolean }[]; me: { rank: number } | null };
}

test('TC-01 an empty table returns an empty list', async () => {
  const stack = await makeStack();
  try {
    assert.deepEqual(await table(stack), { rows: [], me: null });
  } finally { await stack.close(); }
});

test('TC-02 a score accepted into an empty table is rank 1 and comes back as the player\'s own row', async () => {
  const stack = await makeStack();
  try {
    const token = await stack.start();
    stack.clock.now += 20_000;
    const posted = await stack.call('POST', '/api/score', { token, distance: 300, name: 'ZOE' });
    assert.equal(posted.body.rank, 1);
    const view = await table(stack, `?me=${posted.body.id}`);
    assert.deepEqual(view.rows, [{ rank: 1, name: 'ZOE', distance: 300, mine: true }]);
    assert.equal(view.me!.rank, 1);
  } finally { await stack.close(); }
});

test('TC-03 fewer than ten rows are in descending distance with correct ranks', async () => {
  const stack = await makeStack();
  try {
    for (const [name, d] of [['B', 200], ['A', 900], ['C', 50]] as const) await insert(stack, name, d);
    const view = await table(stack);
    assert.deepEqual(view.rows.map((r) => [r.rank, r.name]), [[1, 'A'], [2, 'B'], [3, 'C']]);
  } finally { await stack.close(); }
});

test('TC-04 exactly ten rows are all shown and the player in the top ten needs no extra row', async () => {
  const stack = await makeStack();
  try {
    let mine = '';
    for (let i = 0; i < TABLE_PAGE_SIZE; i++) { const id = await insert(stack, `P${i}`, 1000 - i * 10); if (i === 4) mine = id; }
    const view = await table(stack, `?me=${mine}`);
    assert.equal(view.rows.length, TABLE_PAGE_SIZE);
    assert.equal(view.rows.filter((r) => r.mine).length, 1);
    assert.equal(view.me!.rank, 5);
  } finally { await stack.close(); }
});

test('TC-05 more than ten rows: ten shown, and a player outside the top ten gets their true rank', async () => {
  const stack = await makeStack();
  try {
    for (let i = 0; i < 14; i++) await insert(stack, `P${i}`, 1000 - i * 10);
    const outside = await insert(stack, 'LOW', 5);
    const view = await table(stack, `?me=${outside}`);
    assert.equal(view.rows.length, TABLE_PAGE_SIZE);
    assert.equal(view.rows.some((r) => r.mine), false);
    assert.equal(view.me!.rank, 15);
    const second = await table(stack, '?offset=10');
    assert.equal(second.rows[0].rank, 11);
  } finally { await stack.close(); }
});

test('TC-06 with no player row asked for, only ten rows come back', async () => {
  const stack = await makeStack();
  try {
    for (let i = 0; i < 12; i++) await insert(stack, `P${i}`, 100 + i);
    const view = await table(stack);
    assert.equal(view.rows.length, TABLE_PAGE_SIZE);
    assert.equal(view.me, null);
  } finally { await stack.close(); }
});

test('TC-07 equal distances: the earlier accepted ranks higher, including across the page boundary', async () => {
  const stack = await makeStack();
  try {
    await insert(stack, 'LATE', 500, START_MS + 2000);
    await insert(stack, 'EARLY', 500, START_MS + 1000);
    const view = await table(stack);
    assert.deepEqual(view.rows.map((r) => r.name), ['EARLY', 'LATE']);
  } finally { await stack.close(); }
});

test('TC-08 a refused score adds no row and the table is unchanged', async () => {
  const stack = await makeStack();
  try {
    await insert(stack, 'KEEP', 400);
    const token = await stack.start();
    stack.clock.now += 5_000;
    await stack.call('POST', '/api/score', { token, distance: 99_999, name: 'FAKE' });
    assert.equal(await scoreCount(stack), 1);
    assert.deepEqual((await table(stack)).rows.map((r) => r.name), ['KEEP']);
  } finally { await stack.close(); }
});

test('TC-09 when the database is unavailable the server answers 503 and does not crash', async () => {
  const stack = await makeStack();
  try {
    const broken = { ...stack.env, DB: { prepare() { throw new Error('database down'); }, batch() { throw new Error('database down'); } } };
    const silence = console.error; console.error = () => {};
    try {
      const response = await handle(new Request('http://game.test/api/scores'), broken, { now: () => START_MS, fetch });
      assert.equal(response.status, 503);
      const registered = await handle(new Request('http://game.test/api/run', { method: 'POST' }), broken, { now: () => START_MS, fetch });
      assert.equal(registered.status, 503);
    } finally { console.error = silence; }
  } finally { await stack.close(); }
});

test('the list never exposes score ids, run ids or times', async () => {
  const stack = await makeStack();
  try {
    await insert(stack, 'SAFE', 100);
    const text = JSON.stringify(await table(stack));
    assert.equal(/created|run_id|"id"|token/.test(text), false);
  } finally { await stack.close(); }
});
