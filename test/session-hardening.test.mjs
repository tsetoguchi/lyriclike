// How sessions are stored and sent, how forged requests are turned away, and
// how the Google sign-in resists a stolen code.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';
import * as callback from '../functions/api/auth/google/callback.js';
import * as start from '../functions/api/auth/google/start.js';
import * as logout from '../functions/api/auth/logout.js';
import * as me from '../functions/api/me.js';
import {
  base64Url, createSession, sessionCookie, sha256Bytes, sha256Hex, truncateIp, writeLog,
} from '../functions/_shared.js';
import { createFakeD1 } from './support/fake-d1.mjs';

const BASE_URL = 'https://lyriclike.com';
const LOCAL_URL = 'http://localhost:8788';
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;
const SLACK_SECONDS = 60;

let env;
let userId;

function database() {
  return env.lyricalmiracle_db;
}

async function addUser() {
  const id = crypto.randomUUID();
  await database().prepare(
    'INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, `sub-${id}`, 'writer@example.com', 'writer', Date.now()).run();
  return id;
}

async function addSessionRow(token, { expiresAt, createdAt = Date.now() }) {
  await database().prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(await sha256Hex(token), userId, expiresAt, createdAt).run();
}

function readSessionRow(token) {
  return sha256Hex(token).then(id =>
    database().prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first());
}

async function callMe(token, { base = BASE_URL } = {}) {
  const request = new Request(base + '/api/me', { headers: { Cookie: `sid=${token}` } });
  const pending = [];
  const response = await me.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return response;
}

function maxAgeOf(response) {
  return Number(/Max-Age=(\d+)/.exec(response.headers.get('Set-Cookie'))[1]);
}

beforeEach(async () => {
  env = {
    lyricalmiracle_db: createFakeD1(),
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    OAUTH_REDIRECT_URL: BASE_URL + '/api/auth/google/callback',
  };
  userId = await addUser();
});

describe('session storage', () => {
  it('keeps only a hash of the cookie value', async () => {
    const token = await createSession(env, userId);
    const { results } = await database().prepare('SELECT id FROM sessions').all();

    assert.equal(results.length, 1);
    assert.notEqual(results[0].id, token);
    assert.equal(results[0].id, await sha256Hex(token));
    assert.equal((await callMe(token)).status, 200);
  });

  it('does not accept a stored hash as a cookie', async () => {
    const token = await createSession(env, userId);
    const stolenHash = await sha256Hex(token);
    assert.equal((await callMe(stolenHash)).status, 401);
  });

  it('issues a different token every time', async () => {
    const first = await createSession(env, userId);
    const second = await createSession(env, userId);
    assert.notEqual(first, second);
    assert.match(first, /^[0-9a-f]{64}$/);
  });
});

describe('sliding expiry', () => {
  it('extends a session with under five days left and renews the cookie', async () => {
    await addSessionRow('nearly-over', { expiresAt: Date.now() + 2 * DAY_MS });
    const response = await callMe('nearly-over');

    assert.equal(response.status, 200);
    const row = await readSessionRow('nearly-over');
    assert.ok(row.expires_at > Date.now() + 29 * DAY_MS);
    assert.ok(Math.abs(maxAgeOf(response) - 30 * DAY_SECONDS) < SLACK_SECONDS);
    assert.match(response.headers.get('Set-Cookie'), /^sid=nearly-over;/);
  });

  it('leaves a session with plenty of time alone and sends no cookie', async () => {
    const expiresAt = Date.now() + 20 * DAY_MS;
    await addSessionRow('plenty', { expiresAt });
    const response = await callMe('plenty');

    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal((await readSessionRow('plenty')).expires_at, expiresAt);
  });

  it('never runs past 90 days after the session was created', async () => {
    const createdAt = Date.now() - 88 * DAY_MS;
    await addSessionRow('old', { expiresAt: Date.now() + 1 * DAY_MS, createdAt });
    const response = await callMe('old');

    const row = await readSessionRow('old');
    assert.equal(row.expires_at, createdAt + 90 * DAY_MS);
    assert.ok(Math.abs(maxAgeOf(response) - 2 * DAY_SECONDS) < SLACK_SECONDS);
  });

  it('does not extend a session that is already at its 90-day end', async () => {
    const createdAt = Date.now() - 89 * DAY_MS;
    const expiresAt = createdAt + 90 * DAY_MS;
    await addSessionRow('at-cap', { expiresAt, createdAt });
    const response = await callMe('at-cap');

    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal((await readSessionRow('at-cap')).expires_at, expiresAt);
  });
});

describe('session cookies', () => {
  it('are Secure on the real site and not on localhost', () => {
    const secure = sessionCookie('abc', new URL(BASE_URL), { maxAge: 10 });
    const local = sessionCookie('abc', new URL(LOCAL_URL), { maxAge: 10 });

    assert.equal(secure, 'sid=abc; HttpOnly; Secure; SameSite=Lax; Max-Age=10; Path=/');
    assert.equal(local, 'sid=abc; HttpOnly; SameSite=Lax; Max-Age=10; Path=/');
  });

  it('are cleared on localhost by sign-out and account deletion', async () => {
    const token = await createSession(env, userId);
    const headers = { Cookie: `sid=${token}`, Origin: LOCAL_URL };

    const signOut = await logout.onRequestPost({
      request: new Request(LOCAL_URL + '/api/auth/logout', { method: 'POST', headers }), env,
    });
    assert.equal(signOut.headers.get('Set-Cookie'),
      'sid=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/');

    const second = await createSession(env, userId);
    const deleted = await me.onRequestDelete({
      request: new Request(LOCAL_URL + '/api/me', {
        method: 'DELETE', headers: { Cookie: `sid=${second}` },
      }), env,
    });
    assert.equal(deleted.headers.get('Set-Cookie'),
      'sid=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/');
  });

  it('are removed from the table on sign-out', async () => {
    const token = await createSession(env, userId);
    await logout.onRequestPost({
      request: new Request(BASE_URL + '/api/auth/logout', {
        method: 'POST', headers: { Cookie: `sid=${token}` },
      }), env,
    });
    assert.equal(await readSessionRow(token), null);
  });
});

describe('logged IP addresses', () => {
  const cases = [
    ['203.0.113.77', '203.0.113.0'],
    ['2001:db8:abcd:1234:5678::1', '2001:db8:abcd::'],
    ['2001:DB8::1', '2001:db8:0::'],
    ['::1', '0:0:0::'],
    ['::ffff:203.0.113.77', '203.0.113.0'],
    ['not an address', null],
    ['999.1.1.1', null],
    ['', null],
    [null, null],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} is kept as ${JSON.stringify(expected)}`, () => {
      assert.equal(truncateIp(input), expected);
    });
  }

  it('is truncated in the logs table', async () => {
    const request = new Request(BASE_URL + '/x', { headers: { 'CF-Connecting-IP': '198.51.100.9' } });
    await writeLog(env, request, { userId, event: 'login' });
    const row = await database().prepare('SELECT ip FROM logs').first();
    assert.equal(row.ip, '198.51.100.0');
  });
});

describe('forged requests', () => {
  const next = async () => Response.json({ ok: true });

  function through(path, { method = 'POST', headers = {}, body } = {}) {
    const request = new Request(BASE_URL + path, { method, headers, body });
    return apiMiddleware({ request, next });
  }

  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  it('are refused when the Origin is another site', async () => {
    const response = await through('/api/lyrics/x', {
      method: 'PUT', headers: { ...JSON_HEADERS, Origin: 'https://evil.example' }, body: '{}',
    });
    assert.equal(response.status, 403);
  });

  it('are refused when there is no Origin and no Sec-Fetch-Site', async () => {
    const response = await through('/api/auth/logout');
    assert.equal(response.status, 403);
  });

  it('are refused when Sec-Fetch-Site says cross-site', async () => {
    const response = await through('/api/auth/logout', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(response.status, 403);
  });

  it('let same-origin writes through, judged by Origin', async () => {
    const response = await through('/api/lyrics/x', {
      method: 'PUT', headers: { ...JSON_HEADERS, Origin: BASE_URL }, body: '{}',
    });
    assert.equal(response.status, 200);
  });

  it('fall back to Sec-Fetch-Site when there is no Origin', async () => {
    const response = await through('/api/auth/logout', {
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    assert.equal(response.status, 200);
  });

  it('are refused when the body is a form', async () => {
    const response = await through('/api/lyrics/x', {
      method: 'PUT', body: 'title=x&body=y',
      headers: { Origin: BASE_URL, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(response.status, 415);
  });

  it('are refused when a body has no Content-Type', async () => {
    const response = await through('/api/lyrics/x', {
      method: 'PUT', headers: { Origin: BASE_URL }, body: new Blob(['{}']),
    });
    assert.equal(response.status, 415);
  });

  it('accept JSON with a charset', async () => {
    const response = await through('/api/lyrics/x', {
      method: 'PUT', body: '{}',
      headers: { Origin: BASE_URL, 'Content-Type': 'Application/JSON; charset=utf-8' },
    });
    assert.equal(response.status, 200);
  });

  it('leave a body-less DELETE from the same origin alone', async () => {
    const response = await through('/api/lyrics/x', {
      method: 'DELETE', headers: { Origin: BASE_URL },
    });
    assert.equal(response.status, 200);
  });

  it('do not apply to reads', async () => {
    const response = await through('/api/me', {
      method: 'GET', headers: { Origin: 'https://evil.example' },
    });
    assert.equal(response.status, 200);
  });

  it('still get the no-store headers on a refusal', async () => {
    const response = await through('/api/auth/logout');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  });
});

describe('API answers', () => {
  const request = new Request(BASE_URL + '/api/me');

  it('carry nosniff, including a route that sets its own caching', async () => {
    const cached = new Response('{}', { headers: { 'Cache-Control': 'public, max-age=60' } });
    const response = await apiMiddleware({ request, next: async () => cached });
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
  });

  it('turn a thrown error into an empty 500', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const response = await apiMiddleware({
        request,
        next: async () => { throw new Error('SQLITE_ERROR: no such table: secrets'); },
      });
      assert.equal(response.status, 500);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    } finally {
      console.error = original;
    }
  });
});

function cookiePairs(response) {
  const pairs = {};
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split('; ');
    const [name, ...value] = pair.split('=');
    pairs[name] = { value: value.join('='), attributes };
  }
  return pairs;
}

describe('Google sign-in start', () => {
  it('sends a PKCE challenge for the verifier it keeps in a cookie', async () => {
    const response = await start.onRequestGet({
      request: new Request(BASE_URL + '/api/auth/google/start'), env,
    });
    const location = new URL(response.headers.get('Location'));
    const cookies = cookiePairs(response);

    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    const verifier = cookies.oauth_verifier.value;
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(location.searchParams.get('code_challenge'),
      base64Url(await sha256Bytes(verifier)));
    assert.equal(location.searchParams.get('state'), cookies.oauth_state.value);
  });

  it('keeps both cookies HttpOnly, Lax and Secure', async () => {
    const response = await start.onRequestGet({
      request: new Request(BASE_URL + '/api/auth/google/start'), env,
    });
    for (const { attributes } of Object.values(cookiePairs(response))) {
      assert.ok(attributes.includes('HttpOnly'));
      assert.ok(attributes.includes('Secure'));
      assert.ok(attributes.includes('SameSite=Lax'));
    }
  });

  it('does not put Secure on localhost', async () => {
    const response = await start.onRequestGet({
      request: new Request(LOCAL_URL + '/api/auth/google/start'), env,
    });
    for (const { attributes } of Object.values(cookiePairs(response))) {
      assert.ok(!attributes.includes('Secure'));
    }
  });
});

describe('Google sign-in callback', () => {
  const originalFetch = globalThis.fetch;
  let tokenRequestBody;

  beforeEach(() => {
    tokenRequestBody = null;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        tokenRequestBody = new URLSearchParams(init.body);
        return Response.json({ access_token: 'access' });
      }
      return Response.json({ sub: 'google-sub', email: 'g@example.com', name: 'G' });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function callCallback(cookie, state = 'the-state') {
    const request = new Request(`${BASE_URL}/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { Cookie: cookie },
    });
    return callback.onRequestGet({ request, env });
  }

  it('sends the verifier at the token exchange', async () => {
    await callCallback('oauth_state=the-state; oauth_verifier=the-verifier');
    assert.equal(tokenRequestBody.get('code_verifier'), 'the-verifier');
  });

  it('refuses a callback that has no verifier cookie', async () => {
    const response = await callCallback('oauth_state=the-state');
    assert.equal(response.status, 400);
    assert.equal(tokenRequestBody, null);
  });

  it('refuses a state that does not match', async () => {
    const response = await callCallback('oauth_state=other; oauth_verifier=v');
    assert.equal(response.status, 400);
  });

  it('starts a session whose cookie is not what the table stores', async () => {
    const response = await callCallback('oauth_state=the-state; oauth_verifier=the-verifier');
    const cookies = cookiePairs(response);

    assert.equal(response.status, 302);
    const token = cookies.sid.value;
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal((await callMe(token)).status, 200);
    assert.equal(await database().prepare('SELECT id FROM sessions WHERE id = ?')
      .bind(token).first(), null);
    assert.ok(cookies.sid.attributes.includes('Max-Age=' + 30 * DAY_SECONDS));
  });

  it('clears both OAuth cookies', async () => {
    const response = await callCallback('oauth_state=the-state; oauth_verifier=the-verifier');
    const cookies = cookiePairs(response);
    assert.ok(cookies.oauth_state.attributes.includes('Max-Age=0'));
    assert.ok(cookies.oauth_verifier.attributes.includes('Max-Age=0'));
  });
});
