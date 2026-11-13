/** What the Worker needs from Cloudflare, declared here so the code and its tests need no extra type package. */
export interface D1Result<T = unknown> { results: T[]; success: boolean; meta: { changes?: number } }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface Env {
  DB: D1Database;
  /** Signs run tokens. */
  RUN_SECRET: string;
  /** Lets the owner remove rows. */
  ADMIN_SECRET: string;
  /** Hashes addresses for the flood limit. */
  ADDRESS_SALT: string;
  /** Turnstile secret; when absent outside production the challenge is skipped. */
  TURNSTILE_SECRET?: string;
  /** local, staging or production. */
  ENVIRONMENT: string;
  /** What is deployed: set by scripts/deploy, shown by /api/health. */
  APP_VERSION?: string;
  GIT_SHA?: string;
  DEPLOYED_AT?: string;
  /** The built game, served for every path that is not under /api. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

/** Time and network the handler uses, replaceable by tests. */
export interface Deps {
  now: () => number;
  fetch: typeof fetch;
}
