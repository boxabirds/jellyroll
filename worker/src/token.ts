/** Run tokens: `runId.startMs.signature`, signed with HMAC-SHA256 so the browser cannot make or change one. */
const encoder = new TextEncoder();
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % HEX_DIGITS_PER_BYTE !== 0 || /[^0-9a-f]/.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / HEX_DIGITS_PER_BYTE));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * HEX_DIGITS_PER_BYTE, (i + 1) * HEX_DIGITS_PER_BYTE), HEX_RADIX);
  return out;
}

function key(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signToken(secret: string, runId: string, startedMs: number): Promise<string> {
  const payload = `${runId}.${startedMs}`;
  const signature = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(payload));
  return `${payload}.${toHex(signature)}`;
}

export interface TokenClaims { runId: string; startedMs: number }

/** The claims of a genuine token, or null for anything else (checked in constant time). */
export async function verifyToken(secret: string, token: unknown): Promise<TokenClaims | null> {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [runId, started, signature] = parts;
  const bytes = fromHex(signature);
  if (!bytes || !/^[0-9a-f]{32}$/.test(runId) || !/^\d{1,15}$/.test(started)) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), bytes, encoder.encode(`${runId}.${started}`));
  return ok ? { runId, startedMs: Number(started) } : null;
}

/** 16 random bytes as hex: a run or score id. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')).join('');
}

/** SHA-256 of a string as hex. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}
