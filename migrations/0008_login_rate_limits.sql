CREATE TABLE IF NOT EXISTS login_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_rate_limits_updated_at_idx ON login_rate_limits (updated_at);
