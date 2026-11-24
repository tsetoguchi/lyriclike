-- The "your song is waiting" email. reminder_emails keeps the last one sent
-- to each account, so nobody gets more than one every 14 days.
-- reminder_opt_outs lists the accounts that turned these emails off.
CREATE TABLE reminder_emails (
  user_id   TEXT PRIMARY KEY,
  lyric_id  TEXT NOT NULL,
  sent_at   INTEGER NOT NULL
);

CREATE TABLE reminder_opt_outs (
  user_id     TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);
