/** Owner-only routes. The secret is compared as hashes, so the comparison takes the same time whatever is typed. */
import type { Env } from './env.ts';
import { sha256Hex } from './token.ts';

export async function isOwner(env: Env, supplied: string | null): Promise<boolean> {
  if (!env.ADMIN_SECRET || !supplied) return false;
  const [a, b] = await Promise.all([sha256Hex(env.ADMIN_SECRET), sha256Hex(supplied)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function removeScore(env: Env, id: string, now: number): Promise<boolean> {
  const result = await env.DB.prepare('UPDATE scores SET removed_ms = ?2 WHERE id = ?1 AND removed_ms IS NULL').bind(id, now).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Everything including ids, newest first, so the owner can find what to remove. */
export async function listForOwner(env: Env): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, distance, created_ms, removed_ms FROM scores ORDER BY created_ms DESC LIMIT 200',
  ).all();
  return results;
}
