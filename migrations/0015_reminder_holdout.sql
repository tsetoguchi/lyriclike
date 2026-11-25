-- The song reminder holdout. One in five accounts that would get a "your song
-- is waiting" email is picked, by a fixed hash of its id, to get none. Each
-- is written here instead, at the moment the email would have gone out, so
-- the two groups can be compared on how many came back.
-- Like reminder_emails, a held account is not picked again for 14 days.
CREATE TABLE reminder_holds (
  user_id   TEXT PRIMARY KEY,
  lyric_id  TEXT NOT NULL,
  held_at   INTEGER NOT NULL
);
