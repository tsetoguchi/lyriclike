CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event TEXT NOT NULL,
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX logs_user ON logs(user_id, created_at DESC);
CREATE INDEX logs_event ON logs(event, created_at DESC);
