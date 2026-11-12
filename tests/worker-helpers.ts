/** A real local D1 database (from Miniflare) behind the real request handler, with a clock the tests control. */
import { readFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { handle } from '../worker/src/index.ts';
import type { D1Database, Deps, Env } from '../worker/src/env.ts';

export const START_MS = 1_700_000_000_000;
export const ALWAYS_PASSES = '1x0000000000000000000000000000000AA';
export const ALWAYS_FAILS = '2x0000000000000000000000000000000AA';

export interface Stack {
  env: Env;
  clock: { now: number };
  db: D1Database;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  /** Register a run and return its token. */
  start(): Promise<string>;
  close(): Promise<void>;
}

function statements(sql: string): string[] {
  return sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}

export async function makeStack(overrides: Partial<Env> = {}): Promise<Stack> {
  // The real local D1 (Miniflare's SQLite), taken from the same wrangler.toml the stack runs with, kept in memory.
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: new URL('../worker/wrangler.toml', import.meta.url).pathname, persist: false });
  const db = proxy.env.DB;
  for (const statement of statements(readFileSync(new URL('../worker/migrations/0001_init.sql', import.meta.url), 'utf8'))) {
    await db.prepare(statement).run();
  }
  const env: Env = { DB: db, RUN_SECRET: 'test-run-secret', ADMIN_SECRET: 'test-admin-secret', ADDRESS_SALT: 'test-salt', ENVIRONMENT: 'local', ...overrides };
  const clock = { now: START_MS };
  const deps: Deps = { now: () => clock.now, fetch: (...args) => fetch(...args) };
  const call: Stack['call'] = async (method, path, body, headers = {}) => {
    const request = new Request(`http://game.test${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await handle(request, env, deps);
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return {
    env, clock, db, call,
    start: async () => (await call('POST', '/api/run')).body.token as string,
    close: () => proxy.dispose(),
  };
}

export async function runStatus(stack: Stack, token: string): Promise<string> {
  const id = token.split('.')[0];
  return (await stack.db.prepare('SELECT status FROM runs WHERE id = ?1').bind(id).first<{ status: string }>())!.status;
}

export async function scoreCount(stack: Stack): Promise<number> {
  return (await stack.db.prepare('SELECT COUNT(*) AS n FROM scores').first<{ n: number }>())!.n;
}
