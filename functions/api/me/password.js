// POST /api/me/password { current_password, password }
//
// Changes the password of the signed-in account. The current password is
// asked for again, so a session left open on a shared computer cannot take the
// account over. Every other session is signed out; this one stays.

import {
  checkCurrentPassword, describeAccount, rejectNewPassword,
} from '../../_accounts.js';
import { sendPasswordChangedEmail } from '../../_email.js';
import { hashPassword } from '../../_password.js';
import { gatePasswordAuth, readJsonBody } from '../../_request.js';
import {
  jsonError, parseCookies, requireUser, sha256Hex, writeLog,
} from '../../_shared.js';

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

function sql(env, text) {
  return env.lyricalmiracle_db.prepare(text);
}

// One batch. The new hash lands only over the hash that was just checked, so a
// change made elsewhere in between wins and this one reports a conflict. The
// rest lands only when the new hash did (its random salt makes it unique to
// this request). Outstanding reset links go too: they were issued for the old
// password. Returns whether the password was changed.
async function applyChange(env, userId, oldHash, newHash, keepSessionId) {
  const applied = 'EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)';
  const [update] = await env.lyricalmiracle_db.batch([
    sql(env, `
      UPDATE users SET password_hash = ?, password_updated_at = ?
      WHERE id = ? AND password_hash = ?
    `).bind(newHash, Date.now(), userId, oldHash),
    sql(env, `DELETE FROM sessions WHERE user_id = ? AND id != ? AND ${applied}`)
      .bind(userId, keepSessionId, userId, newHash),
    sql(env, `DELETE FROM reset_tokens WHERE user_id = ? AND ${applied}`)
      .bind(userId, userId, newHash),
  ]);
  return update.meta.changes === 1;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const body = await readJsonBody(request);
  if (!body || typeof body.current_password !== 'string' || typeof body.password !== 'string') {
    return jsonError(HTTP_BAD_REQUEST, 'invalid_request', 'Enter your current and new password.');
  }

  const current = await checkCurrentPassword(env, user.id, body.current_password);
  if (current.response) return current.response;

  const rejected = await rejectNewPassword(body.password, user.email);
  if (rejected) return rejected;

  const newHash = await hashPassword(body.password, env);
  const sessionId = await sha256Hex(parseCookies(request).sid);
  if (!await applyChange(env, user.id, current.passwordHash, newHash, sessionId)) {
    return jsonError(HTTP_CONFLICT, 'password_changed_elsewhere',
      'Your password was just changed somewhere else. Try again.');
  }

  context.waitUntil(sendPasswordChangedEmail(context, { to: user.email }));
  await writeLog(env, request, { userId: user.id, event: 'password_changed' });
  return Response.json({ user: await describeAccount(env, user.id) });
}
