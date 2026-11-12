/** Runs: registered when a game starts, checked in on while it is played, spent when its score is accepted. */
import { HEARTBEAT_SECONDS, LEADERBOARD_SIZE, MAX_GAP_SECONDS, MAX_RUN_SECONDS, MS_PER_SECOND, maxDistance } from '../../src/shared/run-rules.ts';
import type { Refusal } from '../../src/shared/run-rules.ts';
import type { Env } from './env.ts';
import { randomId, signToken, verifyToken } from './token.ts';

interface RunRow { id: string; started_ms: number; last_ms: number; last_distance: number; status: string }

export async function registerRun(env: Env, now: number): Promise<{ token: string; heartbeatSeconds: number }> {
  const id = randomId();
  await env.DB.prepare('INSERT INTO runs (id, started_ms, last_ms, last_distance, status) VALUES (?1, ?2, ?2, 0, ?3)')
    .bind(id, now, 'registered').run();
  return { token: await signToken(env.RUN_SECRET, id, now), heartbeatSeconds: HEARTBEAT_SECONDS };
}

async function loadRun(env: Env, token: unknown): Promise<RunRow | null> {
  const claims = await verifyToken(env.RUN_SECRET, token);
  if (!claims) return null;
  const row = await env.DB.prepare('SELECT id, started_ms, last_ms, last_distance, status FROM runs WHERE id = ?1')
    .bind(claims.runId).first<RunRow>();
  return row && row.started_ms === claims.startedMs ? row : null;
}

/** True when the distance and timing of a report could not have come from a real jelly. */
function impossible(run: RunRow, distance: number, now: number): boolean {
  const sinceLast = (now - run.last_ms) / MS_PER_SECOND;
  const sinceStart = (now - run.started_ms) / MS_PER_SECOND;
  return sinceLast > MAX_GAP_SECONDS
    || distance < run.last_distance
    || distance - run.last_distance > maxDistance(sinceLast)
    || distance > maxDistance(sinceStart);
}

export type BeatResult = { ok: true } | { ok: false; status: 401 | 409 };

export async function recordHeartbeat(env: Env, token: unknown, distance: number, now: number): Promise<BeatResult> {
  const run = await loadRun(env, token);
  if (!run) return { ok: false, status: 401 };
  if (run.status === 'spent') return { ok: false, status: 409 };
  if (run.status === 'unverified') return { ok: true };
  if (impossible(run, distance, now)) {
    await env.DB.prepare('UPDATE runs SET status = ?2 WHERE id = ?1 AND status = ?3').bind(run.id, 'unverified', 'registered').run();
    return { ok: true };
  }
  await env.DB.prepare('UPDATE runs SET last_ms = ?2, last_distance = ?3 WHERE id = ?1 AND status = ?4')
    .bind(run.id, now, distance, 'registered').run();
  return { ok: true };
}

type Refused = { ok: false; status: 401 | 409 | 410 | 422; refusal: Refusal };

/** Whether this run, at this moment, could really have rolled this far. */
async function checkRun(env: Env, token: unknown, distance: number, now: number): Promise<{ ok: true; run: RunRow } | Refused> {
  const run = await loadRun(env, token);
  if (!run) return { ok: false, status: 401, refusal: 'not-verified' };
  if (run.status === 'spent' || run.status === 'unverified') return { ok: false, status: 409, refusal: 'not-verified' };
  if ((now - run.started_ms) / MS_PER_SECOND > MAX_RUN_SECONDS) return { ok: false, status: 410, refusal: 'too-long' };
  if ((now - run.last_ms) / MS_PER_SECOND > MAX_GAP_SECONDS) return { ok: false, status: 409, refusal: 'not-verified' };
  if (distance - run.last_distance > maxDistance((now - run.last_ms) / MS_PER_SECOND)
    || distance > maxDistance((now - run.started_ms) / MS_PER_SECOND)) {
    return { ok: false, status: 422, refusal: 'not-possible' };
  }
  return { ok: true, run };
}

/** The rank a roll of this distance would take now: everything at least as far is ahead of it, since earlier wins a tie. */
async function wouldRank(env: Env, distance: number): Promise<number> {
  const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE removed_ms IS NULL AND distance >= ?1').bind(distance).first<{ n: number }>();
  return (ahead?.n ?? 0) + 1;
}

export type QualifyResult = { ok: true; qualifies: boolean; rank: number } | Refused;

/** At game over: does this verified roll earn a place on the leaderboard? Nothing is written. */
export async function qualifyRun(env: Env, token: unknown, distance: number, now: number): Promise<QualifyResult> {
  const checked = await checkRun(env, token, distance, now);
  if (!checked.ok) return checked;
  const rank = await wouldRank(env, distance);
  return { ok: true, qualifies: rank <= LEADERBOARD_SIZE, rank };
}

export type SpendResult =
  | { ok: true; scoreId: string; rank: number }
  | Refused;

/**
 * Turn a run into a score, once, if it earns a place. The run is spent and the score row written in one batch that only
 * writes the row when the run was still registered, so two submissions at once cannot both win.
 */
export async function spendRun(env: Env, token: unknown, distance: number, name: string, now: number): Promise<SpendResult> {
  const checked = await checkRun(env, token, distance, now);
  if (!checked.ok) return checked;
  const run = checked.run;
  if (await wouldRank(env, distance) > LEADERBOARD_SIZE) return { ok: false, status: 422, refusal: 'not-top' };
  const scoreId = randomId();
  await env.DB.batch([
    env.DB.prepare('UPDATE runs SET status = ?2, last_ms = ?3, last_distance = ?4 WHERE id = ?1 AND status = ?5')
      .bind(run.id, 'spent', now, distance, 'registered'),
    env.DB.prepare('INSERT INTO scores (id, run_id, name, distance, created_ms) SELECT ?1, ?2, ?3, ?4, ?5 WHERE changes() = 1')
      .bind(scoreId, run.id, name, distance, now),
  ]);
  const written = await env.DB.prepare('SELECT id, distance, created_ms FROM scores WHERE run_id = ?1')
    .bind(run.id).first<{ id: string; distance: number; created_ms: number }>();
  if (!written || written.id !== scoreId) return { ok: false, status: 409, refusal: 'not-verified' };
  const ahead = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE removed_ms IS NULL AND (distance > ?1 OR (distance = ?1 AND created_ms < ?2))',
  ).bind(written.distance, written.created_ms).first<{ n: number }>();
  return { ok: true, scoreId, rank: (ahead?.n ?? 0) + 1 };
}
