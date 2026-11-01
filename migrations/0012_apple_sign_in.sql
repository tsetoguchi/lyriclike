-- Sign in with Apple in the iOS app.
--
-- apple_grants keeps the refresh token Apple hands back when a person signs in,
-- one per account. Apple requires the app to revoke it when the account is
-- deleted, and revoking needs the token.
--
-- apple_token_uses remembers each identity token it has accepted, by hash, until
-- the token expires, so one that leaks cannot be used to sign in a second time.
CREATE TABLE apple_grants (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  refresh_token  TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE TABLE apple_token_uses (
  token_hash  TEXT PRIMARY KEY,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX apple_token_uses_expires ON apple_token_uses(expires_at);
