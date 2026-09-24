// POST /api/auth/signup/confirm { token, password }
//
// The emailed link only opens a page; this is what turns a pending signup into
// an account. It needs the token (only the mailbox has it) and the password
// chosen at signup, so a mail scanner that fetches the link, or a victim who
// clicks a mail they never asked for, cannot complete an attacker's signup.

import { findUserByEmail, isTokenShaped, signedInResponse } from '../../../_accounts.js';
import { sendPasswordChangedEmail } from '../../../_email.js';
import { verifyPassword } from '../../../_password.js';
import {
  HOUR_MS, checkRateLimit, clientIpKey, rateLimitedResponse,
} from '../../../_ratelimit.js';
import { gatePasswordAuth, readJsonBody } from '../../../_request.js';
import { jsonError, sha256Hex, writeLog } from '../../../_shared.js';

const IP_LIMIT_PER_HOUR = 10;
const MAX_WRONG_PASSWORDS = 5;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_CREATED = 201;

function sql(env, text) {
  return env.lyricalmiracle_db.prepare(text);
}

function invalidToken() {
  return jsonError(HTTP_BAD_REQUEST, 'invalid_token',
    'That link has expired or was already used. Sign up again.');
}

function accountExists() {
  return jsonError(HTTP_CONFLICT, 'account_exists',
    'An account with that email already exists. Sign in, or reset your password.');
}

// One wrong password more. At the limit the row is deleted and the person signs
// up again. Guessing needs the token, which only the mailbox has, so this
// tells an outsider nothing.
async function recordWrongPassword(env, tokenHash) {
  const row = await sql(env, `
    UPDATE pending_signups SET failed_attempts = failed_attempts + 1
    WHERE token_hash = ? RETURNING failed_attempts
  `).bind(tokenHash).first();

  if (row && row.failed_attempts >= MAX_WRONG_PASSWORDS) {
    await sql(env, 'DELETE FROM pending_signups WHERE token_hash = ?').bind(tokenHash).run();
  }
  return jsonError(HTTP_BAD_REQUEST, 'wrong_password', "That isn't the password you signed up with.");
}

// Creates the account in one batch, and clears every pending row for the
// address. Throws when a user for that address appeared in the meantime.
async function createConfirmedUser(env, pending) {
  const userId = crypto.randomUUID();
  const now = Date.now();
  await env.lyricalmiracle_db.batch([
    sql(env, `
      INSERT INTO users (id, email, email_normalized, name, password_hash, password_updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(userId, pending.email, pending.email_normalized, pending.name, pending.password_hash,
      now, now),
    sql(env, 'DELETE FROM pending_signups WHERE email_normalized = ?').bind(pending.email_normalized),
  ]);
  return userId;
}

// A user for this address appeared while the signup waited (a Google sign-in,
// or another pending row confirmed first). One with no password takes this one,
// which is the same power a reset gives to whoever holds the mailbox. One that
// already has a password is left alone.
async function confirmIntoExistingUser(context, pending, tokenHash) {
  const { env, request } = context;
  const user = await findUserByEmail(env, pending.email_normalized);
  if (!user || user.password_hash) {
    await sql(env, 'DELETE FROM pending_signups WHERE token_hash = ?').bind(tokenHash).run();
    return accountExists();
  }

  const now = Date.now();
  const [update] = await env.lyricalmiracle_db.batch([
    sql(env, `
      UPDATE users SET password_hash = ?, password_updated_at = ?
      WHERE id = ? AND password_hash IS NULL
    `).bind(pending.password_hash, now, user.id),
    sql(env, 'DELETE FROM pending_signups WHERE token_hash = ?').bind(tokenHash),
  ]);
  if (update.meta.changes !== 1) return accountExists();

  context.waitUntil(sendPasswordChangedEmail(context, { to: user.email }));
  await writeLog(env, request, { userId: user.id, event: 'password_added' });
  return signedInResponse(env, request, user.id, HTTP_CREATED);
}

async function confirmNewUser(context, pending, tokenHash) {
  const { env, request } = context;
  const existing = await findUserByEmail(env, pending.email_normalized);
  if (existing) return confirmIntoExistingUser(context, pending, tokenHash);

  let userId;
  try {
    userId = await createConfirmedUser(env, pending);
  } catch (err) {
    // The unique address was taken between the check and the insert.
    if (!await findUserByEmail(env, pending.email_normalized)) throw err;
    return confirmIntoExistingUser(context, pending, tokenHash);
  }
  await writeLog(env, request, { userId, event: 'signup_password' });
  return signedInResponse(env, request, userId, HTTP_CREATED);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const body = await readJsonBody(request);
  if (!body || typeof body.password !== 'string' || !isTokenShaped(body.token)) {
    return invalidToken();
  }

  const ipLimit = await checkRateLimit(env, `confirm:ip:${clientIpKey(request)}`,
    IP_LIMIT_PER_HOUR, HOUR_MS);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

  const tokenHash = await sha256Hex(body.token);
  const pending = await sql(env,
    'SELECT * FROM pending_signups WHERE token_hash = ? AND expires_at > ?'
  ).bind(tokenHash, Date.now()).first();
  if (!pending) return invalidToken();

  if (!await verifyPassword(body.password, pending.password_hash, env)) {
    return recordWrongPassword(env, tokenHash);
  }
  return confirmNewUser(context, pending, tokenHash);
}
