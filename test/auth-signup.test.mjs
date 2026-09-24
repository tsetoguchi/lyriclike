// Password signup and confirming it. A signup is pending until its email is
// confirmed, and a new address and a taken one look the same from outside.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as confirm from '../functions/api/auth/signup/confirm.js';
import * as signup from '../functions/api/auth/signup.js';
import { verifyPassword } from '../functions/_password.js';
import { sha256Hex } from '../functions/_shared.js';
import {
  GOOD_PASSWORD, OTHER_PASSWORD, addGoogleUser, addPasswordUser, countDerivations, events,
  latestToken, makeEnv, post, query, stubServices, turnstileToken,
} from './support/auth-harness.mjs';

const SIGNUP = '/api/auth/signup';
const CONFIRM = '/api/auth/signup/confirm';
const CONFIRM_MESSAGE = 'Check your email to finish signing up.';

let env;
let services;

beforeEach(() => {
  env = makeEnv();
  services = stubServices({ breached: ['password1234'] });
});

afterEach(() => {
  services.restore();
});

function signUp(overrides = {}, options = {}) {
  return post(signup, env, SIGNUP, {
    email: 'Ann@Example.com',
    password: GOOD_PASSWORD,
    name: 'Ann',
    turnstile: turnstileToken('signup'),
    ...overrides,
  }, options);
}

function confirmWith(token, password, options) {
  return post(confirm, env, CONFIRM, { token, password }, options);
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

describe('signup', () => {
  it('answers 202 with no cookie, and writes a pending row but no user', async () => {
    const response = await signUp();

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { message: CONFIRM_MESSAGE });
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(await query(env, 'SELECT id FROM users'), []);

    const [pending] = await query(env, 'SELECT * FROM pending_signups');
    assert.equal(pending.email, 'Ann@Example.com');
    assert.equal(pending.email_normalized, 'ann@example.com');
    assert.equal(pending.name, 'Ann');
    assert.equal(pending.failed_attempts, 0);
    assert.ok(pending.expires_at > Date.now() + 23 * 3600 * 1000);
    assert.equal(await verifyPassword(GOOD_PASSWORD, pending.password_hash, env), true);
  });

  it('emails one confirm link and stores only its hash', async () => {
    await signUp();

    assert.equal(services.mail.length, 1);
    assert.deepEqual(services.mail[0].to, ['Ann@Example.com']);
    assert.match(services.mail[0].subject, /Confirm your email/);
    assert.match(services.mail[0].text, /24 hours/);
    const token = latestToken(services, 'signup_token');
    assert.match(services.mail[0].text, /https:\/\/lyriclike\.com\/#signup_token=/);

    const [pending] = await query(env, 'SELECT token_hash FROM pending_signups');
    assert.equal(pending.token_hash, await sha256Hex(token));
  });

  it('calls Resend with the key and sender from the environment', async () => {
    await signUp();
    const [{ headers, body }] = services.mailRequests;
    assert.equal(headers.Authorization, 'Bearer resend-key');
    assert.equal(body.from, 'LyricLike <noreply@lyriclike.com>');
  });

  it('logs the start of a signup without the address in the log', async () => {
    await signUp();
    assert.deepEqual(await events(env), ['signup_started']);
    const logs = JSON.stringify(await query(env, 'SELECT * FROM logs'));
    assert.doesNotMatch(logs, /ann@example|Ann@Example/i);
  });

  it('gives an address that already has an account the identical answer', async () => {
    const fresh = await signUp({ email: 'new@example.com' }, { ip: '198.51.100.1' });
    await addPasswordUser(env);
    const taken = await signUp({ email: 'ann@example.com' }, { ip: '198.51.100.2' });

    assert.equal(taken.status, fresh.status);
    assert.equal(await taken.text(), await fresh.text());
    assert.equal(taken.headers.get('Set-Cookie'), null);
    assert.deepEqual([...taken.headers.keys()].sort(), [...fresh.headers.keys()].sort());
  });

  it('writes nothing for a taken address, and sends the "already have an account" mail', async () => {
    await addPasswordUser(env);
    await signUp();

    assert.deepEqual(await query(env, 'SELECT token_hash FROM pending_signups'), []);
    assert.equal((await query(env, 'SELECT id FROM users')).length, 1);
    assert.equal(services.mail.length, 1);
    assert.match(services.mail[0].subject, /already have a LyricLike account/);
    assert.equal(latestToken(services, 'signup_token'), null);
    assert.deepEqual(await events(env), ['signup_existing']);
  });

  it('sends the taken-address mail at most once an hour', async () => {
    await addPasswordUser(env);
    await signUp();
    await signUp();
    assert.equal(services.mail.length, 1);
  });

  it('hashes once whether or not the address is taken', async () => {
    const counter = countDerivations();
    try {
      await signUp({ email: 'new@example.com' }, { ip: '198.51.100.1' });
      assert.equal(counter.count, 1);

      await addPasswordUser(env);
      counter.count = 0;
      await signUp({ email: 'ann@example.com' }, { ip: '198.51.100.2' });
      assert.equal(counter.count, 1);
    } finally {
      counter.restore();
    }
  });

  it('still answers 202 and logs the failure when mail cannot be sent', async () => {
    services.mailDown = true;
    const response = await signUp();
    assert.equal(response.status, 202);
    assert.deepEqual(await events(env), ['signup_started', 'email_failed']);
  });

  it('answers honestly to problems that say nothing about anyone else', async () => {
    const cases = [
      [{ email: 'not-an-email' }, 'invalid_email'],
      [{ password: 'short' }, 'password_too_short'],
      [{ password: 'password1234' }, 'password_breached'],
      [{ email: 'annie.long@example.com', password: 'my-ANNIE.long-pass' }, 'password_contains_email'],
      [{ turnstile: undefined }, 'captcha_failed'],
      [{ turnstile: 'bad' }, 'captcha_failed'],
      [{ turnstile: turnstileToken('login') }, 'captcha_failed'],
      [{ name: 'n'.repeat(101) }, 'invalid_request'],
      [{ password: 12345678 }, 'invalid_request'],
    ];
    for (const [index, [overrides, code]] of cases.entries()) {
      // A separate IP each, so the per-IP limit does not interfere.
      const response = await signUp(overrides, { ip: `198.51.100.${index + 1}` });
      assert.equal(response.status, 400, JSON.stringify(overrides));
      assert.equal(await errorCode(response), code);
    }
    assert.deepEqual(await query(env, 'SELECT token_hash FROM pending_signups'), []);
  });

  it('answers a malformed body with a uniform error', async () => {
    for (const body of ['not json', '[]', '{"email": 1}', '']) {
      const response = await post(signup, env, SIGNUP, body);
      assert.equal(response.status, 400, body);
      assert.equal(await errorCode(response), 'invalid_request');
    }
  });

  it('refuses a mismatched Turnstile hostname', async () => {
    services.turnstileHostname = 'evil.example';
    assert.equal(await errorCode(await signUp()), 'captcha_failed');
  });

  it('limits an IP to 5 signups an hour, with Retry-After', async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await signUp({ email: `w${i}@example.com` })).status, 202);
    }
    const refused = await signUp({ email: 'w6@example.com' });
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get('Retry-After')) > 0);
  });

  it('limits one address to 3 signups an hour, whatever the IP', async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await signUp({}, { ip: `198.51.100.${i + 1}` })).status, 202);
    }
    assert.equal((await signUp({}, { ip: '198.51.100.9' })).status, 429);
  });
});

describe('confirming a signup', () => {
  async function pendingToken(overrides, options) {
    await signUp(overrides, options);
    return latestToken(services, 'signup_token');
  }

  it('creates the account, starts a session and clears the pending rows', async () => {
    const token = await pendingToken();
    const response = await confirmWith(token, GOOD_PASSWORD);
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.user.email, 'Ann@Example.com');
    assert.equal(body.user.name, 'Ann');
    assert.equal(body.user.has_password, true);
    assert.deepEqual(body.user.providers, []);

    const [user] = await query(env, 'SELECT * FROM users');
    assert.equal(user.email_normalized, 'ann@example.com');
    assert.equal(await verifyPassword(GOOD_PASSWORD, user.password_hash, env), true);
    assert.ok(user.password_updated_at > 0);
    assert.deepEqual(await query(env, 'SELECT token_hash FROM pending_signups'), []);

    const cookie = response.headers.get('Set-Cookie');
    const [, sid] = /sid=([0-9a-f]{64});/.exec(cookie);
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    const [session] = await query(env, 'SELECT id, user_id FROM sessions');
    assert.equal(session.user_id, user.id);
    assert.equal(session.id, await sha256Hex(sid));
    assert.deepEqual(await events(env), ['signup_started', 'signup_password']);
  });

  it('wrong password: 400, one more failure, and the fifth deletes the signup', async () => {
    const token = await pendingToken();
    for (let i = 1; i <= 4; i++) {
      const response = await confirmWith(token, 'not the password');
      assert.equal(await errorCode(response), 'wrong_password');
      const [row] = await query(env, 'SELECT failed_attempts FROM pending_signups');
      assert.equal(row.failed_attempts, i);
    }
    assert.equal(await errorCode(await confirmWith(token, 'not the password')), 'wrong_password');
    assert.deepEqual(await query(env, 'SELECT token_hash FROM pending_signups'), []);

    assert.equal(await errorCode(await confirmWith(token, GOOD_PASSWORD)), 'invalid_token');
    assert.deepEqual(await query(env, 'SELECT id FROM users'), []);
  });

  it('each pending signup for an address confirms only with its own password', async () => {
    const first = await pendingToken({ password: GOOD_PASSWORD });
    const second = await pendingToken({ password: OTHER_PASSWORD });
    assert.notEqual(first, second);

    assert.equal(await errorCode(await confirmWith(first, OTHER_PASSWORD)), 'wrong_password');
    assert.equal(await errorCode(await confirmWith(second, GOOD_PASSWORD)), 'wrong_password');

    assert.equal((await confirmWith(second, OTHER_PASSWORD)).status, 201);
    const [user] = await query(env, 'SELECT password_hash FROM users');
    assert.equal(await verifyPassword(OTHER_PASSWORD, user.password_hash, env), true);
    // Confirming clears every pending row for the address.
    assert.equal(await errorCode(await confirmWith(first, GOOD_PASSWORD)), 'invalid_token');
  });

  it('refuses an expired token, an unknown one, and anything not shaped like one', async () => {
    const token = await pendingToken();
    await env.lyricalmiracle_db.prepare('UPDATE pending_signups SET expires_at = ?').bind(Date.now() - 1).run();

    for (const candidate of [token, 'f'.repeat(64), 'short', '', undefined, 'Z'.repeat(64)]) {
      const response = await confirmWith(candidate, GOOD_PASSWORD);
      assert.equal(response.status, 400);
      assert.equal(await errorCode(response), 'invalid_token');
    }
    assert.deepEqual(await query(env, 'SELECT id FROM users'), []);
  });

  it('opening the link changes nothing: only a POST with the password confirms', async () => {
    await pendingToken();
    assert.equal(confirm.onRequestGet, undefined);
    assert.equal(confirm.onRequest, undefined);
    assert.equal((await query(env, 'SELECT token_hash FROM pending_signups')).length, 1);
    assert.deepEqual(await query(env, 'SELECT id FROM users'), []);
  });

  it('adds the password to a Google-only account that appeared meanwhile', async () => {
    const token = await pendingToken();
    await addGoogleUser(env, { id: 'g1', email: 'ann@example.com' });

    const response = await confirmWith(token, GOOD_PASSWORD);
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.user.id, 'g1');
    assert.equal(body.user.has_password, true);
    assert.deepEqual(body.user.providers, ['google']);
    assert.equal((await query(env, 'SELECT id FROM users')).length, 1);
    assert.equal((await query(env, 'SELECT id FROM identities')).length, 1);
    assert.deepEqual(await query(env, 'SELECT token_hash FROM pending_signups'), []);
    assert.match(services.mail.at(-1).subject, /password was changed/);
    assert.deepEqual(services.mail.at(-1).to, ['ann@example.com']);
    assert.equal(await events(env).then(list => list.at(-1)), 'password_added');
  });

  it('answers 409 and leaves the password alone when the account already has one', async () => {
    const token = await pendingToken();
    await addPasswordUser(env, { password: OTHER_PASSWORD });

    const response = await confirmWith(token, GOOD_PASSWORD);

    assert.equal(response.status, 409);
    assert.equal(await errorCode(response), 'account_exists');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(await query(env, 'SELECT id FROM sessions'), []);
    assert.deepEqual(await query(env, 'SELECT token_hash FROM pending_signups'), []);
    const [user] = await query(env, 'SELECT password_hash FROM users');
    assert.equal(await verifyPassword(OTHER_PASSWORD, user.password_hash, env), true);
  });

  it('falls back to 409 when the unique address is taken during the insert', async () => {
    const token = await pendingToken();
    await addPasswordUser(env, { password: OTHER_PASSWORD });

    // The address lookup ran before the other account committed, so it saw
    // nothing; the insert then hits the unique index.
    const db = env.lyricalmiracle_db;
    const realPrepare = db.prepare.bind(db);
    let lookups = 0;
    db.prepare = (text) => (text.includes('FROM users WHERE email_normalized') && lookups++ === 0
      ? realPrepare('SELECT id FROM users WHERE email_normalized = ? AND 0')
      : realPrepare(text));

    const response = await confirmWith(token, GOOD_PASSWORD);
    assert.equal(response.status, 409);
    assert.equal((await query(env, 'SELECT id FROM users')).length, 1);
  });

  it('limits an IP to 10 confirm attempts an hour', async () => {
    for (let i = 0; i < 10; i++) await confirmWith('a'.repeat(64), GOOD_PASSWORD);
    const refused = await confirmWith('a'.repeat(64), GOOD_PASSWORD);
    assert.equal(refused.status, 429);
    assert.ok(refused.headers.get('Retry-After'));
  });
});
