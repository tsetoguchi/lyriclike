// POST /api/auth/lookup { email, turnstile? }
//
// The first step of the sign-in modal: says what comes after the email.
// { next: 'password' } for an account with a password, 'google' for one that
// only signs in with Google, and 'sign-up' for an address with no account (a
// signup that was never confirmed counts as none).
//
// This tells anyone whether an address has an account, as Google's and
// ChatGPT's sign-in pages do. The limits keep that to a trickle: a few
// lookups per IP go through freely, then each one needs Turnstile, and past a
// hard cap the IP waits.

import { findUserByEmail } from '../../_accounts.js';
import {
  HOUR_MS, MINUTE_MS, checkRateLimit, clientIpKey, rateLimitedResponse,
} from '../../_ratelimit.js';
import { gatePasswordAuth, readJsonBody } from '../../_request.js';
import { TURNSTILE_ACTION, verifyTurnstile } from '../../_turnstile.js';
import { jsonError, normalizeEmail } from '../../_shared.js';

const FREE_LOOKUPS = 20;
const FREE_WINDOW_MS = 15 * MINUTE_MS;
const MAX_LOOKUPS_PER_HOUR = 100;
const HTTP_BAD_REQUEST = 400;
const HTTP_CAPTCHA_REQUIRED = 428;

export const NEXT_STEP = Object.freeze({
  PASSWORD: 'password',
  GOOGLE: 'google',
  SIGN_UP: 'sign-up',
});

async function nextStepFor(env, emailNormalized) {
  const user = await findUserByEmail(env, emailNormalized);
  if (!user) return NEXT_STEP.SIGN_UP;
  if (user.password_hash) return NEXT_STEP.PASSWORD;
  return NEXT_STEP.GOOGLE;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const body = await readJsonBody(request);
  const emailNormalized = body && typeof body.email === 'string' && normalizeEmail(body.email);
  if (!emailNormalized) return jsonError(HTTP_BAD_REQUEST, 'invalid_email', 'Enter a valid email address.');

  const ip = clientIpKey(request);
  const hardCap = await checkRateLimit(env, `lookup:hour:${ip}`, MAX_LOOKUPS_PER_HOUR, HOUR_MS);
  if (!hardCap.allowed) return rateLimitedResponse(hardCap.retryAfterSeconds);

  const free = await checkRateLimit(env, `lookup:ip:${ip}`, FREE_LOOKUPS, FREE_WINDOW_MS);
  if (!free.allowed
      && !await verifyTurnstile(body.turnstile, request, env, TURNSTILE_ACTION.LOOKUP)) {
    return jsonError(HTTP_CAPTCHA_REQUIRED, 'captcha_required', 'Complete the security check to continue.');
  }

  return Response.json({ next: await nextStepFor(env, emailNormalized) });
}
