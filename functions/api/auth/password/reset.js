// POST /api/auth/password/reset { token, password }
//
// The emailed link only shows a form; the token is used up here. Resetting an
// account that has only Google is allowed: it is how a Google user adds a
// password, and it already needs the mailbox.

import { isTokenShaped, rejectNewPassword, signedInResponse } from '../../../_accounts.js';
import { sendPasswordChangedEmail } from '../../../_email.js';
import { hashPassword } from '../../../_password.js';
import {
  HOUR_MS, checkRateLimit, clientIpKey, rateLimitedResponse,
} from '../../../_ratelimit.js';
import { gatePasswordAuth, readJsonBody } from '../../../_request.js';
import { jsonError, sha256Hex, writeLog } from '../../../_shared.js';

const IP_LIMIT_PER_HOUR = 10;
const HTTP_BAD_REQUEST = 400;
const HTTP_OK = 200;

function sql(env, text) {
  return env.lyricalmiracle_db.prepare(text);
}

function invalidToken() {
  return jsonError(HTTP_BAD_REQUEST, 'invalid_token',
    'That link has expired or was already used. Ask for a new one.');
}

// The row for a token that is live (not used, not expired) and still matches
// the account's address, with the account it belongs to.
function findLiveToken(env, tokenHash) {
  return sql(env, `
    SELECT reset_tokens.user_id, users.email, users.email_normalized
    FROM reset_tokens JOIN users ON users.id = reset_tokens.user_id
    WHERE reset_tokens.token_hash = ? AND reset_tokens.consumed_at IS NULL
      AND reset_tokens.expires_at > ?
      AND reset_tokens.email_normalized = users.email_normalized
  `).bind(tokenHash, Date.now()).first();
}

// One batch: the new hash lands only while the token is still unused, and
// everything after it lands only when that hash did, so two requests racing on
// one token cannot both win. The hash carries a fresh random salt, which makes
// it a marker of this request. Every session is deleted, so a stolen one does
// not outlive the change. Returns whether the password was set.
async function applyReset(env, row, tokenHash, passwordHash) {
  const now = Date.now();
  const applied = `EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`;
  const [update] = await env.lyricalmiracle_db.batch([
    sql(env, `
      UPDATE users SET password_hash = ?, password_updated_at = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM reset_tokens
        WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?)
    `).bind(passwordHash, now, row.user_id, tokenHash, now),
    sql(env, `UPDATE reset_tokens SET consumed_at = ? WHERE token_hash = ? AND ${applied}`)
      .bind(now, tokenHash, row.user_id, passwordHash),
    sql(env, `DELETE FROM reset_tokens WHERE user_id = ? AND token_hash != ? AND ${applied}`)
      .bind(row.user_id, tokenHash, row.user_id, passwordHash),
    sql(env, `DELETE FROM sessions WHERE user_id = ? AND ${applied}`)
      .bind(row.user_id, row.user_id, passwordHash),
  ]);
  return update.meta.changes === 1;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const body = await readJsonBody(request);
  if (!body || typeof body.password !== 'string' || !isTokenShaped(body.token)) {
    return invalidToken();
  }

  const ipLimit = await checkRateLimit(env, `reset:ip:${clientIpKey(request)}`,
    IP_LIMIT_PER_HOUR, HOUR_MS);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

  const tokenHash = await sha256Hex(body.token);
  const row = await findLiveToken(env, tokenHash);
  if (!row) return invalidToken();

  // A weak or breached password leaves the token usable for another try.
  const rejected = await rejectNewPassword(body.password, row.email);
  if (rejected) return rejected;

  const passwordHash = await hashPassword(body.password, env);
  if (!await applyReset(env, row, tokenHash, passwordHash)) return invalidToken();

  context.waitUntil(sendPasswordChangedEmail(context, { to: row.email }));
  await writeLog(env, request, { userId: row.user_id, event: 'password_reset' });
  return signedInResponse(env, request, row.user_id, HTTP_OK);
}
