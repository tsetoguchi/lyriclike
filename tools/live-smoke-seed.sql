-- Local-only data for tools/live-smoke.mjs. Never run against a remote database.
-- The session ids are the sha256 of smoke-token-ann and smoke-token-bo.
DELETE FROM lyric_shares WHERE lyric_id = 'smoke-page';
DELETE FROM lyrics WHERE id = 'smoke-page';
DELETE FROM sessions WHERE user_id IN ('smoke-ann', 'smoke-bo');
DELETE FROM users WHERE id IN ('smoke-ann', 'smoke-bo');
INSERT INTO users (id, email, email_normalized, name, created_at) VALUES
  ('smoke-ann', 'ann@smoke.test', 'ann@smoke.test', 'Ann', 1),
  ('smoke-bo', 'bo@smoke.test', 'bo@smoke.test', 'Bö 鈴木', 1);
INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES
  ('8a221d215e806dc9d59cc0a0b64362bfc9a1fd5eb69663e305f22932b47cabf8', 'smoke-ann', 9999999999999, 1),
  ('3d39a3850ff61d313995414fdaad6356b597d3e4902d7475fe79aaebb2efea9c', 'smoke-bo', 9999999999999, 1);
INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) VALUES
  ('smoke-page', 'smoke-ann', 'Smoke', 'hello', 0, 1, 1);
INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) VALUES
  ('smoke-page', 'bo@smoke.test', 'bo@smoke.test', 'smoke-bo', 1, 0, 1);
