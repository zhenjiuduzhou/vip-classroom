PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE,
 password_hash TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
 vip_level INTEGER CHECK(vip_level BETWEEN 1 AND 5), vip_expires_at TEXT,
 role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('USER','ADMIN')),
 created_at TEXT NOT NULL,
 CHECK(email IS NOT NULL OR phone IS NOT NULL)
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE courses (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 cover_key TEXT, required_vip INTEGER NOT NULL CHECK(required_vip BETWEEN 1 AND 5),
 sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE chapters (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX chapters_course ON chapters(course_id,sort_order);
CREATE TABLE lessons (
 id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
 title TEXT NOT NULL, video_key TEXT,
 status TEXT NOT NULL DEFAULT 'UPLOADING' CHECK(status IN ('UPLOADING','READY')),
 sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX lessons_chapter ON lessons(chapter_id,sort_order);
CREATE TABLE auth_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
