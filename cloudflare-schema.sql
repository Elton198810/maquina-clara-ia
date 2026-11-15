CREATE TABLE IF NOT EXISTS mc_orders (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, email_hash TEXT NOT NULL,
 provider_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
 machine TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS mc_email_idx ON mc_orders(email_hash);
CREATE TABLE IF NOT EXISTS mc_events (
 provider_id TEXT NOT NULL, event_type TEXT NOT NULL, attempt_id TEXT NOT NULL,
 PRIMARY KEY(provider_id,event_type)
);
CREATE INDEX IF NOT EXISTS mc_attempt_idx ON mc_events(attempt_id);
CREATE TABLE IF NOT EXISTS mc_diagnostics (id INTEGER PRIMARY KEY CHECK(id=1), verified_at TEXT);
INSERT OR IGNORE INTO mc_diagnostics(id) VALUES(1);
CREATE TABLE IF NOT EXISTS mc_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mc_limits_expiry_idx ON mc_limits(expires);