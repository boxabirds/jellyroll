/** The table: best accepted scores first, earlier first on a tie, removed rows left out. */
import { TABLE_PAGE_SIZE } from '../../src/shared/run-rules.ts';
import type { Env } from './env.ts';

export interface Row { rank: number; name: string; distance: number; mine?: boolean }

interface ScoreRow { id: string; name: string; distance: number; created_ms: number }

export async function listScores(env: Env, offset: number, mineId?: string | null): Promise<{ rows: Row[]; me: Row | null }> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, distance, created_ms FROM scores WHERE removed_ms IS NULL ORDER BY distance DESC, created_ms ASC LIMIT ?1 OFFSET ?2',
  ).bind(TABLE_PAGE_SIZE, offset).all<ScoreRow>();
  const rows = results.map((r, i): Row => ({ rank: offset + i + 1, name: r.name, distance: r.distance, ...(r.id === mineId ? { mine: true } : {}) }));
  let me: Row | null = rows.find((r) => r.mine) ?? null;
  if (!me && mineId) me = await rankOf(env, mineId);
  return { rows, me };
}

export async function rankOf(env: Env, scoreId: string): Promise<Row | null> {
  const row = await env.DB.prepare('SELECT id, name, distance, created_ms FROM scores WHERE id = ?1 AND removed_ms IS NULL')
    .bind(scoreId).first<ScoreRow>();
  if (!row) return null;
  const ahead = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE removed_ms IS NULL AND (distance > ?1 OR (distance = ?1 AND created_ms < ?2))',
  ).bind(row.distance, row.created_ms).first<{ n: number }>();
  return { rank: (ahead?.n ?? 0) + 1, name: row.name, distance: row.distance, mine: true };
}
