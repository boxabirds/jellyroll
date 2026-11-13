/**
 * The game's side of a run on the score server: registers the run when it starts, checks in while it is played, and posts
 * the score at the end. Nothing here ever slows or stops the game: if the server cannot be reached, the run simply cannot
 * go on the world table.
 */
import { HEARTBEAT_SECONDS, MS_PER_SECOND, SERVER_TIMEOUT_MS } from '../shared/run-rules.ts';
import type { Refusal } from '../shared/run-rules.ts';

const API = '/api';

export type SubmitResult =
  | { accepted: true; id: string; rank: number }
  | { accepted: false; reason: Refusal | 'offline' | 'debug' };

async function post(path: string, body?: unknown): Promise<{ status: number; body: any } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const response = await fetch(`${API}${path}`, {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type Qualification =
  | { qualifies: true; rank: number }
  | { qualifies: false; rank?: number; reason: Refusal | 'offline' | 'debug' };

export class RunSession {
  /** Set when a debug key moved the jelly: such a run is never offered to the world table. */
  debugUsed = false;
  private token: string | null = null;
  private timer = 0;
  private generation = 0;
  private readonly distance: () => number;

  constructor(distance: () => number) {
    this.distance = distance;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.beat(); });
  }

  /** The score server's token for this run, once it has one (saved with the run, so a reload can carry on with it). */
  get runToken(): string | null { return this.token; }

  /** Carry on a run saved before the page was lost: its token, and whether a debug key had disqualified it. */
  resume(token: string | null, debugUsed: boolean) {
    this.stop();
    this.debugUsed = debugUsed;
    if (!token) return;
    this.token = token;
    this.timer = window.setInterval(() => this.beat(), HEARTBEAT_SECONDS * MS_PER_SECOND);
    this.beat();
  }

  /** True when this run was registered and played without the debug keys. */
  get eligible(): boolean { return this.token !== null && !this.debugUsed; }

  /** A new run: register it, then check in at a steady rhythm. */
  start() {
    this.stop();
    this.debugUsed = false;
    const generation = ++this.generation;
    void post('/run').then(reply => {
      if (generation !== this.generation || !reply || reply.status !== 200 || typeof reply.body?.token !== 'string') return;
      this.token = reply.body.token;
      const seconds = Number(reply.body.heartbeatSeconds) || HEARTBEAT_SECONDS;
      this.timer = window.setInterval(() => this.beat(), seconds * MS_PER_SECOND);
    });
  }

  /** The run is over (or a new one is starting): stop checking in. */
  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.token = null;
    this.generation++;
  }

  /** Stop checking in but keep the token, for the score that follows. */
  finish() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  private beat() {
    if (!this.token || !this.timer || document.hidden) return;
    void post('/run/beat', { token: this.token, distance: this.distance() });
  }

  /** At game over: does this roll earn a place on the leaderboard? Nothing is recorded by asking. */
  async qualify(distance: number): Promise<Qualification> {
    if (this.debugUsed) return { qualifies: false, reason: 'debug' };
    if (!this.token) return { qualifies: false, reason: 'offline' };
    const reply = await post('/run/finish', { token: this.token, distance });
    if (!reply) return { qualifies: false, reason: 'offline' };
    if (reply.body?.qualifies === true) return { qualifies: true, rank: Number(reply.body.rank) };
    const reason = reply.body?.reason;
    if (typeof reason === 'string') return { qualifies: false, reason: reason as Refusal };
    return { qualifies: false, rank: Number(reply.body?.rank) || undefined, reason: 'not-top' };
  }

  async submit(name: string, distance: number, challenge?: string): Promise<SubmitResult> {
    if (this.debugUsed) return { accepted: false, reason: 'debug' };
    if (!this.token) return { accepted: false, reason: 'offline' };
    const reply = await post('/score', { token: this.token, distance, name, ...(challenge ? { challenge } : {}) });
    if (!reply) return { accepted: false, reason: 'offline' };
    if (reply.body?.accepted === true) return { accepted: true, id: String(reply.body.id), rank: Number(reply.body.rank) };
    const reason = reply.body?.reason;
    return { accepted: false, reason: typeof reason === 'string' ? reason as Refusal : 'not-verified' };
  }
}

export interface TableRow { rank: number; name: string; distance: number; mine?: boolean }
export interface Table { rows: TableRow[]; me: TableRow | null }

/** The world table, or null when it cannot be loaded. */
export async function loadTable(mineId?: string): Promise<Table | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const response = await fetch(`${API}/scores${mineId ? `?me=${encodeURIComponent(mineId)}` : ''}`, { signal: controller.signal });
    if (!response.ok) return null;
    const table = await response.json() as Table;
    return Array.isArray(table.rows) ? table : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
