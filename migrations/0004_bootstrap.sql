-- Retain this record even if the first administrator is later deleted.
CREATE TABLE installation (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 admin_id TEXT NOT NULL,
 completed_at TEXT NOT NULL
);
-- Existing installations must never reopen setup.
INSERT INTO installation(id,admin_id,completed_at)
 SELECT 1,id,created_at FROM users WHERE role='ADMIN' ORDER BY created_at,id LIMIT 1;
