// Sign in with Apple. The iOS app asks the system for an identity token and
// posts it here; the website sends the person to Apple, who posts a one-time
// code back. This checks a token is Apple's and was meant for the client that
// asked, and talks to Apple's REST API to keep a refresh token (so the
// account's grant can be revoked when it is deleted).
//
// Settings: APPLE_CLIENT_ID (the app's bundle ID), APPLE_TEAM_ID, APPLE_KEY_ID,
// and APPLE_PRIVATE_KEY (the .p8 file's text). With any missing, it is off.
// APPLE_WEB_CLIENT_ID (the website's Services ID) turns it on for the website.

import {
  base64Url, fromBase64Url, normalizeEmail, sha256Bytes, sha256Hex,
} from './_shared.js';

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
// The prefix of a sealed refresh token says which client Apple gave it to,
// since only that client can revoke it.
const SEALED_FOR_APP = 'v1';
const SEALED_FOR_WEB = 'w1';
const SEAL_IV_BYTES = 12;

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

export function isAppleWebConfigured(env) {
  return isAppleConfigured(env) && Boolean(env.APPLE_WEB_CLIENT_ID);
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

function checkClaims(claims, clientId, nowSeconds) {
  if (claims.iss !== APPLE_ISSUER) return REJECTION.ISSUER;
  if (claims.aud !== clientId) return REJECTION.AUDIENCE;
  if (!Number.isFinite(claims.exp) || claims.exp < nowSeconds - CLOCK_SKEW_SECONDS) {
    return REJECTION.EXPIRED;
  }
  const isTooNew = !Number.isFinite(claims.iat) || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS;
  const isTooOld = nowSeconds - claims.iat > MAX_TOKEN_AGE_SECONDS;
  if (isTooNew || isTooOld) return REJECTION.NOT_FRESH;
  if (typeof claims.sub !== 'string' || !claims.sub) return REJECTION.SUBJECT;
  return null;
}

// rawNonce is what the client made up. It asked Apple to put the sha256 of it
// in the token, so a token minted for another sign-in will not match.
// clientId is who the token must have been made for: the app unless given.
// Returns { claims } for a good token, or { reason } (see REJECTION).
export async function verifyIdentityToken(
  env, token, rawNonce, nowMs = Date.now(), clientId = env.APPLE_CLIENT_ID,
) {
  const parsed = parseJwt(token);
  if (!parsed) return { reason: REJECTION.MALFORMED };
  if (parsed.header.alg !== 'RS256') return { reason: REJECTION.ALGORITHM };

  const jwk = await findKey(parsed.header.kid);
  if (!jwk) return { reason: REJECTION.UNKNOWN_KEY };
  if (!await isSignatureValid(jwk, parsed)) return { reason: REJECTION.SIGNATURE };

  const reason = checkClaims(parsed.claims, clientId, Math.floor(nowMs / 1000));
  if (reason) return { reason };
  const expectedNonce = typeof rawNonce === 'string' && rawNonce ? await sha256Hex(rawNonce) : null;
  if (!expectedNonce || parsed.claims.nonce !== expectedNonce) return { reason: REJECTION.NONCE };
  return { claims: parsed.claims };
}

// Apple writes these as a boolean or as the text "true".
export function isTrue(value) {
  return value === true || value === 'true';
}

// Apple's relay addresses are private to this app and say nothing about the
// address on an account made another way, so they are not compared with it.
export function appleProfile(claims, name) {
  const email = typeof claims.email === 'string' ? claims.email : null;
  const emailNormalized = email ? normalizeEmail(email) : null;
  return {
    email, name, emailNormalized,
    emailVerified: isTrue(claims.email_verified),
    canCompareEmail: Boolean(emailNormalized) && !isTrue(claims.is_private_email),
  };
}

// ── Calling Apple ──

// The key comes from the .p8 text, a secret the server already holds, so a copy
// of the database alone cannot revoke anyone's grant.
async function sealingKey(env) {
  const raw = await sha256Bytes(env.APPLE_PRIVATE_KEY);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function sealedPrefixFor(env, clientId) {
  return clientId === env.APPLE_WEB_CLIENT_ID ? SEALED_FOR_WEB : SEALED_FOR_APP;
}

function clientIdForPrefix(env, prefix) {
  if (prefix === SEALED_FOR_APP) return env.APPLE_CLIENT_ID || null;
  if (prefix === SEALED_FOR_WEB) return env.APPLE_WEB_CLIENT_ID || null;
  return null;
}

// "<prefix>.<iv>.<ciphertext>", safe to put in the database.
export async function sealRefreshToken(env, refreshToken, clientId = env.APPLE_CLIENT_ID) {
  const iv = crypto.getRandomValues(new Uint8Array(SEAL_IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await sealingKey(env), new TextEncoder().encode(refreshToken));
  const prefix = sealedPrefixFor(env, clientId);
  return [prefix, base64Url(iv), base64Url(new Uint8Array(cipher))].join('.');
}

// { refreshToken, clientId } back, or null when the value is not one this
// server sealed.
export async function openGrant(env, sealed) {
  const [prefix, iv, cipher, ...extra] = String(sealed).split('.');
  const clientId = clientIdForPrefix(env, prefix);
  if (!clientId || !iv || !cipher || extra.length) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv) }, await sealingKey(env), fromBase64Url(cipher));
    return { refreshToken: new TextDecoder().decode(plain), clientId };
  } catch {
    return null;
  }
}

// The token alone, or null.
export async function openRefreshToken(env, sealed) {
  const grant = await openGrant(env, sealed);
  return grant ? grant.refreshToken : null;
}

function pemToDer(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}

function encodePart(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

// The proof that this server is the client's: a short ES256 token signed with
// the key from the developer account. WebCrypto returns the signature as the
// raw r and s a JWT wants, so it needs no conversion.
export async function makeClientSecret(
  env, nowMs = Date.now(), clientId = env.APPLE_CLIENT_ID,
) {
  const issuedAt = Math.floor(nowMs / 1000);
  const signingInput = `${encodePart({ alg: 'ES256', kid: env.APPLE_KEY_ID })}.${encodePart({
    iss: env.APPLE_TEAM_ID,
    iat: issuedAt,
    exp: issuedAt + CLIENT_SECRET_LIFETIME_SECONDS,
    aud: APPLE_ISSUER,
    sub: clientId,
  })}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(env.APPLE_PRIVATE_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)));
  if (signature.length !== SIGNATURE_BYTES) throw new Error('Unexpected signature length');
  return `${signingInput}.${base64Url(signature)}`;
}

async function postForm(url, env, fields, clientId = env.APPLE_CLIENT_ID) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: await makeClientSecret(env, Date.now(), clientId),
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

// The website's trade: the one-time code Apple posted back, for the identity
// token that says who signed in and the refresh token. redirectUri must be the
// one the sign-in started with. Null when Apple refuses or does not answer.
export async function exchangeWebCode(env, code, redirectUri) {
  try {
    const response = await postForm(TOKEN_URL, env, {
      code, grant_type: 'authorization_code', redirect_uri: redirectUri,
    }, env.APPLE_WEB_CLIENT_ID);
    if (!response.ok) return null;
    const { id_token: idToken, refresh_token: refreshToken } = await response.json();
    if (typeof idToken !== 'string' || !idToken) return null;
    return { idToken, refreshToken: typeof refreshToken === 'string' ? refreshToken : null };
  } catch {
    return null;
  }
}

// True when Apple has revoked the grant, so the app no longer shows under the
// person's Apple ID settings. clientId is the client the token was given to.
export async function revokeRefreshToken(env, refreshToken, clientId = env.APPLE_CLIENT_ID) {
  try {
    const response = await postForm(REVOKE_URL, env, {
      token: refreshToken, token_type_hint: 'refresh_token',
    }, clientId);
    return response.ok;
  } catch {
    return false;
  }
}
