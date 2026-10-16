-- Sharing a page by email, and the save counter that keeps two people from
-- erasing each other's work. Nothing here touches existing rows, and the new
-- column has a default, so today's code keeps working on it.

-- One row per person a page is shared with. user_id stays NULL until someone
-- with that email has an account; it is filled at share time or at signup.
-- No invited_by column: only the owner can share, so the inviter is always
-- lyrics.user_id. One less foreign key to clean up when an account is deleted.
CREATE TABLE lyric_shares (
  lyric_id          TEXT NOT NULL REFERENCES lyrics(id),
  email_normalized  TEXT NOT NULL,
  email             TEXT NOT NULL,          -- as typed, for display
  user_id           TEXT REFERENCES users(id),
  had_account       INTEGER NOT NULL,       -- 1 if an account existed at share time
  emailed           INTEGER NOT NULL,       -- 1 if the invite mail was handed to Resend
  created_at        INTEGER NOT NULL,
  first_opened_at   INTEGER,                -- for growth numbers
  PRIMARY KEY (lyric_id, email_normalized)
);
CREATE INDEX lyric_shares_user  ON lyric_shares(user_id);
CREATE INDEX lyric_shares_email ON lyric_shares(email_normalized);

-- Addresses that clicked "stop emailing me". Never invited again.
-- Holds a sha256 of the address, not the address, like rate_limits keys do.
-- A yes/no lookup is all it is used for.
CREATE TABLE email_suppressions (
  address_hash TEXT PRIMARY KEY,        -- sha256 hex of email_normalized
  created_at   INTEGER NOT NULL
);

-- Goes up on every body save, for the "someone else saved first" check.
ALTER TABLE lyrics ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
