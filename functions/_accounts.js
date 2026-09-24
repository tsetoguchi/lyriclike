// Account lookups and the session hand-off shared by the password routes, the
// Google callback and /api/me.

import {
  SESSION_COOKIE_MAX_AGE, createSession, parseCookies, randomHex, sessionCookie, sha256Hex,
} from './_shared.js';

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_HEX_LENGTH = RESET_TOKEN_BYTES * 2;

// Emailed tokens are 32 random bytes as hex. Anything else cannot be one, so
// it is refused before the database is asked.
export function isTokenShaped(token) {
  return typeof token === 'string' && token.length === TOKEN_HEX_LENGTH && /^[0-9a-f]+$/.test(token);
}

export function findUserByEmail(env, emailNormalized) {
  return env.lyricalmiracle_db.prepare(
    'SELECT id, email, email_normalized, name, password_hash FROM users WHERE email_normalized = ?'
  ).bind(emailNormalized).first();
}

// What the client is told about an account. D1 returns 0/1 for the password
// flag, so it is converted here: a strict `=== false` on the client would
// never match otherwise.
export async function describeAccount(env, userId) {
  const row = await env.lyricalmiracle_db.prepare(`
    SELECT id, email, name, password_hash IS NOT NULL AS has_password,
      (SELECT group_concat(provider) FROM identities WHERE user_id = users.id) AS providers
    FROM users WHERE id = ?
  `).bind(userId).first();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    has_password: Boolean(row.has_password),
    providers: row.providers ? row.providers.split(',').sort() : [],
  };
}

// Signs the person in: a fresh session, its cookie, and the account in the
// body so the client needs no second /api/me call. A session the browser
// already held is dropped, so signing in as someone else never leaves the old
// one alive.
export async function signedInResponse(env, request, userId, status) {
  const previous = parseCookies(request).sid;
  if (previous) {
    await env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(await sha256Hex(previous)).run();
  }

  const token = await createSession(env, userId);
  const account = await describeAccount(env, userId);
  const headers = new Headers();
  headers.append('Set-Cookie',
    sessionCookie(token, new URL(request.url), { maxAge: SESSION_COOKIE_MAX_AGE }));
  return Response.json({ user: account }, { status, headers });
}

// Replaces any outstanding reset link for the account with a new one and
// returns the raw token to email. Only its hash is stored.
export async function issueResetToken(env, userId, emailNormalized) {
  const token = randomHex(RESET_TOKEN_BYTES);
  const now = Date.now();
  await env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').bind(userId),
    env.lyricalmiracle_db.prepare(`
      INSERT INTO reset_tokens (token_hash, user_id, email_normalized, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(await sha256Hex(token), userId, emailNormalized, now + RESET_TOKEN_LIFETIME_MS, now),
  ]);
  return token;
}
