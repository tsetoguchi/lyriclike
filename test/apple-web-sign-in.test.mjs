// Sign in with Apple on the website. Apple's keys and endpoints are stood in
// for with keys made here, so nothing needs a real Apple account.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as middleware from '../functions/api/_middleware.js';
import * as account from '../functions/api/account.js';
import * as callbackRoute from '../functions/api/auth/apple/callback.js';
import * as startRoute from '../functions/api/auth/apple/start.js';
import * as methods from '../functions/api/auth/methods.js';
import { forgetAppleKeys } from '../functions/_apple.js';
import { readAppleGrant } from '../functions/_apple-grants.js';
import { base64Url, sha256Hex } from '../functions/_shared.js';
import {
  BASE_URL, DEFAULT_IP, addSession, events, makeEnv, query, stubServices,
} from './support/auth-harness.mjs';

const APP_CLIENT_ID = 'com.lyriclike.app';
const WEB_CLIENT_ID = 'com.lyriclike.web';
const KID = 'apple-test-key';
const ISSUER = 'https://appleid.apple.com';
const START = '/api/auth/apple/start';
const CALLBACK = '/api/auth/apple/callback';
const RETURN_URL = BASE_URL + CALLBACK;
const STATE = 'state-from-the-start-route';
const RAW_NONCE = 'nonce-from-the-start-route-0123456789';
const SUBJECT = 'apple-subject-1';
const RELAY_EMAIL = 'abc123@privaterelay.appleid.com';
const TEN_MINUTES_S = 600;
const USER_FIELD = JSON.stringify({ name: { firstName: 'Ann', lastName: 'Lee' } });

let env;
let services;
let apple;
let rsaKeys;
let privateKeyPem;

function pemOf(pkcs8) {
  const text = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  return `-----BEGIN PRIVATE KEY-----\n${text}\n-----END PRIVATE KEY-----`;
}

function encodePart(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

// A good token for the website, with `changes` applied to its claims.
async function identityToken(changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER, aud: WEB_CLIENT_ID, iat: now, exp: now + TEN_MINUTES_S, sub: SUBJECT,
    nonce: await sha256Hex(RAW_NONCE), email: RELAY_EMAIL, email_verified: 'true',
    is_private_email: 'true', ...changes,
  };
  const input = `${encodePart({ alg: 'RS256', kid: KID })}.${encodePart(claims)}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', rsaKeys.privateKey, new TextEncoder().encode(input)));
  return `${input}.${base64Url(signature)}`;
}

function stubAppleEndpoints() {
  const previous = globalThis.fetch;
  apple = { calls: [], keys: [], idToken: null, refreshToken: 'web-refresh-token' };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (!target.startsWith(`${ISSUER}/`)) return previous(url, init);
    const form = init && init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
    apple.calls.push({ url: target, form });
    if (target.endsWith('/auth/keys')) return Response.json({ keys: apple.keys });
    if (target.endsWith('/auth/revoke')) return new Response(null, { status: 200 });
    if (!apple.idToken) return new Response('{"error":"invalid_grant"}', { status: 400 });
    return Response.json({ id_token: apple.idToken, refresh_token: apple.refreshToken });
  };
}

function appleCalls(suffix) {
  return apple.calls.filter(call => call.url.endsWith(suffix));
}

const GOOD_COOKIES = `apple_oauth_state=${STATE}; apple_oauth_nonce=${RAW_NONCE}`;

function callbackRequest(fields, cookie) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: ISSUER,
    'CF-Connecting-IP': DEFAULT_IP,
  };
  if (cookie) headers.Cookie = cookie;
  return new Request(RETURN_URL, { method: 'POST', headers, body: new URLSearchParams(fields) });
}

// Apple posting the person back, then whatever the route queued.
async function comeBack(fields = {}, cookie = GOOD_COOKIES) {
  const request = callbackRequest({ code: 'one-time-code', state: STATE, ...fields }, cookie);
  const pending = [];
  const response = await callbackRoute.onRequestPost({
    request, env, waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  return response;
}

function start() {
  return startRoute.onRequestGet({ request: new Request(BASE_URL + START), env });
}

async function userCount() {
  return (await query(env, 'SELECT count(*) AS n FROM users'))[0].n;
}

beforeEach(async () => {
  rsaKeys ??= await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  if (!privateKeyPem) {
    const ecKeys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    privateKeyPem = pemOf(await crypto.subtle.exportKey('pkcs8', ecKeys.privateKey));
  }
  env = makeEnv({
    APPLE_CLIENT_ID: APP_CLIENT_ID, APPLE_WEB_CLIENT_ID: WEB_CLIENT_ID,
    APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: privateKeyPem,
  });
  services = stubServices();
  stubAppleEndpoints();
  const jwk = await crypto.subtle.exportKey('jwk', rsaKeys.publicKey);
  apple.keys = [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }];
  apple.idToken = await identityToken();
  forgetAppleKeys();
});

afterEach(() => {
  services.restore();
});


describe('Apple on the website: starting', () => {
  it('sends the person to Apple as the website, asking for a form back', async () => {
    const response = await start();
    const target = new URL(response.headers.get('Location'));

    assert.equal(response.status, 302);
    assert.equal(target.origin + target.pathname, `${ISSUER}/auth/authorize`);
    assert.equal(target.searchParams.get('client_id'), WEB_CLIENT_ID);
    assert.equal(target.searchParams.get('redirect_uri'), RETURN_URL);
    assert.equal(target.searchParams.get('response_mode'), 'form_post');
    assert.equal(target.searchParams.get('scope'), 'name email');
  });

  it('keeps the state and the nonce in cookies that survive a cross-site post', async () => {
    const response = await start();
    const target = new URL(response.headers.get('Location'));
    const cookies = Object.fromEntries(response.headers.getSetCookie().map(line => {
      const [pair] = line.split(';');
      return [pair.split('=')[0], { value: pair.split('=')[1], line }];
    }));

    assert.equal(cookies.apple_oauth_state.value, target.searchParams.get('state'));
    assert.equal(await sha256Hex(cookies.apple_oauth_nonce.value), target.searchParams.get('nonce'));
    for (const { line } of Object.values(cookies)) {
      assert.match(line, /; HttpOnly; Secure; SameSite=None; /);
    }
  });

  it('answers 404 until the website has its own ID', async () => {
    env.APPLE_WEB_CLIENT_ID = undefined;
    assert.equal((await start()).status, 404);
    assert.equal((await comeBack()).status, 404);
  });
});


describe('Apple on the website: coming back', () => {
  it('makes the account, sets the session cookie and goes home', async () => {
    const response = await comeBack({ user: USER_FIELD });
    const cookies = response.headers.getSetCookie();
    const [user] = await query(env, 'SELECT email, name FROM users');

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), '/');
    assert.ok(cookies.some(line => /^sid=[0-9a-f]{64}; /.test(line)));
    assert.ok(cookies.some(line => line.startsWith('apple_oauth_state=; ')));
    assert.deepEqual({ ...user }, { email: RELAY_EMAIL, name: 'Ann Lee' });
  });

  it('trades the code as the website, with the same return address', async () => {
    await comeBack();
    const [call] = appleCalls('/auth/token');

    assert.equal(call.form.client_id, WEB_CLIENT_ID);
    assert.equal(call.form.code, 'one-time-code');
    assert.equal(call.form.redirect_uri, RETURN_URL);
    assert.equal(call.form.grant_type, 'authorization_code');
  });

  it('signs in the account the iPhone app made, with no second account', async () => {
    await comeBack();
    await comeBack({ user: undefined });
    assert.equal(await userCount(), 1);
  });

  it('goes home without signing in when the person cancels at Apple', async () => {
    const response = await comeBack({ error: 'user_cancelled_authorize', code: undefined });

    assert.equal(response.status, 303);
    assert.equal(response.headers.getSetCookie().some(line => line.startsWith('sid=')), false);
    assert.equal(await userCount(), 0);
  });
});


describe('Apple on the website: answers it turns away', () => {
  const refusals = [
    ['a state that is not this browser\'s', { state: 'someone-elses-state' }, GOOD_COOKIES],
    ['no cookies at all', {}, null],
    ['no code', { code: '' }, GOOD_COOKIES],
  ];
  for (const [situation, fields, cookie] of refusals) {
    it(situation, async () => {
      const response = await comeBack(fields, cookie);
      assert.equal(response.status, 400);
      assert.equal(appleCalls('/auth/token').length, 0);
      assert.equal(await userCount(), 0);
    });
  }

  it('a code Apple will not trade, and logs it', async () => {
    apple.idToken = null;
    const response = await comeBack();

    assert.equal(response.status, 502);
    assert.equal(await userCount(), 0);
    assert.ok((await events(env)).includes('apple_web_sign_in_rejected'));
  });

  it('a token made for the app, not the website', async () => {
    apple.idToken = await identityToken({ aud: APP_CLIENT_ID });
    assert.equal((await comeBack()).status, 502);
    assert.equal(await userCount(), 0);
  });

  it('a token made for a different nonce', async () => {
    apple.idToken = await identityToken({ nonce: await sha256Hex('another-nonce') });
    assert.equal((await comeBack()).status, 502);
  });

  it('a new sign-in with no address, since no account can be made', async () => {
    apple.idToken = await identityToken({ email: undefined });
    const response = await comeBack();

    assert.equal(response.status, 403);
    assert.match(await response.text(), /did not share an email address/);
  });
});


describe('Apple on the website: the grant', () => {
  async function deleteAccount() {
    const [{ id }] = await query(env, 'SELECT id FROM users');
    await addSession(env, id, 'tok');
    const pending = [];
    const request = new Request(`${BASE_URL}/api/account`, {
      method: 'DELETE', headers: { Cookie: 'sid=tok' },
    });
    const response = await account.onRequestDelete({
      request, env, waitUntil: promise => pending.push(promise),
    });
    await Promise.all(pending);
    return response;
  }

  it('is kept as the website\'s, so it can be told from the app\'s', async () => {
    await comeBack();
    const [{ user_id: userId, refresh_token: sealed }] = await query(env, 'SELECT * FROM apple_grants');

    assert.match(sealed, /^w1\./);
    assert.deepEqual(await readAppleGrant(env, userId), {
      refreshToken: 'web-refresh-token', clientId: WEB_CLIENT_ID,
    });
  });

  it('is revoked as the website when the account is deleted', async () => {
    await comeBack();
    const response = await deleteAccount();
    const [call] = appleCalls('/auth/revoke');

    assert.equal(response.status, 200);
    assert.equal(call.form.token, 'web-refresh-token');
    assert.equal(call.form.client_id, WEB_CLIENT_ID);
    assert.deepEqual(await query(env, 'SELECT * FROM apple_grants'), []);
  });
});


describe('Apple on the website: around the routes', () => {
  it('tells the sign-in modal when the website offers Apple', async () => {
    assert.equal((await methods.onRequestGet({ env }).json()).appleWeb, true);
    env.APPLE_WEB_CLIENT_ID = undefined;
    const body = await methods.onRequestGet({ env }).json();
    assert.deepEqual([body.apple, body.appleWeb], [true, false]);
  });

  it('lets Apple\'s cross-site form through to the callback only', async () => {
    const reached = [];
    const next = async () => { reached.push(true); return new Response(null, { status: 200 }); };
    const fields = { code: 'c', state: STATE };

    await middleware.onRequest({ request: callbackRequest(fields), next });
    assert.equal(reached.length, 1);

    const elsewhere = new Request(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ISSUER },
      body: new URLSearchParams(fields),
    });
    const refused = await middleware.onRequest({ request: elsewhere, next });
    assert.equal(refused.status, 403);
    assert.equal(reached.length, 1);
  });
});
