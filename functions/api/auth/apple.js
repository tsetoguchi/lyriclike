// POST /api/auth/apple { identityToken, authorizationCode?, nonce, givenName?, familyName? }
//
// Sign in with Apple, for the iOS app. The app gets an identity token from the
// system and posts it here with the nonce it made up. A good token signs the
// person in, as the Google sign-in does, and the app gets a session token back.
// Off, with a 404, until the Apple settings are in place.

import { signedInResponse } from '../../_accounts.js';
import {
  exchangeAuthorizationCode, isAppleConfigured, isTrue, sealRefreshToken, verifyIdentityToken,
} from '../../_apple.js';
import { resolveOauthUser } from '../../_oauth-accounts.js';
import { MINUTE_MS, checkRateLimit, clientIpKey, rateLimitedResponse } from '../../_ratelimit.js';
import { readJsonBody, runInBackground } from '../../_request.js';
import { jsonError, normalizeEmail, sha256Hex, writeLog } from '../../_shared.js';

const PROVIDER = 'apple';
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const SIGN_INS_PER_WINDOW = 20;
const SIGN_IN_WINDOW_MS = 15 * MINUTE_MS;
const MAX_TOKEN_LENGTH = 4096;
const MAX_CODE_LENGTH = 1024;
const MIN_NONCE_LENGTH = 16;
const MAX_NONCE_LENGTH = 200;
const MAX_NAME_LENGTH = 80;

function shortText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// The body, checked, or null for one that is not a sign-in.
function readSignIn(body) {
  const { identityToken, authorizationCode, nonce } = body;
  if (typeof identityToken !== 'string' || !identityToken || identityToken.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  if (typeof nonce !== 'string' || nonce.length < MIN_NONCE_LENGTH || nonce.length > MAX_NONCE_LENGTH) {
    return null;
  }
  const hasCode = typeof authorizationCode === 'string' && authorizationCode.length <= MAX_CODE_LENGTH;
  const name = [shortText(body.givenName, MAX_NAME_LENGTH), shortText(body.familyName, MAX_NAME_LENGTH)]
    .filter(Boolean).join(' ');
  return {
    identityToken, nonce, authorizationCode: hasCode ? authorizationCode : null, name: name || null,
  };
}

// Apple's relay addresses are private to this app and say nothing about the
// address on an account made another way, so they are not compared with it.
function profileFrom(claims, name) {
  const email = typeof claims.email === 'string' ? claims.email : null;
  const emailNormalized = email ? normalizeEmail(email) : null;
  return {
    email, name, emailNormalized,
    emailVerified: isTrue(claims.email_verified),
    canCompareEmail: Boolean(emailNormalized) && !isTrue(claims.is_private_email),
  };
}

// Remembers the token so it cannot be used a second time. False if it has been.
async function claimTokenUse(env, identityToken, expiresAtSeconds) {
  const result = await env.lyricalmiracle_db.prepare(
    'INSERT OR IGNORE INTO apple_token_uses (token_hash, expires_at) VALUES (?, ?)'
  ).bind(await sha256Hex(identityToken), expiresAtSeconds * 1000).run();
  return result.meta.changes === 1;
}

// Keeps the refresh token Apple gives for the code, so the grant can be revoked
// when the account is deleted. A failure leaves the sign-in standing.
async function storeGrant(env, request, userId, code) {
  const refreshToken = await exchangeAuthorizationCode(env, code);
  if (!refreshToken) {
    await writeLog(env, request, { userId, event: 'apple_code_exchange_failed' });
    return;
  }
  await env.lyricalmiracle_db.prepare(
    'INSERT OR REPLACE INTO apple_grants (user_id, refresh_token, created_at) VALUES (?, ?, ?)'
  ).bind(userId, await sealRefreshToken(env, refreshToken), Date.now()).run();
}

function refuseToken(env, request) {
  return writeLog(env, request, { userId: null, event: 'apple_token_rejected' }).then(() =>
    jsonError(HTTP_UNAUTHORIZED, 'invalid_token', 'Apple sign-in could not be verified. Try again.'));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAppleConfigured(env)) return new Response(null, { status: HTTP_NOT_FOUND });

  const body = await readJsonBody(request);
  const signIn = body && readSignIn(body);
  if (!signIn) return jsonError(HTTP_BAD_REQUEST, 'invalid_request', 'That sign-in was not valid.');

  const limit = await checkRateLimit(
    env, `apple:ip:${clientIpKey(request)}`, SIGN_INS_PER_WINDOW, SIGN_IN_WINDOW_MS);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  const { claims } = await verifyIdentityToken(env, signIn.identityToken, signIn.nonce);
  if (!claims || !await claimTokenUse(env, signIn.identityToken, claims.exp)) {
    return refuseToken(env, request);
  }

  const profile = profileFrom(claims, signIn.name);
  const userId = await resolveOauthUser(context, PROVIDER, profile, claims.sub);
  if (!userId) {
    return jsonError(HTTP_FORBIDDEN, 'no_email',
      'Apple did not share an email address, so an account could not be made. ' +
      'Sign in with another method, or allow sharing your email and try again.');
  }
  if (signIn.authorizationCode) {
    runInBackground(context, 'apple grant', () => storeGrant(env, request, userId, signIn.authorizationCode));
  }
  return signedInResponse(env, request, userId, 200);
}
