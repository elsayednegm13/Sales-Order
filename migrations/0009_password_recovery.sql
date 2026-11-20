CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at INTEGER NOT NULL,
  expires_at INTEGER,
  used_at INTEGER,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS password_reset_requests_user_status_idx ON password_reset_requests (user_id, status);
CREATE INDEX IF NOT EXISTS password_reset_requests_status_requested_idx ON password_reset_requests (status, requested_at);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS admin_recovery_codes_user_used_idx ON admin_recovery_codes (user_id, used_at);
