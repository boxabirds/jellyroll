/** The score server: one Worker that answers /api/* and serves the built game for every other path. */
import { NAME_MAX_LETTERS } from '../../src/shared/run-rules.ts';
import { cleanName, isBlocked } from '../../src/shared/name-filter.ts';
import { isOwner, listForOwner, removeScore } from './admin.ts';
import { verifyChallenge } from './challenge.ts';
import type { Deps, Env } from './env.ts';
import { checkFlood } from './limits.ts';
import { qualifyRun, recordHeartbeat, registerRun, spendRun } from './runs.ts';
import { listScores } from './scores.ts';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY = 429;
const HTTP_UNAVAILABLE = 503;
const HTTP_UNPROCESSABLE = 422;
const MAX_DISTANCE_REPORTED = 10_000_000;
const MAX_BODY_BYTES = 2048;
const MAX_OFFSET = 10_000;
const ID_PATTERN = /^[0-9a-f]{32}$/;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cache-control': 'no-store',
};

function json(body: unknown, status = HTTP_OK): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...SECURITY_HEADERS } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function distanceOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DISTANCE_REPORTED ? value : null;
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: HTTP_NOT_FOUND });
  }
  const route = `${request.method} ${url.pathname}`;
  const address = request.headers.get('cf-connecting-ip') ?? 'local';
  try {
    if (route === 'GET /api/health') return json({ status: 'ok', environment: env.ENVIRONMENT });

    if (route === 'POST /api/run') return json(await registerRun(env, deps.now()));

    if (route === 'POST /api/run/beat') {
      const body = await readBody(request);
      const distance = distanceOf(body?.distance);
      if (!body || distance === null) return json({ error: 'bad request' }, HTTP_BAD_REQUEST);
      const result = await recordHeartbeat(env, body.token, distance, deps.now());
      return result.ok ? json({}) : json({ error: 'not accepted' }, result.status);
    }

    if (route === 'POST /api/run/finish') {
      const body = await readBody(request);
      const distance = distanceOf(body?.distance);
      if (!body || distance === null) return json({ error: 'bad request' }, HTTP_BAD_REQUEST);
      const result = await qualifyRun(env, body.token, distance, deps.now());
      return result.ok ? json({ qualifies: result.qualifies, rank: result.rank }) : json({ qualifies: false, reason: result.refusal }, result.status);
    }

    if (route === 'POST /api/score') {
      const body = await readBody(request);
      const distance = distanceOf(body?.distance);
      if (!body || distance === null || typeof body.name !== 'string') return json({ error: 'bad request' }, HTTP_BAD_REQUEST);
      const name = cleanName(body.name);
      if (name.length === 0 || name.length > NAME_MAX_LETTERS || isBlocked(name)) {
        return json({ accepted: false, reason: 'bad-name' }, HTTP_UNPROCESSABLE);
      }
      if (!(await checkFlood(env, address, deps.now()))) return json({ accepted: false, reason: 'busy' }, HTTP_TOO_MANY);
      if (!(await verifyChallenge(env, deps, body.challenge, address))) return json({ accepted: false, reason: 'challenge' }, HTTP_FORBIDDEN);
      const result = await spendRun(env, body.token, distance, name, deps.now());
      if (!result.ok) return json({ accepted: false, reason: result.refusal }, result.status);
      return json({ accepted: true, id: result.scoreId, rank: result.rank });
    }

    if (route === 'GET /api/scores') {
      const offset = Math.min(MAX_OFFSET, Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0)));
      const mine = url.searchParams.get('me');
      return json(await listScores(env, offset, mine && ID_PATTERN.test(mine) ? mine : null));
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!(await isOwner(env, request.headers.get('x-admin-secret')))) return json({ error: 'unauthorized' }, HTTP_UNAUTHORIZED);
      if (route === 'GET /api/admin/scores') return json({ scores: await listForOwner(env) });
      const id = url.pathname.slice('/api/admin/scores/'.length);
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/admin/scores/') && ID_PATTERN.test(id)) {
        return (await removeScore(env, id, deps.now())) ? json({ removed: true }) : json({ error: 'not found' }, HTTP_NOT_FOUND);
      }
    }
    return json({ error: 'not found' }, HTTP_NOT_FOUND);
  } catch (error) {
    console.error('score server error', error instanceof Error ? error.message : String(error));
    return json({ error: 'unavailable' }, HTTP_UNAVAILABLE);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { now: () => Date.now(), fetch: (...args) => fetch(...args) });
  },
};
