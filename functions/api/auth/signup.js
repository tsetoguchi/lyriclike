// POST /api/auth/signup { email, password, name?, turnstile }
//
// A signup is pending until its email is confirmed: nothing here creates a
// users row. A new address and an address that already has an account get the
// same 202, after the same hashing work, so the answer says nothing about who
// has an account. What differs (a pending row, or the "you already have an
// account" mail) happens after the response.

import { findUserByEmail } from '../../_accounts.js';
import { sendConfirmSignupEmail, sendExistingAccountEmail } from '../../_email.js';
import {
  PASSWORD_PROBLEM, PASSWORD_PROBLEM_MESSAGE, checkPasswordPolicy, hashPassword,
  isBreachedPassword,
} from '../../_password.js';
import {
  HOUR_MS, addressKey, checkRateLimit, clientIpKey, rateLimitedResponse,
} from '../../_ratelimit.js';
import { gatePasswordAuth, readJsonBody, runInBackground } from '../../_request.js';
import { TURNSTILE_ACTION, verifyTurnstile } from '../../_turnstile.js';
import {
  jsonError, normalizeEmail, randomHex, sha256Hex, writeLog,
} from '../../_shared.js';

const IP_LIMIT_PER_HOUR = 5;
const EMAIL_LIMIT_PER_HOUR = 3;
const EXISTING_MAIL_LIMIT_PER_HOUR = 1;
const PENDING_LIFETIME_MS = 24 * HOUR_MS;
const CONFIRM_TOKEN_BYTES = 32;
const MAX_NAME_LENGTH = 100;
const HTTP_BAD_REQUEST = 400;
const HTTP_ACCEPTED = 202;

const CHECK_YOUR_EMAIL = 'Check your email to finish signing up.';

// Returns { email, password, name, turnstile }, or null for a body that is not
// shaped like a signup.
function readSignup(body) {
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return null;
  if (body.name !== undefined && body.name !== null && typeof body.name !== 'string') return null;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if ([...name].length > MAX_NAME_LENGTH) return null;
  return {
    email: body.email,
    password: body.password,
    name: name || null,
    turnstile: body.turnstile,
  };
}

function badRequest(code, message) {
  return jsonError(HTTP_BAD_REQUEST, code, message);
}

// These answer honestly: they say nothing about anyone else's account.
async function checkPassword(password, email) {
  const problem = checkPasswordPolicy(password, email)
    || (await isBreachedPassword(password) ? PASSWORD_PROBLEM.BREACHED : null);
  return problem ? badRequest(problem, PASSWORD_PROBLEM_MESSAGE[problem]) : null;
}

async function startPendingSignup(context, signup, emailNormalized, passwordHash) {
  const { env, request } = context;
  const token = randomHex(CONFIRM_TOKEN_BYTES);
  const now = Date.now();
  await env.lyricalmiracle_db.prepare(`
    INSERT INTO pending_signups
      (token_hash, email, email_normalized, name, password_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(await sha256Hex(token), signup.email.trim(), emailNormalized, signup.name,
    passwordHash, now + PENDING_LIFETIME_MS, now).run();

  await writeLog(env, request, { event: 'signup_started' });
  await sendConfirmSignupEmail(context, { to: signup.email.trim(), token });
}

async function tellExistingAccount(context, signup, emailNormalized) {
  const { env, request } = context;
  const allowed = await checkRateLimit(env,
    `signup-existing:${await addressKey(emailNormalized)}`, EXISTING_MAIL_LIMIT_PER_HOUR, HOUR_MS);

  await writeLog(env, request, { event: 'signup_existing' });
  if (allowed.allowed) await sendExistingAccountEmail(context, { to: signup.email.trim() });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const off = gatePasswordAuth(env);
  if (off) return off;

  const signup = readSignup(await readJsonBody(request));
  if (!signup) return badRequest('invalid_request', 'The request was not understood.');

  const ipLimit = await checkRateLimit(env, `signup:ip:${clientIpKey(request)}`,
    IP_LIMIT_PER_HOUR, HOUR_MS);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

  if (!await verifyTurnstile(signup.turnstile, request, env, TURNSTILE_ACTION.SIGNUP)) {
    return badRequest('captcha_failed', 'The security check failed. Try again.');
  }

  const emailNormalized = normalizeEmail(signup.email);
  if (!emailNormalized) return badRequest('invalid_email', 'Enter a valid email address.');

  const emailLimit = await checkRateLimit(env,
    `signup:email:${await addressKey(emailNormalized)}`, EMAIL_LIMIT_PER_HOUR, HOUR_MS);
  if (!emailLimit.allowed) return rateLimitedResponse(emailLimit.retryAfterSeconds);

  const rejected = await checkPassword(signup.password, emailNormalized);
  if (rejected) return rejected;

  // Hashed whether or not the address is taken, so both cost the same time.
  const passwordHash = await hashPassword(signup.password, env);
  const existing = await findUserByEmail(env, emailNormalized);

  runInBackground(context, 'signup', () => existing
    ? tellExistingAccount(context, signup, emailNormalized)
    : startPendingSignup(context, signup, emailNormalized, passwordHash));
  return Response.json({ message: CHECK_YOUR_EMAIL }, { status: HTTP_ACCEPTED });
}
