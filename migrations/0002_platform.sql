ALTER TABLE courses ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chapters ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE uploads (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
 course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('VIDEO','COVER')),
 object_key TEXT NOT NULL UNIQUE, multipart_id TEXT,
 filename TEXT NOT NULL, fingerprint TEXT NOT NULL, expected_size INTEGER NOT NULL,
 content_type TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'UPLOADING'
 CHECK(state IN ('UPLOADING','COMPLETING','COMPLETE','CANCELLED')),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, locked_at TEXT,
 CHECK((kind='VIDEO' AND lesson_id IS NOT NULL) OR (kind='COVER' AND course_id IS NOT NULL))
);
CREATE INDEX uploads_owner ON uploads(owner_id,state);
CREATE INDEX uploads_expiry ON uploads(state,expires_at);
CREATE TABLE upload_parts (
 upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
 part_number INTEGER NOT NULL, etag TEXT NOT NULL,
 PRIMARY KEY(upload_id,part_number)
);
CREATE TABLE cleanup_tasks (
 id TEXT PRIMARY KEY, object_key TEXT NOT NULL, multipart_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX cleanup_due ON cleanup_tasks(next_attempt_at);
