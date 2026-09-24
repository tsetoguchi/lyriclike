// What surrounds the password routes: the feature flag, /api/me, account
// deletion and cleanup, Turnstile, and the email module.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as login from '../functions/api/auth/login.js';
import * as methods from '../functions/api/auth/methods.js';
import * as forgot from '../functions/api/auth/password/forgot.js';
import * as reset from '../functions/api/auth/password/reset.js';
import * as signup from '../functions/api/auth/signup.js';
import * as confirm from '../functions/api/auth/signup/confirm.js';
import * as me from '../functions/api/me.js';
import { sendConfirmSignupEmail, sendEmail, sendResetEmail } from '../functions/_email.js';
import { verifyTurnstile } from '../functions/_turnstile.js';
import { createFakeD1 } from './support/fake-d1.mjs';
import {
  BASE_URL, GOOD_PASSWORD, addGoogleUser, addPasswordUser, addSession, events, makeEnv, post, query,
  stubServices, turnstileToken,
} from './support/auth-harness.mjs';

let env;
let services;

beforeEach(() => {
  env = makeEnv();
  services = stubServices();
});

afterEach(() => {
  services.restore();
});

describe('the PASSWORD_AUTH_ENABLED flag', () => {
  const routes = [
    ['signup', signup, '/api/auth/signup'],
    ['signup/confirm', confirm, '/api/auth/signup/confirm'],
    ['login', login, '/api/auth/login'],
    ['password/forgot', forgot, '/api/auth/password/forgot'],
    ['password/reset', reset, '/api/auth/password/reset'],
  ];

  for (const [name, handler, path] of routes) {
    it(`makes ${name} answer 404, with no body, unless it is exactly "true"`, async () => {
      for (const value of [undefined, '', 'false', '1', 'TRUE']) {
        const off = makeEnv({ PASSWORD_AUTH_ENABLED: value });
        const response = await post(handler, off, path, { email: 'a@example.com', password: GOOD_PASSWORD });
        assert.equal(response.status, 404, String(value));
        assert.equal(await response.text(), '');
      }
      assert.deepEqual(await query(env, 'SELECT key FROM rate_limits'), []);
    });
  }

  it('tells the modal what to offer, and always answers', async () => {
    assert.deepEqual(await methods.onRequestGet({ env }).json(), { password: true });
    const off = makeEnv({ PASSWORD_AUTH_ENABLED: undefined });
    assert.deepEqual(await methods.onRequestGet({ env: off }).json(), { password: false });
  });

  it('leaves the existing routes working with the flag off', async () => {
    const off = makeEnv({ PASSWORD_AUTH_ENABLED: undefined });
    await addGoogleUser(off);
    await addSession(off, 'google-1', 'tok');
    const request = new Request(BASE_URL + '/api/me', { headers: { Cookie: 'sid=tok' } });
    const response = await me.onRequestGet({ request, env: off, waitUntil: () => {} });
    assert.equal(response.status, 200);
  });
});

describe('/api/me', () => {
  async function getMe(token, environment = env) {
    const request = new Request(BASE_URL + '/api/me', { headers: { Cookie: `sid=${token}` } });
    const pending = [];
    const response = await me.onRequestGet({ request, env: environment, waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    return response;
  }

  it('adds a boolean has_password and the providers, for a Google-only account', async () => {
    await addGoogleUser(env);
    await addSession(env, 'google-1', 'tok');
    const body = await (await getMe('tok')).json();

    assert.deepEqual(body, {
      id: 'google-1', email: 'ann@example.com', name: 'Ann', has_password: false, providers: ['google'],
    });
    assert.strictEqual(body.has_password, false);
  });

  it('reports a password-only account with no providers', async () => {
    await addPasswordUser(env);
    await addSession(env, 'user-1', 'tok');
    const body = await (await getMe('tok')).json();
    assert.strictEqual(body.has_password, true);
    assert.deepEqual(body.providers, []);
  });

  it('never exposes the hash', async () => {
    await addPasswordUser(env);
    await addSession(env, 'user-1', 'tok');
    assert.doesNotMatch(await (await getMe('tok')).text(), /pbkdf2/);
  });

  it('still answers a missing or unknown session with an empty 401', async () => {
    const response = await getMe('nope');
    assert.equal(response.status, 401);
    assert.equal(await response.text(), '');
  });

  it('cleans up expired tokens, pending signups and old rate-limit counters', async () => {
    await addPasswordUser(env);
    await addSession(env, 'user-1', 'tok');
    const db = env.lyricalmiracle_db;
    const now = Date.now();
    const insertToken = (hash, expiresAt) => db.prepare(
      'INSERT INTO reset_tokens (token_hash, user_id, email_normalized, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(hash, 'user-1', 'ann@example.com', expiresAt, 1).run();
    const insertPending = (hash, expiresAt) => db.prepare(
      'INSERT INTO pending_signups (token_hash, email, email_normalized, password_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(hash, 'x@example.com', 'x@example.com', 'h', expiresAt, 1).run();
    const insertCounter = (key, windowStart) => db.prepare(
      'INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)').bind(key, windowStart).run();

    await insertToken('old-token', now - 1000);
    await insertToken('live-token', now + 1e6);
    await insertPending('old-pending', now - 1000);
    await insertPending('live-pending', now + 1e6);
    await insertCounter('old-counter', now - 25 * 3600 * 1000);
    await insertCounter('recent-counter', now - 3600 * 1000);

    await getMe('tok');

    const keys = async (sql) => (await query(env, sql)).map(row => Object.values(row)[0]);
    assert.deepEqual(await keys('SELECT token_hash FROM reset_tokens'), ['live-token']);
    assert.deepEqual(await keys('SELECT token_hash FROM pending_signups'), ['live-pending']);
    assert.deepEqual(await keys('SELECT key FROM rate_limits'), ['recent-counter']);
  });
});

describe('deleting an account', () => {
  it('removes every trace, including reset tokens and pending signups for its address', async () => {
    await addPasswordUser(env);
    await addSession(env, 'user-1', 'tok');
    await addPasswordUser(env, { id: 'user-2', email: 'bob@example.com', name: 'Bob' });
    const db = env.lyricalmiracle_db;
    await db.prepare(
      'INSERT INTO reset_tokens (token_hash, user_id, email_normalized, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('t1', 'user-1', 'ann@example.com', Date.now() + 1e6, 1).run();
    await db.prepare(
      'INSERT INTO pending_signups (token_hash, email, email_normalized, password_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('p1', 'Ann@Example.com', 'ann@example.com', 'h', Date.now() + 1e6, 1).run();
    await db.prepare(
      'INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('l1', 'user-1', 'T', 'B', 1, 1).run();
    await db.prepare(
      'INSERT INTO logs (id, user_id, event, ip, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('g1', 'user-1', 'login_password', null, 1).run();

    const request = new Request(BASE_URL + '/api/me', { method: 'DELETE', headers: { Cookie: 'sid=tok' } });
    const response = await me.onRequestDelete({ request, env });
    assert.equal(response.status, 200);

    for (const table of ['sessions', 'lyrics', 'logs', 'identities', 'reset_tokens']) {
      assert.deepEqual(await query(env, `SELECT * FROM ${table} WHERE user_id = ?`, 'user-1'), [], table);
    }
    assert.deepEqual(await query(env, 'SELECT * FROM pending_signups'), []);
    assert.deepEqual((await query(env, 'SELECT id FROM users')).map(row => row.id), ['user-2']);
  });
});

describe('migration 0005', () => {
  it('leaves users, identities, lyrics and sessions exactly as 0004 left them', async () => {
    const db = createFakeD1({ through: '0004' });
    await db.prepare(
      'INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('u1', 'a@example.com', 'a@example.com', 'A', 1).run();
    await db.prepare(
      'INSERT INTO identities (id, user_id, provider, provider_subject, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('i1', 'u1', 'google', 's1', 1).run();
    const before = await Promise.all(['users', 'identities', 'lyrics', 'sessions'].map(async table =>
      (await db.prepare(`SELECT * FROM ${table}`).all()).results));

    db.migrateTo();

    const after = await Promise.all(['users', 'identities', 'lyrics', 'sessions'].map(async table =>
      (await db.prepare(`SELECT * FROM ${table}`).all()).results));
    assert.deepEqual(after, before);

    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())
      .results.map(row => row.name);
    for (const name of ['pending_signups', 'reset_tokens', 'rate_limits']) assert.ok(tables.includes(name), name);
  });

  it('ties a reset token to an existing user', async () => {
    await assert.rejects(env.lyricalmiracle_db.prepare(
      'INSERT INTO reset_tokens (token_hash, user_id, email_normalized, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('t', 'no-such-user', 'a@example.com', 1, 1).run());
  });
});

describe('Turnstile', () => {
  function request(ip = '203.0.113.7') {
    return new Request(BASE_URL + '/', { headers: ip ? { 'CF-Connecting-IP': ip } : {} });
  }

  it('passes only a good token for this hostname and this action', async () => {
    assert.equal(await verifyTurnstile(turnstileToken('signup'), request(), env, 'signup'), true);
    assert.equal(await verifyTurnstile(turnstileToken('signup'), request(), env, 'login'), false);
    assert.equal(await verifyTurnstile('bad', request(), env, 'signup'), false);
  });

  it('checks the hostname against APP_BASE_URL', async () => {
    services.turnstileHostname = 'lyriclike.com';
    const preview = makeEnv({ APP_BASE_URL: 'https://password-backend.lyricalmiracle.pages.dev' });
    assert.equal(await verifyTurnstile(turnstileToken('signup'), request(), preview, 'signup'), false);
    services.turnstileHostname = 'password-backend.lyricalmiracle.pages.dev';
    assert.equal(await verifyTurnstile(turnstileToken('signup'), request(), preview, 'signup'), true);
  });

  it('sends the secret, the token and the client IP to Cloudflare', async () => {
    await verifyTurnstile(turnstileToken('signup'), request('198.51.100.4'), env, 'signup');
    assert.deepEqual(services.turnstileCalls[0],
      { secret: 'turnstile-secret', token: 'ok:signup', remoteip: '198.51.100.4' });
  });

  it('refuses when misconfigured, given a missing token, or when Cloudflare cannot be reached', async () => {
    const good = turnstileToken('signup');
    assert.equal(await verifyTurnstile(undefined, request(), env, 'signup'), false);
    assert.equal(await verifyTurnstile('', request(), env, 'signup'), false);
    assert.equal(await verifyTurnstile('x'.repeat(3000), request(), env, 'signup'), false);
    assert.equal(await verifyTurnstile(good, request(), makeEnv({ TURNSTILE_SECRET_KEY: '' }), 'signup'), false);
    assert.equal(await verifyTurnstile(good, request(), makeEnv({ APP_BASE_URL: '' }), 'signup'), false);

    services.restore();
    globalThis.fetch = () => Promise.reject(new Error('network'));
    assert.equal(await verifyTurnstile(good, request(), env, 'signup'), false);
  });
});

describe('email', () => {
  function context(overrides = {}) {
    const pending = [];
    const request = new Request(BASE_URL + '/', { headers: { Host: 'evil.example' } });
    return { env, request, waitUntil: p => pending.push(p), ...overrides };
  }

  it('builds links from APP_BASE_URL, never from the request Host', async () => {
    const preview = makeEnv({ APP_BASE_URL: 'https://preview.example/' });
    await sendResetEmail({ ...context(), env: preview }, { to: 'a@example.com', token: 'a'.repeat(64) });

    const [message] = services.mail;
    assert.match(message.text, /https:\/\/preview\.example\/#reset_token=a{64}/);
    assert.doesNotMatch(message.text + message.html, /evil\.example/);
  });

  it('sends a plain-text part and a light HTML part that agree, and states the expiry', async () => {
    await sendConfirmSignupEmail(context(), { to: 'a@example.com', token: 'b'.repeat(64) });
    const [{ text, html }] = services.mail;

    assert.match(text, /24 hours/);
    assert.match(html, /24 hours/);
    assert.match(html, /#e9b45f/);
    assert.match(html, new RegExp(`href="https://lyriclike.com/#signup_token=b{64}"`));
  });

  it('escapes what it puts into HTML', async () => {
    await sendResetEmail(context(), { to: 'a@example.com', token: '"><script>x</script>' });
    assert.doesNotMatch(services.mail[0].html, /<script>/);
  });

  it('limits mail to 5 a day per address, and logs what it skipped', async () => {
    for (let i = 0; i < 6; i++) {
      await sendResetEmail(context(), { to: 'A@Example.com', token: 'a'.repeat(64) });
    }
    assert.equal(services.mail.length, 5);
    assert.deepEqual((await events(env)).filter(e => e === 'email_skipped'), ['email_skipped']);
  });

  it('keeps signup mail from using up the pool reset mail depends on', async () => {
    for (let i = 0; i < 70; i++) {
      await sendConfirmSignupEmail(context(), { to: `w${i}@example.com`, token: 'a'.repeat(64) });
    }
    assert.equal(services.mail.length, 60);

    await sendResetEmail(context(), { to: 'real@example.com', token: 'a'.repeat(64) });
    assert.equal(services.mail.length, 61);
  });

  it('logs email_failed, and never throws, for a provider error or missing configuration', async () => {
    services.mailDown = true;
    await sendResetEmail(context(), { to: 'a@example.com', token: 'a'.repeat(64) });

    const unconfigured = makeEnv({ RESEND_API_KEY: '', APP_BASE_URL: '' });
    await sendResetEmail({ ...context(), env: unconfigured }, { to: 'a@example.com', token: 'a'.repeat(64) });

    assert.deepEqual(await events(env), ['email_failed']);
    assert.deepEqual(await events(unconfigured), ['email_failed']);
    assert.deepEqual(await sendEmail(unconfigured, { to: 'a@example.com' }), { ok: false });
  });
});
