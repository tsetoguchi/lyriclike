-- Tables for email + password accounts. Nothing here touches existing rows, so
-- it can be applied whether or not PASSWORD_AUTH_ENABLED is on.

-- A signup waits here until its email is confirmed. There is deliberately no
-- user_id: an unconfirmed signup never touches users, so several rows can exist
-- for one address and each confirms only with its own password.
CREATE TABLE pending_signups (
  token_hash       TEXT PRIMARY KEY,           -- sha256 hex of the raw confirm token
  email            TEXT NOT NULL,              -- as entered
  email_normalized TEXT NOT NULL,
  name             TEXT,
  password_hash    TEXT NOT NULL,              -- this signup's own password
  failed_attempts  INTEGER NOT NULL DEFAULT 0, -- wrong passwords at confirm
  expires_at       INTEGER NOT NULL,           -- 24 hours
  created_at       INTEGER NOT NULL
);
CREATE INDEX pending_signups_email ON pending_signups(email_normalized);

-- email_normalized is the address the token was issued for, so a stale link
-- stops working if the account's address ever changes.
CREATE TABLE reset_tokens (
  token_hash       TEXT PRIMARY KEY,           -- sha256 hex of the raw token
  user_id          TEXT NOT NULL REFERENCES users(id),
  email_normalized TEXT NOT NULL,
  expires_at       INTEGER NOT NULL,           -- 30 minutes
  consumed_at      INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX reset_tokens_user ON reset_tokens(user_id);

-- Fixed-window counters. Keys carry a hash of the address, never the address.
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,               -- 'login:ip:203.0.113.7' etc.
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
