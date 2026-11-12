-- One row per registered run. Times are server milliseconds since the epoch.
-- Status values (validated in code, not by a constraint): registered, unverified, spent.
CREATE TABLE runs (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  started_ms INTEGER NOT NULL,
  last_ms INTEGER NOT NULL,
  last_distance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'registered'
);

-- One row per accepted score, written in the same batch that spends its run.
CREATE TABLE scores (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  run_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  distance REAL NOT NULL,
  created_ms INTEGER NOT NULL,
  removed_ms INTEGER
);
CREATE INDEX scores_by_distance ON scores (distance DESC, created_ms ASC);

-- Posts per hashed address in the current window. The address itself is never stored.
CREATE TABLE flood (
  bucket TEXT PRIMARY KEY,
  window_start_ms INTEGER NOT NULL,
  posts INTEGER NOT NULL
);
