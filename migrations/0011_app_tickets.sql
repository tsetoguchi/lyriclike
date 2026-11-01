-- Short-lived, single-use tickets for the mobile apps. A "socket" ticket lets
-- the app open the live-editing WebSocket, which cannot carry an Authorization
-- header; a "signin" ticket hands a Google sign-in from the system browser back
-- to the app. Only the hash of the ticket is stored.
CREATE TABLE app_tickets (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  TEXT,
  challenge   TEXT,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX app_tickets_expires ON app_tickets(expires_at);
