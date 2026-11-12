/** Cloudflare Turnstile: a check that real players pass without effort and scripts do not. */
import type { Deps, Env } from './env.ts';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyChallenge(env: Env, deps: Deps, token: unknown, address: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return env.ENVIRONMENT !== 'production';
  if (typeof token !== 'string' || token.length === 0) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: address });
  try {
    const reply = await deps.fetch(VERIFY_URL, { method: 'POST', body });
    return ((await reply.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
