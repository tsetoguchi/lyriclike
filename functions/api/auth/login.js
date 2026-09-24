// POST /api/auth/login { email, password, turnstile? }
//
// Every way of failing, an unknown email, a wrong password, an account with no
// password, or a signup that was never confirmed, is the same 401 after the
// same hashing work. Limits slow attempts down and never lock an account.

import { findUserByEmail, signedInResponse } from '../../_accounts.js';
import {
  DUMMY_HASH, hashPassword, needsRehash, verifyPassword,
} from '../../_password.js';
import {
  HOUR_MS, MINUTE_MS, addressKey, checkRateLimit, clientIpKey, hitRateLimit, peekRateLimit,
  rateLimitedResponse,
} from '../../_ratelimit.js';
import { gatePasswordAuth, readJsonBody } from '../../_request.js';
import { TURNSTILE_ACTION, verifyTurnstile } from '../../_turnstile.js';
import { jsonError, normalizeEmail, writeLog } from '../../_shared.js';

const IP_LIMIT = 10;
const IP_WINDOW_MS = 15 * MINUTE_MS;
const FAILURES_PER_EMAIL_AND_IP = 5;
const FAILURE_WINDOW_MS = 15 * MINUTE_MS;
const FAILURES_PER_EMAIL_ALL_IPS = 20;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_CAPTCHA_REQUIRED = 428;
const HTTP_OK = 200;

function readCredentials(body) {
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return null;
  return { email: body.email, password: body.password, turnstile: body.turnstile };
}

function invalidCredentials() {
  return jsonError(HTTP_UNAUTHORIZED, 'invalid_credentials', "That email and password don't match.");
}

// Verifies against the dummy hash when there is nothing real to check, so an
// unknown address costs the same as a wrong password.
async function passwordMatches(env, user, password) {
  const stored = user && user.password_hash ? user.password_hash : DUMMY_HASH;
  const matches = await verifyPassword(password, stored, env);
  return matches && stored !== DUMMY_HASH;
}

// Moves an account onto the live hash parameters after a successful login.
async function rehashIfStale(env, user, password) {
  if (!needsRehash(user.password_hash)) return;
  await env.lyricalmiracle_db.prepare(
    'UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?'
  ).bind(await hashPassword(password, env), Date.now(), user.id).run();
}

// Failures are counted twice: per email and IP (which only slows the person at
// that address), and per email across all IPs (which asks for Turnstile
// instead of refusing, so a stranger cannot shut a known user out).
export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const credentials = readCredentials(await readJsonBody(request));
  const emailNormalized = credentials && normalizeEmail(credentials.email);
  if (!emailNormalized) return jsonError(HTTP_BAD_REQUEST, 'invalid_request', 'Enter your email and password.');

  const ip = clientIpKey(request);
  const ipLimit = await checkRateLimit(env, `login:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

  const emailHash = await addressKey(emailNormalized);
  const accountKey = `login:acct:${emailHash}:${ip}`;
  const emailKey = `login:email:${emailHash}`;

  const perAccount = await peekRateLimit(env, accountKey, FAILURES_PER_EMAIL_AND_IP, FAILURE_WINDOW_MS);
  if (!perAccount.allowed) return rateLimitedResponse(perAccount.retryAfterSeconds);

  const perEmail = await peekRateLimit(env, emailKey, FAILURES_PER_EMAIL_ALL_IPS, HOUR_MS);
  if (!perEmail.allowed
      && !await verifyTurnstile(credentials.turnstile, request, env, TURNSTILE_ACTION.LOGIN)) {
    return jsonError(HTTP_CAPTCHA_REQUIRED, 'captcha_required', 'Complete the security check to sign in.');
  }

  const user = await findUserByEmail(env, emailNormalized);
  if (!await passwordMatches(env, user, credentials.password)) {
    await hitRateLimit(env, accountKey, FAILURE_WINDOW_MS);
    await hitRateLimit(env, emailKey, HOUR_MS);
    return invalidCredentials();
  }

  await rehashIfStale(env, user, credentials.password);
  await writeLog(env, request, { userId: user.id, event: 'login_password' });
  return signedInResponse(env, request, user.id, HTTP_OK);
}
