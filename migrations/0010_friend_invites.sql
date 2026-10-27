-- Inviting a friend. Each account gets one invite code for its link. A new
-- account that arrives through a link gets a friend_invites row; rewarded_at
-- is set once that friend saves a page, and only then do both sides get extra
-- pages.
CREATE TABLE invite_codes (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  code        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE friend_invites (
  friend_id    TEXT PRIMARY KEY REFERENCES users(id),  -- one inviter per account
  inviter_id   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  rewarded_at  INTEGER
);
CREATE INDEX friend_invites_inviter ON friend_invites(inviter_id);
