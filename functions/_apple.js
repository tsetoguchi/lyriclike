// Sign in with Apple, native flow. The iOS app asks the system for an identity
// token and posts it here. This checks the token is Apple's and was meant for
// this app, and talks to Apple's REST API to keep a refresh token (so the
// account's grant can be revoked when it is deleted).
//
// Settings: APPLE_CLIENT_ID (the app's bundle ID), APPLE_TEAM_ID, APPLE_KEY_ID,
// and APPLE_PRIVATE_KEY (the .p8 file's text). With any missing, it is off.

import { base64Url, fromBase64Url, sha256Hex } from './_shared.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;
const REQUEST_TIMEOUT_MS = 5000;
const KEYS_CACHE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
// An identity token is minted when the person approves the sheet, so a fresh
// sign-in is seconds old. Older than this is not one.
const MAX_TOKEN_AGE_SECONDS = 10 * 60;
// A client secret is made for each call, so it only has to outlive that call.
const CLIENT_SECRET_LIFETIME_SECONDS = 10 * 60;
const MAX_JWT_LENGTH = 4096;
const SIGNATURE_BYTES = 64;

export const REJECTION = Object.freeze({
  MALFORMED: 'malformed',
  ALGORITHM: 'algorithm',
  UNKNOWN_KEY: 'unknown_key',
  SIGNATURE: 'signature',
  ISSUER: 'issuer',
  AUDIENCE: 'audience',
  EXPIRED: 'expired',
  NOT_FRESH: 'not_fresh',
  NONCE: 'nonce',
  SUBJECT: 'subject',
});

export function isAppleConfigured(env) {
  return Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
}

// ── Reading a token ──

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
}

function parseJwt(token) {
  if (typeof token !== 'string' || token.length > MAX_JWT_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    return {
      header: decodeJson(parts[0]),
      claims: decodeJson(parts[1]),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: fromBase64Url(parts[2]),
    };
  } catch {
    return null;
  }
}

// ── Apple's signing keys ──

let cachedKeys = null;

export function forgetAppleKeys() {
  cachedKeys = null;
}

async function loadKeys() {
  const response = await fetch(KEYS_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Apple keys answered ${response.status}`);
  const { keys } = await response.json();
  cachedKeys = { keys, loadedAt: Date.now() };
  return keys;
}

// A key Apple has not published yet means the cache is old, so ask again once.
async function findKey(kid) {
  const isFresh = cachedKeys && Date.now() - cachedKeys.loadedAt < KEYS_CACHE_MS;
  const known = isFresh && cachedKeys.keys.find(key => key.kid === kid);
  if (known) return known;
  return (await loadKeys()).find(key => key.kid === kid) || null;
}

async function isSignatureValid(jwk, parsed) {
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, parsed.signature,
    new TextEncoder().encode(parsed.signingInput));
}

function checkClaims(claims, env, nowSeconds) {
  if (claims.iss !== APPLE_ISSUER) return REJECTION.ISSUER;
  if (claims.aud !== env.APPLE_CLIENT_ID) return REJECTION.AUDIENCE;
  if (!Number.isFinite(claims.exp) || claims.exp < nowSeconds - CLOCK_SKEW_SECONDS) {
    return REJECTION.EXPIRED;
  }
  const isTooNew = !Number.isFinite(claims.iat) || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS;
  const isTooOld = nowSeconds - claims.iat > MAX_TOKEN_AGE_SECONDS;
  if (isTooNew || isTooOld) return REJECTION.NOT_FRESH;
  if (typeof claims.sub !== 'string' || !claims.sub) return REJECTION.SUBJECT;
  return null;
}

// rawNonce is what the app made up. It asked Apple to put the sha256 of it in
// the token, so a token minted for another sign-in will not match.
// Returns { claims } for a good token, or { reason } (see REJECTION).
export async function verifyIdentityToken(env, token, rawNonce, nowMs = Date.now()) {
  const parsed = parseJwt(token);
  if (!parsed) return { reason: REJECTION.MALFORMED };
  if (parsed.header.alg !== 'RS256') return { reason: REJECTION.ALGORITHM };

  const jwk = await findKey(parsed.header.kid);
  if (!jwk) return { reason: REJECTION.UNKNOWN_KEY };
  if (!await isSignatureValid(jwk, parsed)) return { reason: REJECTION.SIGNATURE };

  const reason = checkClaims(parsed.claims, env, Math.floor(nowMs / 1000));
  if (reason) return { reason };
  const expectedNonce = typeof rawNonce === 'string' && rawNonce ? await sha256Hex(rawNonce) : null;
  if (!expectedNonce || parsed.claims.nonce !== expectedNonce) return { reason: REJECTION.NONCE };
  return { claims: parsed.claims };
}

// Apple writes these as a boolean or as the text "true".
export function isTrue(value) {
  return value === true || value === 'true';
}

// ── Calling Apple ──

function pemToDer(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}

function encodePart(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

// The proof that this server is the app's: a short ES256 token signed with the
// key from the developer account. WebCrypto returns the signature as the raw
// r and s a JWT wants, so it needs no conversion.
export async function makeClientSecret(env, nowMs = Date.now()) {
  const issuedAt = Math.floor(nowMs / 1000);
  const signingInput = `${encodePart({ alg: 'ES256', kid: env.APPLE_KEY_ID })}.${encodePart({
    iss: env.APPLE_TEAM_ID,
    iat: issuedAt,
    exp: issuedAt + CLIENT_SECRET_LIFETIME_SECONDS,
    aud: APPLE_ISSUER,
    sub: env.APPLE_CLIENT_ID,
  })}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(env.APPLE_PRIVATE_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)));
  if (signature.length !== SIGNATURE_BYTES) throw new Error('Unexpected signature length');
  return `${signingInput}.${base64Url(signature)}`;
}

async function postForm(url, env, fields) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.APPLE_CLIENT_ID,
      client_secret: await makeClientSecret(env),
      ...fields,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// Trades the one-time code from the sign-in for the refresh token that lets
// the grant be revoked later. Null when Apple refuses or does not answer.
export async function exchangeAuthorizationCode(env, code) {
  try {
    const response = await postForm(TOKEN_URL, env, { code, grant_type: 'authorization_code' });
    if (!response.ok) return null;
    const { refresh_token: refreshToken } = await response.json();
    return typeof refreshToken === 'string' && refreshToken ? refreshToken : null;
  } catch {
    return null;
  }
}

// True when Apple has revoked the grant, so the app no longer shows under the
// person's Apple ID settings.
export async function revokeRefreshToken(env, refreshToken) {
  try {
    const response = await postForm(REVOKE_URL, env, {
      token: refreshToken, token_type_hint: 'refresh_token',
    });
    return response.ok;
  } catch {
    return false;
  }
}
