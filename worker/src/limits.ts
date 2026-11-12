/** Flood limit: scores one address may post in a window. Addresses are hashed with a secret and never stored raw. */
import { FLOOD_ALLOWANCE, FLOOD_WINDOW_SECONDS, MS_PER_SECOND } from '../../src/shared/run-rules.ts';
import type { Env } from './env.ts';
import { sha256Hex } from './token.ts';

export async function checkFlood(env: Env, address: string, now: number): Promise<boolean> {
  const bucket = await sha256Hex(`${env.ADDRESS_SALT}:${address}`);
  const windowMs = FLOOD_WINDOW_SECONDS * MS_PER_SECOND;
  const row = await env.DB.prepare(
    `INSERT INTO flood (bucket, window_start_ms, posts) VALUES (?1, ?2, 1)
     ON CONFLICT (bucket) DO UPDATE SET
       posts = CASE WHEN ?2 - window_start_ms >= ?3 THEN 1 ELSE posts + 1 END,
       window_start_ms = CASE WHEN ?2 - window_start_ms >= ?3 THEN ?2 ELSE window_start_ms END
     RETURNING posts`,
  ).bind(bucket, now, windowMs).first<{ posts: number }>();
  return (row?.posts ?? 0) <= FLOOD_ALLOWANCE;
}
