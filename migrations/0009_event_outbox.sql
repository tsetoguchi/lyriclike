-- Event hook messages that failed both tries, kept until a later page load
-- sends them. No foreign key on page_id: a page.deleted outlives its page.
CREATE TABLE event_outbox (
  id               TEXT PRIMARY KEY,           -- the message's own id
  page_id          TEXT,
  body             TEXT NOT NULL,              -- the message as sent, JSON
  attempts         INTEGER NOT NULL,
  next_attempt_at  INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX event_outbox_due ON event_outbox(next_attempt_at);
CREATE INDEX event_outbox_page ON event_outbox(page_id);
