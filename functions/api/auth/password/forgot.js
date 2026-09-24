// POST /api/auth/password/forgot { email, turnstile }
//
// Always the same 202 for an address that has an account and one that does not.
// Everything that differs (the token, the mail) happens after the response.

import { findUserByEmail, issueResetToken } from '../../../_accounts.js';
import { sendResetEmail } from '../../../_email.js';
import {
  HOUR_MS, addressKey, checkRateLimit, clientIpKey, rateLimitedResponse,
} from '../../../_ratelimit.js';
import { gatePasswordAuth, readJsonBody, runInBackground } from '../../../_request.js';
import { TURNSTILE_ACTION, verifyTurnstile } from '../../../_turnstile.js';
import { jsonError, normalizeEmail, writeLog } from '../../../_shared.js';

const IP_LIMIT_PER_HOUR = 10;
const EMAIL_LIMIT_PER_HOUR = 3;
const HTTP_BAD_REQUEST = 400;
const HTTP_ACCEPTED = 202;

const CHECK_YOUR_EMAIL = 'If that address has an account, we sent a link to reset the password.';

async function sendResetLink(context, user) {
  const token = await issueResetToken(context.env, user.id, user.email_normalized);
  await sendResetEmail(context, { to: user.email, token });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const body = await readJsonBody(request);
  if (!body || typeof body.email !== 'string') {
    return jsonError(HTTP_BAD_REQUEST, 'invalid_request', 'The request was not understood.');
  }

  const ipLimit = await checkRateLimit(env, `forgot:ip:${clientIpKey(request)}`,
    IP_LIMIT_PER_HOUR, HOUR_MS);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

  if (!await verifyTurnstile(body.turnstile, request, env, TURNSTILE_ACTION.FORGOT)) {
    return jsonError(HTTP_BAD_REQUEST, 'captcha_failed', 'The security check failed. Try again.');
  }

  const emailNormalized = normalizeEmail(body.email);
  if (!emailNormalized) {
    return jsonError(HTTP_BAD_REQUEST, 'invalid_email', 'Enter a valid email address.');
  }

  const emailLimit = await checkRateLimit(env,
    `forgot:email:${await addressKey(emailNormalized)}`, EMAIL_LIMIT_PER_HOUR, HOUR_MS);
  if (!emailLimit.allowed) return rateLimitedResponse(emailLimit.retryAfterSeconds);

  const user = await findUserByEmail(env, emailNormalized);
  // Logged for a known and an unknown address alike, so it takes the same time.
  await writeLog(env, request, { userId: user ? user.id : null, event: 'forgot_requested' });
  if (user) runInBackground(context, 'forgot', () => sendResetLink(context, user));
  return Response.json({ message: CHECK_YOUR_EMAIL }, { status: HTTP_ACCEPTED });
}
