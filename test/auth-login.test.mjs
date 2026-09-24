// Password login: one generic failure, the same work every time, and limits
// that slow attempts down without ever locking an account.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as login from '../functions/api/auth/login.js';
import * as signup from '../functions/api/auth/signup.js';
import * as confirm from '../functions/api/auth/signup/confirm.js';
import { hashPassword, needsRehash, verifyPassword } from '../functions/_password.js';
import { sha256Hex } from '../functions/_shared.js';
import {
  GOOD_PASSWORD, addGoogleUser, addPasswordUser, countDerivations, events, latestToken, makeEnv,
  post, query, stubServices, turnstileToken,
} from './support/auth-harness.mjs';

const LOGIN = '/api/auth/login';

let env;
let services;

beforeEach(() => {
  env = makeEnv();
  services = stubServices();
});

afterEach(() => {
  services.restore();
});

function logIn(overrides = {}, options = {}) {
  return post(login, env, LOGIN, {
    email: 'ann@example.com', password: GOOD_PASSWORD, ...overrides,
  }, options);
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

describe('login', () => {
  it('signs in, returns the account, and stores only a hash of the cookie', async () => {
    const id = await addPasswordUser(env);
    const response = await logIn();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.user, {
      id, email: 'ann@example.com', name: 'Ann', has_password: true, providers: [],
    });
    const cookie = response.headers.get('Set-Cookie');
    const [, sid] = /sid=([0-9a-f]{64});/.exec(cookie);
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    const [session] = await query(env, 'SELECT id, user_id FROM sessions');
    assert.equal(session.user_id, id);
    assert.equal(session.id, await sha256Hex(sid));
    assert.deepEqual(await events(env), ['login_password']);
  });

  it('matches the address whatever its case or surrounding spaces', async () => {
    await addPasswordUser(env);
    assert.equal((await logIn({ email: '  ANN@Example.com ' })).status, 200);
  });

  it('reports a Google account that also has a password with both providers', async () => {
    await addGoogleUser(env, { id: 'g1' });
    await env.lyricalmiracle_db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(GOOD_PASSWORD, env), 'g1').run();

    const body = await (await logIn()).json();
    assert.deepEqual(body.user.providers, ['google']);
    assert.equal(body.user.has_password, true);
  });

  it('drops the session the browser already held', async () => {
    const id = await addPasswordUser(env);
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).bind(await sha256Hex('old-token'), id, Date.now() + 1e9, 1).run();

    await logIn({}, { cookie: 'sid=old-token' });
    const sessions = await query(env, 'SELECT id FROM sessions');
    assert.equal(sessions.length, 1);
    assert.notEqual(sessions[0].id, await sha256Hex('old-token'));
  });

  it('gives every kind of failure the identical 401, with the same work', async () => {
    await addPasswordUser(env);
    await addGoogleUser(env, { id: 'g1', email: 'gary@example.com' });
    await post(signup, env, '/api/auth/signup', {
      email: 'pending@example.com', password: GOOD_PASSWORD, turnstile: turnstileToken('signup'),
    }, { ip: '198.51.100.99' });

    const failures = [
      { password: 'wrong password!' },
      { email: 'nobody@example.com' },
      { email: 'gary@example.com' },
      { email: 'pending@example.com' },
    ];
    const seen = [];
    for (const [index, overrides] of failures.entries()) {
      const counter = countDerivations();
      const response = await logIn(overrides, { ip: `198.51.100.${index + 1}` });
      counter.restore();

      assert.equal(response.status, 401, JSON.stringify(overrides));
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.equal(counter.count, 1, JSON.stringify(overrides));
      seen.push(await response.text());
    }
    assert.equal(new Set(seen).size, 1);
    assert.equal(JSON.parse(seen[0]).error.code, 'invalid_credentials');
    assert.deepEqual(await query(env, 'SELECT id FROM sessions'), []);
  });

  it('logs login_failed for every kind of failure, and nothing for a limited attempt', async () => {
    await addPasswordUser(env);
    await logIn({ password: 'wrong password!' });
    await logIn({ email: 'nobody@example.com' });
    const failed = await query(env, "SELECT user_id FROM logs WHERE event = 'login_failed' ORDER BY rowid");
    assert.deepEqual(failed.map(row => row.user_id), ['user-1', null]);

    for (let i = 0; i < 5; i++) await logIn({ password: 'wrong password!' }, { ip: '198.51.100.50' });
    const limited = await logIn({ password: 'wrong password!' }, { ip: '198.51.100.50' });
    assert.equal(limited.status, 429);
    assert.equal((await events(env)).filter(event => event === 'login_failed').length, 7);
  });

  it('answers a malformed request with 400, saying nothing about accounts', async () => {
    for (const body of [{ email: 'no-at-sign', password: 'x' }, { email: 'a@b.co' }, { password: 'x' }, '[]', 'nope']) {
      const response = await post(login, env, LOGIN, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(await errorCode(response), 'invalid_request');
    }
  });

  it('moves an older hash to the live parameters after a successful login', async () => {
    const id = await addPasswordUser(env);
    const [row] = await query(env, 'SELECT password_hash FROM users WHERE id = ?', id);
    const old = await legacyHash(env, GOOD_PASSWORD, 1000);
    await env.lyricalmiracle_db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(old, id).run();
    assert.equal(needsRehash(old), true);
    assert.notEqual(old, row.password_hash);

    assert.equal((await logIn()).status, 200);
    const [after] = await query(env, 'SELECT password_hash FROM users WHERE id = ?', id);
    assert.equal(needsRehash(after.password_hash), false);
    assert.equal(await verifyPassword(GOOD_PASSWORD, after.password_hash, env), true);
  });

  it('logs a signed-up person in after they confirm, end to end', async () => {
    await post(signup, env, '/api/auth/signup', {
      email: 'new@example.com', password: GOOD_PASSWORD, turnstile: turnstileToken('signup'),
    });
    assert.equal((await logIn({ email: 'new@example.com' })).status, 401);

    await post(confirm, env, '/api/auth/signup/confirm',
      { token: latestToken(services, 'signup_token'), password: GOOD_PASSWORD });
    assert.equal((await logIn({ email: 'new@example.com' })).status, 200);
  });
});

async function legacyHash(environment, password, iterations) {
  const encoder = new TextEncoder();
  const hmac = await crypto.subtle.importKey('raw', encoder.encode(environment.PASSWORD_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const peppered = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(password)));
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  return `pbkdf2-sha256$v1$${iterations}$${b64(salt)}$${b64(bits)}`;
}

describe('login limits', () => {
  it('limits an IP to 10 attempts in 15 minutes, with Retry-After', async () => {
    await addPasswordUser(env);
    for (let i = 0; i < 10; i++) {
      const response = await logIn({ email: `w${i}@example.com` });
      assert.equal(response.status, 401);
    }
    const refused = await logIn({ email: 'w11@example.com' });
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get('Retry-After')) > 0);
  });

  it('slows one address from one IP after 5 failures, but not the same address elsewhere', async () => {
    await addPasswordUser(env);
    for (let i = 0; i < 5; i++) {
      assert.equal((await logIn({ password: 'wrong password!' })).status, 401);
    }
    assert.equal((await logIn({ password: 'wrong password!' })).status, 429);
    // A stranger's failures do not lock the real owner out from their own IP.
    assert.equal((await logIn({}, { ip: '198.51.100.50' })).status, 200);
  });

  it('counts only failures against the per-address limit', async () => {
    await addPasswordUser(env);
    for (let i = 0; i < 4; i++) await logIn({ password: 'wrong password!' });
    assert.equal((await logIn()).status, 200);
    assert.equal((await logIn()).status, 200);
  });

  it('asks for Turnstile, instead of refusing, past 20 failures from all IPs', async () => {
    await addPasswordUser(env);
    for (let ip = 1; ip <= 4; ip++) {
      for (let i = 0; i < 5; i++) {
        assert.equal((await logIn({ password: 'wrong password!' }, { ip: `198.51.100.${ip}` })).status, 401);
      }
    }

    const noToken = await logIn({}, { ip: '198.51.100.60' });
    assert.equal(noToken.status, 428);
    assert.equal(await errorCode(noToken), 'captcha_required');

    const badToken = await logIn({ turnstile: 'bad' }, { ip: '198.51.100.60' });
    assert.equal(badToken.status, 428);
    const wrongAction = await logIn({ turnstile: turnstileToken('signup') }, { ip: '198.51.100.60' });
    assert.equal(wrongAction.status, 428);

    // With the challenge passed, the real owner gets in: never a lockout.
    const solved = await logIn({ turnstile: turnstileToken('login') }, { ip: '198.51.100.60' });
    assert.equal(solved.status, 200);
    assert.equal(services.turnstileCalls.at(-1).remoteip, '198.51.100.60');
  });

  it('applies the same limits to an address that has no account', async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await logIn({ email: 'nobody@example.com' })).status, 401);
    }
    assert.equal((await logIn({ email: 'nobody@example.com' })).status, 429);
  });
});
