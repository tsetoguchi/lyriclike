// Sign in with Apple, server side. Apple's keys and endpoints are stood in for
// with keys made here, so nothing needs a real Apple account.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as account from '../functions/api/account.js';
import * as appleRoute from '../functions/api/auth/apple.js';
import * as methods from '../functions/api/auth/methods.js';
import { forgetAppleKeys, makeClientSecret } from '../functions/_apple.js';
import { base64Url, fromBase64Url, sha256Hex } from '../functions/_shared.js';
import {
  BASE_URL, addPasswordUser, addSession, events, makeEnv, post, query,
  stubServices,
} from './support/auth-harness.mjs';

const CLIENT_ID = 'com.lyriclike.app';
const TEAM_ID = 'TEAM123456';
const KEY_ID = 'KEY1234567';
const KID = 'apple-test-key';
const ISSUER = 'https://appleid.apple.com';
const RAW_NONCE = 'a-random-nonce-from-the-app-0123456789';
const SUBJECT = 'apple-subject-1';
const RELAY_EMAIL = 'abc123@privaterelay.appleid.com';
const APP_HEADERS = { Origin: 'capacitor://localhost', 'X-LyricLike-Client': 'app' };
const SIGN_IN = '/api/auth/apple';
const TEN_MINUTES_S = 600;
const SIX_MONTHS_S = 180 * 24 * 60 * 60;
const HEX_64 = /^[0-9a-f]{64}$/;

let env;
let services;
let apple;
let rsaKeys;
let otherRsaKeys;
let ecKeys;
let privateKeyPem;

function pemOf(pkcs8) {
  const text = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  return `-----BEGIN PRIVATE KEY-----\n${text.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
}

function makeRsaKeys() {
  return crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }, true, ['sign', 'verify']);
}

function encodePart(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signJwt(header, claims, privateKey) {
  const input = `${encodePart(header)}.${encodePart(claims)}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(input)));
  return `${input}.${base64Url(signature)}`;
}

// A good token, with `changes` applied to its claims (null removes one).
async function identityToken(changes = {}, { key = rsaKeys.privateKey, header = {}, nonce = RAW_NONCE } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + TEN_MINUTES_S, sub: SUBJECT,
    nonce: await sha256Hex(nonce), email: RELAY_EMAIL, email_verified: 'true',
    is_private_email: 'true', ...changes,
  };
  for (const [name, value] of Object.entries(claims)) if (value === null) delete claims[name];
  return signJwt({ alg: 'RS256', kid: KID, ...header }, claims, key);
}

function stubAppleEndpoints() {
  const previous = globalThis.fetch;
  apple = {
    calls: [],
    keys: [],
    tokenAnswer: () => Response.json({ refresh_token: 'refresh-token-1', access_token: 'a' }),
    revokeAnswer: () => new Response(null, { status: 200 }),
  };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (!target.startsWith(`${ISSUER}/`)) return previous(url, init);
    const form = init && init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
    apple.calls.push({ url: target, form });
    if (target.endsWith('/auth/keys')) return Response.json({ keys: apple.keys });
    if (target.endsWith('/auth/token')) return apple.tokenAnswer();
    return apple.revokeAnswer();
  };
}

function appleCalls(suffix) {
  return apple.calls.filter(call => call.url.endsWith(suffix));
}

function signInWith(token, extra = {}, headers = APP_HEADERS) {
  return post(appleRoute, env, SIGN_IN, {
    identityToken: token, nonce: RAW_NONCE, authorizationCode: 'one-time-code', ...extra,
  }, { headers });
}

async function userCount() {
  return (await query(env, 'SELECT count(*) AS n FROM users'))[0].n;
}

beforeEach(async () => {
  rsaKeys ??= await makeRsaKeys();
  otherRsaKeys ??= await makeRsaKeys();
  ecKeys ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  privateKeyPem ??= pemOf(await crypto.subtle.exportKey('pkcs8', ecKeys.privateKey));
  env = makeEnv({
    APPLE_CLIENT_ID: CLIENT_ID, APPLE_TEAM_ID: TEAM_ID, APPLE_KEY_ID: KEY_ID,
    APPLE_PRIVATE_KEY: privateKeyPem,
  });
  services = stubServices();
  stubAppleEndpoints();
  apple.keys = [{ ...(await crypto.subtle.exportKey('jwk', rsaKeys.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }];
  forgetAppleKeys();
});

afterEach(() => {
  services.restore();
});


describe('Sign in with Apple: a new account', () => {
  it('makes the account and answers with a session token for the app', async () => {
    const response = await signInWith(await identityToken(), { givenName: 'Ann', familyName: 'Lee' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.match(body.token, HEX_64);
    assert.equal(body.user.email, RELAY_EMAIL);
    assert.equal(body.user.name, 'Ann Lee');
    assert.deepEqual(body.user.providers, ['apple']);
    assert.deepEqual(await events(env), ['signup']);
    const [identity] = await query(env, 'SELECT provider, provider_subject FROM identities');
    assert.deepEqual({ ...identity }, { provider: 'apple', provider_subject: SUBJECT });
  });

  it('gives a browser a cookie instead of a token', async () => {
    const response = await signInWith(await identityToken(), {}, {});
    assert.match(response.headers.get('Set-Cookie'), /^sid=/);
    assert.equal((await response.json()).token, undefined);
  });

  it('keeps the refresh token Apple gives for the code, signed as the app', async () => {
    await signInWith(await identityToken());
    const [row] = await query(env, 'SELECT user_id, refresh_token FROM apple_grants');
    assert.equal(row.refresh_token, 'refresh-token-1');

    const [call] = appleCalls('/auth/token');
    assert.equal(call.form.grant_type, 'authorization_code');
    assert.equal(call.form.code, 'one-time-code');
    assert.equal(call.form.client_id, CLIENT_ID);
    assert.match(call.form.client_secret, /^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('works without a code, and then there is nothing to revoke later', async () => {
    const response = await signInWith(await identityToken(), { authorizationCode: undefined });
    assert.equal(response.status, 200);
    assert.equal(appleCalls('/auth/token').length, 0);
    assert.deepEqual(await query(env, 'SELECT * FROM apple_grants'), []);
  });

  it('still signs in when Apple will not give a refresh token, and logs it', async () => {
    apple.tokenAnswer = () => new Response('{"error":"invalid_grant"}', { status: 400 });
    const response = await signInWith(await identityToken());
    assert.equal(response.status, 200);
    assert.deepEqual(await query(env, 'SELECT * FROM apple_grants'), []);
    assert.ok((await events(env)).includes('apple_code_exchange_failed'));
  });

  it('takes the verified address as the text "true" or as a boolean', async () => {
    const response = await signInWith(await identityToken({
      email: 'ann@example.com', email_verified: true, is_private_email: false,
    }));
    assert.equal((await response.json()).user.email, 'ann@example.com');
  });

  it('claims pages already shared with the address', async () => {
    await env.lyricalmiracle_db.prepare(
      "INSERT INTO users (id, email, email_normalized, name, created_at) VALUES ('owner', 'o@example.com', 'o@example.com', 'O', 1)").run();
    await env.lyricalmiracle_db.prepare(
      "INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES ('p1', 'owner', 'T', 'b', 1, 1)").run();
    await env.lyricalmiracle_db.prepare(
      "INSERT INTO lyric_shares (lyric_id, email_normalized, email, had_account, emailed, created_at) VALUES ('p1', 'ann@example.com', 'ann@example.com', 0, 0, 1)").run();
    await signInWith(await identityToken({
      email: 'ann@example.com', email_verified: 'true', is_private_email: 'false',
    }));
    const [share] = await query(env, 'SELECT user_id FROM lyric_shares');
    assert.ok(share.user_id);
  });
});

describe('Sign in with Apple: an account that exists', () => {
  it('signs a returning person in, with no second account and no address complaint', async () => {
    await signInWith(await identityToken());
    const response = await signInWith(await identityToken({ email: 'other@privaterelay.appleid.com' }));
    assert.equal(response.status, 200);
    assert.equal(await userCount(), 1);
    assert.deepEqual(await events(env), ['signup', 'login']);
  });

  it('signs a returning person in when Apple sends no address this time', async () => {
    await signInWith(await identityToken());
    const response = await signInWith(await identityToken({ email: null, email_verified: null, is_private_email: null }));
    assert.equal(response.status, 200);
    assert.deepEqual(await events(env), ['signup', 'login']);
  });

  it('adds Apple to an account that has the same verified address, and tells a password owner', async () => {
    await addPasswordUser(env);
    const response = await signInWith(await identityToken({
      email: 'ann@example.com', is_private_email: 'false',
    }));
    assert.equal(response.status, 200);
    assert.equal(await userCount(), 1);
    assert.deepEqual(await events(env), ['oauth_linked']);
    const [mail] = services.mail;
    assert.equal(mail.subject, 'Apple sign-in was added to your LyricLike account');
    assert.ok(mail.to.includes('ann@example.com'));
  });

  it('does not treat a relay address as an existing account', async () => {
    await addPasswordUser(env);
    await signInWith(await identityToken());
    assert.equal(await userCount(), 2);
  });

  it('refuses a new sign-in with no address, since no account can be made', async () => {
    const response = await signInWith(await identityToken({ email: null, email_verified: null }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'no_email');
    assert.equal(await userCount(), 0);
  });

  it('refuses a new sign-in whose address Apple did not verify', async () => {
    const response = await signInWith(await identityToken({ email_verified: 'false' }));
    assert.equal(response.status, 403);
    assert.equal(await userCount(), 0);
  });
});

describe('Sign in with Apple: tokens it turns away', () => {
  async function assertRefused(token, extra) {
    const response = await signInWith(token, extra);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_token');
    assert.equal(await userCount(), 0);
  }

  it('one meant for another app', async () => {
    await assertRefused(await identityToken({ aud: 'com.someone.else' }));
  });

  it('one from another issuer', async () => {
    await assertRefused(await identityToken({ iss: 'https://evil.example' }));
  });

  it('one that has expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await assertRefused(await identityToken({ iat: past - 60, exp: past }));
  });

  it('one that was made long ago, though it has not expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await assertRefused(await identityToken({ iat: past }));
  });

  it('one made for a different nonce', async () => {
    await assertRefused(await identityToken({}, { nonce: 'a-different-nonce-entirely-0123456789' }));
  });

  it('one with no nonce in it', async () => {
    await assertRefused(await identityToken({ nonce: null }));
  });

  it('one signed with a key Apple has not published', async () => {
    await assertRefused(await identityToken({}, { key: otherRsaKeys.privateKey }));
  });

  it('one that names a key Apple does not have', async () => {
    await assertRefused(await identityToken({}, { header: { kid: 'not-a-key' } }));
  });

  it('one that is not signed with RS256', async () => {
    await assertRefused(await identityToken({}, { header: { alg: 'none' } }));
  });

  it('one that is not a token at all', async () => {
    await assertRefused('not.a.token');
  });

  it('one with no subject', async () => {
    await assertRefused(await identityToken({ sub: null }));
  });

  it('one it has already accepted', async () => {
    const token = await identityToken();
    assert.equal((await signInWith(token)).status, 200);
    const replay = await signInWith(token);
    assert.equal(replay.status, 401);
    assert.equal(await userCount(), 1);
  });

  it('and logs the refusal without a user', async () => {
    await signInWith(await identityToken({ aud: 'com.someone.else' }));
    assert.deepEqual(await events(env), ['apple_token_rejected']);
  });

  it('asks Apple for its keys once, not on every sign-in', async () => {
    await signInWith(await identityToken({ sub: 'a' }));
    await signInWith(await identityToken({ sub: 'b', email: 'b@privaterelay.appleid.com' }));
    assert.equal(appleCalls('/auth/keys').length, 1);
  });
});

describe('Sign in with Apple: the request', () => {
  it('answers 404 until it is set up', async () => {
    env = makeEnv();
    const response = await signInWith(await identityToken());
    assert.equal(response.status, 404);
  });

  it('refuses a body that is not a sign-in', async () => {
    for (const body of [{}, { identityToken: 5, nonce: RAW_NONCE }, { identityToken: 'x', nonce: 'short' }]) {
      const response = await post(appleRoute, env, SIGN_IN, body, { headers: APP_HEADERS });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  it('slows an address that keeps sending bad tokens', async () => {
    for (let i = 0; i < 20; i++) await signInWith('not.a.token');
    assert.equal((await signInWith('not.a.token')).status, 429);
  });
});

describe('the client secret', () => {
  it('is an ES256 token for this app that Apple can check with the key', async () => {
    const secret = await makeClientSecret(env);
    const [header, claims, signature] = secret.split('.');
    const parse = part => JSON.parse(new TextDecoder().decode(fromBase64Url(part)));

    assert.deepEqual(parse(header), { alg: 'ES256', kid: KEY_ID });
    const decoded = parse(claims);
    assert.equal(decoded.iss, TEAM_ID);
    assert.equal(decoded.sub, CLIENT_ID);
    assert.equal(decoded.aud, ISSUER);
    assert.ok(decoded.exp > decoded.iat && decoded.exp - decoded.iat <= SIX_MONTHS_S);
    const isValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ecKeys.publicKey,
      fromBase64Url(signature), new TextEncoder().encode(`${header}.${claims}`));
    assert.equal(isValid, true);
  });

  it('reads a key stored with escaped newlines, as a dashboard may keep it', async () => {
    env.APPLE_PRIVATE_KEY = privateKeyPem.replaceAll('\n', '\\n');
    assert.match(await makeClientSecret(env), /^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

describe('what the sign-in modal is told', () => {
  it('answers apple: true when set up, and false when any setting is missing', async () => {
    assert.equal((await methods.onRequestGet({ env }).json()).apple, true);
    for (const name of ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY']) {
      const partial = { ...env, [name]: undefined };
      assert.equal((await methods.onRequestGet({ env: partial }).json()).apple, false, name);
    }
  });
});

describe('deleting an account that signed in with Apple', () => {
  async function signedUpWithApple() {
    await signInWith(await identityToken());
    const [{ id }] = await query(env, 'SELECT id FROM users');
    await addSession(env, id, 'tok');
    return id;
  }

  async function deleteAccount() {
    const pending = [];
    const request = new Request(`${BASE_URL}/api/account`, { method: 'DELETE', headers: { Cookie: 'sid=tok' } });
    const response = await account.onRequestDelete({ request, env, waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    return response;
  }

  it('revokes the grant at Apple, and removes every row', async () => {
    await signedUpWithApple();
    const response = await deleteAccount();

    assert.equal(response.status, 200);
    const [call] = appleCalls('/auth/revoke');
    assert.equal(call.form.token, 'refresh-token-1');
    assert.equal(call.form.token_type_hint, 'refresh_token');
    assert.equal(call.form.client_id, CLIENT_ID);
    assert.deepEqual(await query(env, 'SELECT * FROM apple_grants'), []);
    assert.deepEqual(await query(env, 'SELECT * FROM users'), []);
  });

  it('deletes the account even when Apple will not revoke, and logs it', async () => {
    await signedUpWithApple();
    apple.revokeAnswer = () => new Response('{"error":"invalid_client"}', { status: 400 });
    const response = await deleteAccount();

    assert.equal(response.status, 200);
    assert.deepEqual(await query(env, 'SELECT * FROM users'), []);
    assert.ok((await events(env)).includes('apple_revoke_failed'));
  });

  it('has nothing to revoke when the sign-in never gave a refresh token', async () => {
    await signInWith(await identityToken(), { authorizationCode: undefined });
    const [{ id }] = await query(env, 'SELECT id FROM users');
    await addSession(env, id, 'tok');
    assert.equal((await deleteAccount()).status, 200);
    assert.equal(appleCalls('/auth/revoke').length, 0);
  });

  it('does not ask Apple for anything when it is not set up', async () => {
    await signedUpWithApple();
    const configured = env;
    env = { ...configured, APPLE_PRIVATE_KEY: undefined };
    assert.equal((await deleteAccount()).status, 200);
    assert.equal(appleCalls('/auth/revoke').length, 0);
  });
});
