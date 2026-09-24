-- Sign-in methods move out of users into identities, so an account no longer
-- has to have a Google identity. SQLite cannot drop NOT NULL in place, so
-- users is rebuilt.
--
-- sessions and lyrics point at users, and D1 enforces foreign keys. Dropping
-- users while they hold rows fails, and PRAGMA defer_foreign_keys does not
-- rescue it: the check at commit never sees the renamed replacement as the
-- parent. So their rows, and the Google subjects, are parked in *_keep tables
-- while users is swapped, and put back afterwards.

CREATE TABLE sessions_keep AS
  SELECT id, user_id, expires_at, created_at FROM sessions;
CREATE TABLE lyrics_keep AS
  SELECT id, user_id, title, body, updated_at, created_at FROM lyrics;
CREATE TABLE google_keep AS
  SELECT id AS user_id, google_sub, created_at FROM users;
DELETE FROM sessions;
DELETE FROM lyrics;

CREATE TABLE users_new (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL,
  email_normalized    TEXT NOT NULL,
  name                TEXT,
  password_hash       TEXT,
  password_updated_at INTEGER,
  created_at          INTEGER NOT NULL
);

INSERT INTO users_new (id, email, email_normalized, name, password_hash, password_updated_at, created_at)
  SELECT id, email, lower(trim(email)), name, NULL, NULL, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX users_email_normalized ON users(email_normalized);

CREATE TABLE identities (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  provider         TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (provider, provider_subject)
);
CREATE INDEX identities_user ON identities(user_id);

INSERT INTO identities (id, user_id, provider, provider_subject, created_at)
  SELECT lower(hex(randomblob(16))), user_id, 'google', google_sub, created_at FROM google_keep;
INSERT INTO sessions (id, user_id, expires_at, created_at)
  SELECT id, user_id, expires_at, created_at FROM sessions_keep;
INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at)
  SELECT id, user_id, title, body, updated_at, created_at FROM lyrics_keep;

DROP TABLE sessions_keep;
DROP TABLE lyrics_keep;
DROP TABLE google_keep;
