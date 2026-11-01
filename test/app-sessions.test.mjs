// The mobile apps sign in with a Bearer token instead of the cookie, from the
// origins Capacitor serves the bundled pages on. The cookie path has to stay
// exactly as strict as it was.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';
import * as login from '../functions/api/auth/login.js';
import * as logout from '../functions/api/auth/logout.js';
import { getSession, sessionTokenFrom, sha256Hex } from '../functions/_shared.js';
import {
  GOOD_PASSWORD, addPasswordUser, makeEnv, post, query, stubServices,
} from './support/auth-harness.mjs';

const BASE_URL = 'https://lyriclike.com';
const IOS_ORIGIN = 'capacitor://localhost';
const ANDROID_ORIGIN = 'https://localhost';
const OTHER_ORIGIN = 'https://evil.example';
const APP_HEADERS = { 'X-LyricLike-Client': 'app' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const HOUR_MS = 60 * 60 * 1000;
const NO_CONTENT = 204;
const FORBIDDEN = 403;
const OK = 200;

let env;
let services;

beforeEach(() => {
  env = makeEnv();
  services = stubServices();
});

afterEach(() => {
  services.restore();
});

async function addSession(userId) {
  const token = crypto.randomUUID();
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(await sha256Hex(token), userId, Date.now() + HOUR_MS, Date.now()).run();
  return token;
}

function request(headers, { method = 'GET', path = '/api/x' } = {}) {
  const body = method === 'GET' || method === 'OPTIONS' ? undefined : '{}';
  return new Request(BASE_URL + path, { method, headers, body });
}

function runMiddleware(req) {
  const next = async () => new Response('ok', { status: OK });
  return apiMiddleware({ request: req, next });
}

async function sessionRows(token) {
  return query(env, 'SELECT id FROM sessions WHERE id = ?', await sha256Hex(token));
}

describe('sessionTokenFrom', () => {
  it('reads the Bearer header', () => {
    assert.equal(sessionTokenFrom(request({ Authorization: 'Bearer abc' })), 'abc');
  });

  it('falls back to the sid cookie', () => {
    assert.equal(sessionTokenFrom(request({ Cookie: 'sid=cookie-token' })), 'cookie-token');
  });

  it('prefers the Bearer header over the cookie', () => {
    const headers = { Authorization: 'Bearer abc', Cookie: 'sid=cookie-token' };
    assert.equal(sessionTokenFrom(request(headers)), 'abc');
  });

  it('returns null for an empty Bearer header or no credentials', () => {
    assert.equal(sessionTokenFrom(request({ Authorization: 'Bearer ' })), null);
    assert.equal(sessionTokenFrom(request({})), null);
  });
});

describe('getSession with a Bearer token', () => {
  it('finds the signed-in user', async () => {
    const userId = await addPasswordUser(env);
    const token = await addSession(userId);
    const session = await getSession(request({ Authorization: `Bearer ${token}` }), env);
    assert.equal(session.user.id, userId);
  });

  it('does not fall back to a valid cookie when the Bearer token is wrong', async () => {
    const userId = await addPasswordUser(env);
    const token = await addSession(userId);
    const headers = { Authorization: 'Bearer wrong', Cookie: `sid=${token}` };
    assert.equal(await getSession(request(headers), env), null);
  });
});

describe('middleware: app origins', () => {
  for (const origin of [IOS_ORIGIN, ANDROID_ORIGIN]) {
    it(`answers a preflight from ${origin}`, async () => {
      const response = await runMiddleware(request({ Origin: origin }, { method: 'OPTIONS' }));
      assert.equal(response.status, NO_CONTENT);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
      assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/);
    });

    it(`lets a Bearer POST from ${origin} through, with CORS headers`, async () => {
      const headers = { Origin: origin, Authorization: 'Bearer abc', ...JSON_HEADERS };
      const response = await runMiddleware(request(headers, { method: 'POST' }));
      assert.equal(response.status, OK);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
      assert.match(response.headers.get('Vary'), /Origin/);
      assert.match(response.headers.get('Vary'), /Cookie/);
    });
  }

  it('lets the app sign in before it has a token', async () => {
    const headers = { Origin: IOS_ORIGIN, ...APP_HEADERS, ...JSON_HEADERS };
    const response = await runMiddleware(request(headers, { method: 'POST' }));
    assert.equal(response.status, OK);
  });

  it('refuses a preflight from any other origin', async () => {
    const response = await runMiddleware(request({ Origin: OTHER_ORIGIN }, { method: 'OPTIONS' }));
    assert.equal(response.status, FORBIDDEN);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('still refuses a cross-site cookie POST', async () => {
    const headers = { Origin: OTHER_ORIGIN, Cookie: 'sid=abc', ...JSON_HEADERS };
    const response = await runMiddleware(request(headers, { method: 'POST' }));
    assert.equal(response.status, FORBIDDEN);
  });

  it('does not take the marker header from a stranger origin', async () => {
    const headers = { Origin: OTHER_ORIGIN, ...APP_HEADERS, ...JSON_HEADERS };
    const response = await runMiddleware(request(headers, { method: 'POST' }));
    assert.equal(response.status, FORBIDDEN);
  });

  it('adds no CORS headers for the website itself', async () => {
    const headers = { Origin: BASE_URL, Cookie: 'sid=abc', ...JSON_HEADERS };
    const response = await runMiddleware(request(headers, { method: 'POST' }));
    assert.equal(response.status, OK);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });
});

describe('app sign-in and sign-out', () => {
  it('login returns the token in the body and sets no cookie', async () => {
    await addPasswordUser(env);
    const response = await post(login, env, '/api/auth/login', {
      email: 'ann@example.com', password: GOOD_PASSWORD,
    }, { headers: APP_HEADERS });
    const body = await response.json();

    assert.equal(response.status, OK);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.match(body.token, /^[0-9a-f]{64}$/);
    assert.equal((await sessionRows(body.token)).length, 1);
  });

  it('login from the website still sets the cookie and returns no token', async () => {
    await addPasswordUser(env);
    const response = await post(login, env, '/api/auth/login', {
      email: 'ann@example.com', password: GOOD_PASSWORD,
    });
    assert.match(response.headers.get('Set-Cookie'), /^sid=/);
    assert.equal((await response.json()).token, undefined);
  });

  it('signing in again drops the Bearer session the app held', async () => {
    const userId = await addPasswordUser(env);
    const oldToken = await addSession(userId);
    await post(login, env, '/api/auth/login', {
      email: 'ann@example.com', password: GOOD_PASSWORD,
    }, { headers: { ...APP_HEADERS, Authorization: `Bearer ${oldToken}` } });
    assert.equal((await sessionRows(oldToken)).length, 0);
  });

  it('logout by Bearer deletes the session', async () => {
    const userId = await addPasswordUser(env);
    const token = await addSession(userId);
    await post(logout, env, '/api/auth/logout', '', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal((await sessionRows(token)).length, 0);
  });
});
