CREATE TABLE system_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 zone_id TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
 auth_mode TEXT NOT NULL DEFAULT 'token' CHECK(auth_mode IN ('token','key')),
 encrypted_secret TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
 next_purge_at TEXT NOT NULL DEFAULT '', last_status TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL
);
CREATE TABLE cache_purge_tasks (
 prefix TEXT PRIMARY KEY, revision TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX cache_purge_due ON cache_purge_tasks(next_attempt_at);
