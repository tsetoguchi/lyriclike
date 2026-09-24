// Forgot-password and reset. Forgot answers the same whether or not the
// address has an account; a reset uses its token once and signs every other
// session out.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as forgot from '../functions/api/auth/password/forgot.js';
import * as reset from '../functions/api/auth/password/reset.js';
import { verifyPassword } from '../functions/_password.js';
import { sha256Hex } from '../functions/_shared.js';
import {
  GOOD_PASSWORD, OTHER_PASSWORD, addGoogleUser, addPasswordUser, addSession, events, latestToken,
  makeEnv, post, query, stubServices, turnstileToken,
} from './support/auth-harness.mjs';

const FORGOT = '/api/auth/password/forgot';
const RESET = '/api/auth/password/reset';
const NEW_PASSWORD = 'a brand new passphrase';

let env;
let services;

beforeEach(() => {
  env = makeEnv();
  services = stubServices({ breached: ['password1234'] });
});

afterEach(() => {
  services.restore();
});

function forgotFor(email, overrides = {}, options) {
  return post(forgot, env, FORGOT, { email, turnstile: turnstileToken('forgot'), ...overrides }, options);
}

function resetWith(token, password, options) {
  return post(reset, env, RESET, { token, password }, options);
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

async function requestToken(email = 'ann@example.com') {
  await forgotFor(email);
  return latestToken(services, 'reset_token');
}

async function storedPasswordMatches(password, id = 'user-1') {
  const [row] = await query(env, 'SELECT password_hash FROM users WHERE id = ?', id);
  return verifyPassword(password, row.password_hash, env);
}

describe('forgot password', () => {
  it('answers the identical 202 for a known and an unknown address', async () => {
    await addPasswordUser(env);
    const known = await forgotFor('ann@example.com', {}, { ip: '198.51.100.1' });
    const unknown = await forgotFor('nobody@example.com', {}, { ip: '198.51.100.2' });

    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.equal(await known.text(), await unknown.text());
    assert.equal(known.headers.get('Set-Cookie'), null);
  });

  it('issues a 30 minute token and emails a fragment link for a known address only', async () => {
    await addPasswordUser(env);
    await forgotFor('nobody@example.com', {}, { ip: '198.51.100.2' });
    assert.deepEqual(services.mail, []);
    assert.deepEqual(await query(env, 'SELECT token_hash FROM reset_tokens'), []);

    await forgotFor('  Ann@Example.com ');
    assert.equal(services.mail.length, 1);
    assert.deepEqual(services.mail[0].to, ['ann@example.com']);
    assert.match(services.mail[0].text, /https:\/\/lyriclike\.com\/#reset_token=/);
    assert.match(services.mail[0].text, /30 minutes/);

    const [row] = await query(env, 'SELECT * FROM reset_tokens');
    assert.equal(row.token_hash, await sha256Hex(latestToken(services, 'reset_token')));
    assert.equal(row.user_id, 'user-1');
    assert.equal(row.email_normalized, 'ann@example.com');
    assert.equal(row.consumed_at, null);
    const lifetime = row.expires_at - row.created_at;
    assert.equal(lifetime, 30 * 60 * 1000);
  });

  it('sends the same for an account that has only Google', async () => {
    await addGoogleUser(env, { id: 'g1' });
    assert.equal((await forgotFor('ann@example.com')).status, 202);
    assert.equal(services.mail.length, 1);
  });

  it('does the work after the response, so the answer shows nothing', async () => {
    await addPasswordUser(env);
    const pending = [];
    const request = new Request('https://lyriclike.com' + FORGOT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ email: 'ann@example.com', turnstile: turnstileToken('forgot') }),
    });
    const response = await forgot.onRequestPost({ request, env, waitUntil: p => pending.push(p) });

    assert.equal(response.status, 202);
    assert.equal(pending.length, 1);
    await Promise.all(pending);
    assert.equal(services.mail.length, 1);
  });

  it('a newer request replaces the older token', async () => {
    await addPasswordUser(env);
    const first = await requestToken();
    const second = await requestToken();

    assert.notEqual(first, second);
    assert.equal(await errorCode(await resetWith(first, NEW_PASSWORD)), 'invalid_token');
    assert.equal((await resetWith(second, NEW_PASSWORD)).status, 200);
  });

  it('refuses without a valid Turnstile token, and a malformed address', async () => {
    await addPasswordUser(env);
    assert.equal(await errorCode(await forgotFor('ann@example.com', { turnstile: undefined })), 'captcha_failed');
    assert.equal(await errorCode(await forgotFor('ann@example.com', { turnstile: turnstileToken('signup') })), 'captcha_failed');
    assert.equal(await errorCode(await forgotFor('nope')), 'invalid_email');
    assert.deepEqual(services.mail, []);
  });

  it('limits one address to 3 an hour, and one IP to 10', async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await forgotFor('ann@example.com', {}, { ip: `198.51.100.${i + 1}` })).status, 202);
    }
    const refused = await forgotFor('ann@example.com', {}, { ip: '198.51.100.9' });
    assert.equal(refused.status, 429);
    assert.ok(refused.headers.get('Retry-After'));

    for (let i = 0; i < 10; i++) {
      assert.equal((await forgotFor(`w${i}@example.com`, {}, { ip: '198.51.100.20' })).status, 202);
    }
    assert.equal((await forgotFor('w10@example.com', {}, { ip: '198.51.100.20' })).status, 429);
  });
});

describe('reset password', () => {
  it('sets the password, signs in, and uses the token up', async () => {
    await addPasswordUser(env);
    const token = await requestToken();
    const response = await resetWith(token, NEW_PASSWORD);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.user.id, 'user-1');
    assert.equal(body.user.has_password, true);
    assert.match(response.headers.get('Set-Cookie'), /sid=[0-9a-f]{64}/);
    assert.equal(await storedPasswordMatches(NEW_PASSWORD), true);
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), false);

    const [row] = await query(env, 'SELECT consumed_at FROM reset_tokens');
    assert.ok(row.consumed_at > 0);
    assert.equal(await errorCode(await resetWith(token, OTHER_PASSWORD)), 'invalid_token');
    assert.equal(await storedPasswordMatches(NEW_PASSWORD), true);
    assert.equal((await events(env)).at(-1), 'password_reset');
  });

  it('deletes every earlier session, leaving only the new one', async () => {
    await addPasswordUser(env);
    await addSession(env, 'user-1', 'old-a');
    await addSession(env, 'user-1', 'old-b');
    await addPasswordUser(env, { id: 'user-2', email: 'bob@example.com', name: 'Bob' });
    await addSession(env, 'user-2', 'bobs');

    const response = await resetWith(await requestToken(), NEW_PASSWORD);
    const [, sid] = /sid=([0-9a-f]{64})/.exec(response.headers.get('Set-Cookie'));

    const mine = await query(env, "SELECT id FROM sessions WHERE user_id = 'user-1'");
    assert.deepEqual(mine.map(row => row.id), [await sha256Hex(sid)]);
    assert.equal((await query(env, "SELECT id FROM sessions WHERE user_id = 'user-2'")).length, 1);
  });

  it('emails the person that the password changed', async () => {
    await addPasswordUser(env);
    await resetWith(await requestToken(), NEW_PASSWORD);
    assert.match(services.mail.at(-1).subject, /password was changed/);
    assert.deepEqual(services.mail.at(-1).to, ['ann@example.com']);
  });

  it('deletes other outstanding tokens for the account', async () => {
    await addPasswordUser(env);
    const token = await requestToken();
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO reset_tokens (token_hash, user_id, email_normalized, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('stray', 'user-1', 'ann@example.com', Date.now() + 1e6, 1).run();

    await resetWith(token, NEW_PASSWORD);
    assert.deepEqual((await query(env, 'SELECT token_hash FROM reset_tokens')).map(r => r.token_hash),
      [await sha256Hex(token)]);
  });

  it('a weak, breached or address-containing password is refused and the token still works', async () => {
    await addPasswordUser(env, { email: 'annette@example.com' });
    const token = await requestToken('annette@example.com');

    for (const [password, code] of [
      ['short', 'password_too_short'],
      ['password1234', 'password_breached'],
      ['my-ANNETTE-password', 'password_contains_email'],
    ]) {
      const response = await resetWith(token, password);
      assert.equal(response.status, 400);
      assert.equal(await errorCode(response), code);
    }
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), true);
    assert.equal((await resetWith(token, NEW_PASSWORD)).status, 200);
  });

  it('refuses an expired token, an unknown one, and a malformed one', async () => {
    await addPasswordUser(env);
    const token = await requestToken();
    await env.lyricalmiracle_db.prepare('UPDATE reset_tokens SET expires_at = ?').bind(Date.now() - 1).run();

    for (const candidate of [token, 'f'.repeat(64), 'short', undefined]) {
      const response = await resetWith(candidate, NEW_PASSWORD);
      assert.equal(response.status, 400);
      assert.equal(await errorCode(response), 'invalid_token');
    }
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), true);
  });

  it('refuses a token whose address no longer matches the account', async () => {
    await addPasswordUser(env);
    const token = await requestToken();
    await env.lyricalmiracle_db.prepare(
      "UPDATE users SET email = 'moved@example.com', email_normalized = 'moved@example.com'").run();

    assert.equal(await errorCode(await resetWith(token, NEW_PASSWORD)), 'invalid_token');
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), true);
  });

  it('lets only one of two racing requests use the token', async () => {
    await addPasswordUser(env);
    const token = await requestToken();
    const [a, b] = await Promise.all([
      resetWith(token, NEW_PASSWORD, { ip: '198.51.100.1' }),
      resetWith(token, OTHER_PASSWORD, { ip: '198.51.100.2' }),
    ]);

    assert.deepEqual([a.status, b.status].sort(), [200, 400]);
    const winner = a.status === 200 ? NEW_PASSWORD : OTHER_PASSWORD;
    const loser = a.status === 200 ? OTHER_PASSWORD : NEW_PASSWORD;
    assert.equal(await storedPasswordMatches(winner), true);
    assert.equal(await storedPasswordMatches(loser), false);
  });

  it('adds a password to an account that has only Google, keeping the identity', async () => {
    await addGoogleUser(env, { id: 'g1' });
    const token = await requestToken();
    const response = await resetWith(token, NEW_PASSWORD);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.user.has_password, true);
    assert.deepEqual(body.user.providers, ['google']);
    assert.equal(await storedPasswordMatches(NEW_PASSWORD, 'g1'), true);
  });

  it('limits an IP to 10 reset attempts an hour', async () => {
    for (let i = 0; i < 10; i++) await resetWith('a'.repeat(64), NEW_PASSWORD);
    assert.equal((await resetWith('a'.repeat(64), NEW_PASSWORD)).status, 429);
  });
});
