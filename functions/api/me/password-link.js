// POST /api/me/password-link
//
// Emails the signed-in account a link to set a password. It is how an account
// that only has Google adds one from the Account panel. It uses the reset link
// on purpose: setting a password still needs the mailbox, not just a session.

import { issueResetToken } from '../../_accounts.js';
import { sendResetEmail } from '../../_email.js';
import { HOUR_MS, checkRateLimit, rateLimitedResponse } from '../../_ratelimit.js';
import { gatePasswordAuth, runInBackground } from '../../_request.js';
import { requireUser } from '../../_shared.js';

const LINKS_PER_HOUR = 3;
const HTTP_ACCEPTED = 202;

export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const limit = await checkRateLimit(env, `password-link:${user.id}`, LINKS_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  runInBackground(context, 'password-link', async () => {
    const row = await env.lyricalmiracle_db.prepare(
      'SELECT email, email_normalized FROM users WHERE id = ?'
    ).bind(user.id).first();
    if (!row) return;
    const token = await issueResetToken(env, user.id, row.email_normalized);
    await sendResetEmail(context, { to: row.email, token });
  });
  return Response.json({ message: `We sent a link to ${user.email}.` }, { status: HTTP_ACCEPTED });
}
