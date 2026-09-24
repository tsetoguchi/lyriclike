// The Security panel's routes: changing a password, emailing a Google-only
// account a link to set one, and asking for the password before an account is
// deleted.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as reset from '../functions/api/auth/password/reset.js';
import * as me from '../functions/api/me.js';
import * as changePassword from '../functions/api/me/password.js';
import * as passwordLink from '../functions/api/me/password-link.js';
import { verifyPassword } from '../functions/_password.js';
import { sha256Hex } from '../functions/_shared.js';
import {
  BASE_URL, GOOD_PASSWORD, OTHER_PASSWORD, addGoogleUser, addPasswordUser, addSession, events,
  latestToken, makeEnv, post, query, stubServices,
} from './support/auth-harness.mjs';

const CHANGE = '/api/me/password';
const LINK = '/api/me/password-link';
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

function change(currentPassword, password, { cookie = 'sid=tok', ip } = {}) {
  return post(changePassword, env, CHANGE,
    { current_password: currentPassword, password }, { cookie, ip });
}

function requestLink({ cookie = 'sid=tok' } = {}) {
  return post(passwordLink, env, LINK, '', { cookie });
}

function deleteAccount(body, { cookie = 'sid=tok' } = {}) {
  const headers = { Cookie: cookie };
  const init = { method: 'DELETE', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return me.onRequestDelete({ request: new Request(BASE_URL + '/api/me', init), env });
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

async function storedPasswordMatches(password, id = 'user-1') {
  const [row] = await query(env, 'SELECT password_hash FROM users WHERE id = ?', id);
  return verifyPassword(password, row.password_hash, env);
}

async function sessionIds() {
  return (await query(env, 'SELECT id FROM sessions ORDER BY id')).map(row => row.id);
}

async function userIds() {
  return (await query(env, 'SELECT id FROM users')).map(row => row.id);
}

describe('changing a password', () => {
  beforeEach(async () => {
    await addPasswordUser(env);
    await addSession(env, 'user-1', 'tok');
  });

  it('sets the new password, keeps this session and signs every other one out', async () => {
    await addSession(env, 'user-1', 'other-device');
    await addPasswordUser(env, { id: 'user-2', email: 'bob@example.com' });
    await addSession(env, 'user-2', 'bob');
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO reset_tokens (token_hash, user_id, email_normalized, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('old-link', 'user-1', 'ann@example.com', Date.now() + 1e6, 1).run();

    const response = await change(GOOD_PASSWORD, NEW_PASSWORD);
    assert.equal(response.status, 200);
    const { user } = await response.json();
    assert.equal(user.email, 'ann@example.com');
    assert.equal(user.has_password, true);
    assert.equal(response.headers.get('Set-Cookie'), null);

    assert.equal(await storedPasswordMatches(NEW_PASSWORD), true);
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), false);
    assert.deepEqual(await sessionIds(),
      [await sha256Hex('bob'), await sha256Hex('tok')].sort());
    assert.deepEqual(await query(env, 'SELECT * FROM reset_tokens'), []);
    assert.equal(services.mail.length, 1);
    assert.deepEqual(services.mail[0].to, ['ann@example.com']);
    assert.match(services.mail[0].subject, /password was changed/);
    assert.ok((await events(env)).includes('password_changed'));
  });

  it('refuses a wrong current password and changes nothing', async () => {
    await addSession(env, 'user-1', 'other-device');
    const response = await change(OTHER_PASSWORD, NEW_PASSWORD);
    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), 'wrong_password');
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), true);
    assert.equal((await sessionIds()).length, 2);
    assert.deepEqual(services.mail, []);
  });

  it('allows 5 wrong current passwords per 15 minutes, then refuses even the right one', async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await change(OTHER_PASSWORD, NEW_PASSWORD, { ip: `198.51.100.${i}` })).status, 403);
    }
    const blocked = await change(GOOD_PASSWORD, NEW_PASSWORD, { ip: '198.51.100.99' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), true);
  });

  it('runs the password rules on the new password without counting it as a wrong guess', async () => {
    const short = await change(GOOD_PASSWORD, 'short');
    assert.equal(short.status, 400);
    assert.equal(await errorCode(short), 'password_too_short');

    const breached = await change(GOOD_PASSWORD, 'password1234');
    assert.equal(breached.status, 400);
    assert.equal(await errorCode(breached), 'password_breached');

    for (let i = 0; i < 4; i++) await change(GOOD_PASSWORD, 'short');
    assert.equal((await change(GOOD_PASSWORD, NEW_PASSWORD)).status, 200);
  });

  it('refuses a request without a session, a malformed body and a switched-off flag', async () => {
    assert.equal((await change(GOOD_PASSWORD, NEW_PASSWORD, { cookie: 'sid=nobody' })).status, 401);

    const malformed = await post(changePassword, env, CHANGE, { password: NEW_PASSWORD },
      { cookie: 'sid=tok' });
    assert.equal(malformed.status, 400);
    assert.equal(await errorCode(malformed), 'invalid_request');

    env.PASSWORD_AUTH_ENABLED = undefined;
    assert.equal((await change(GOOD_PASSWORD, NEW_PASSWORD)).status, 404);
    assert.equal(await storedPasswordMatches(GOOD_PASSWORD), true);
  });

  it('tells an account with only Google that it has no password to change', async () => {
    await addGoogleUser(env, { id: 'google-1', email: 'gia@example.com' });
    await addSession(env, 'google-1', 'google-tok');
    const response = await change('anything at all', NEW_PASSWORD, { cookie: 'sid=google-tok' });
    assert.equal(response.status, 409);
    assert.equal(await errorCode(response), 'no_password');
  });
});

describe('emailing a link to set a password', () => {
  beforeEach(async () => {
    await addGoogleUser(env);
    await addSession(env, 'google-1', 'tok');
  });

  it('sends the account its own reset link, which then sets a password', async () => {
    const response = await requestLink();
    assert.equal(response.status, 202);
    assert.equal(services.mail.length, 1);
    assert.deepEqual(services.mail[0].to, ['ann@example.com']);

    const token = latestToken(services, 'reset_token');
    const done = await post(reset, env, '/api/auth/password/reset', { token, password: NEW_PASSWORD });
    assert.equal(done.status, 200);
    assert.equal((await done.json()).user.has_password, true);
    assert.equal(await storedPasswordMatches(NEW_PASSWORD, 'google-1'), true);
  });

  it('sends at most 3 an hour', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await requestLink()).status, 202);
    assert.equal((await requestLink()).status, 429);
    assert.equal(services.mail.length, 3);
  });

  it('needs a session and the flag', async () => {
    assert.equal((await requestLink({ cookie: 'sid=nobody' })).status, 401);
    env.PASSWORD_AUTH_ENABLED = undefined;
    assert.equal((await requestLink()).status, 404);
    assert.deepEqual(services.mail, []);
  });
});

describe('deleting an account that has a password', () => {
  beforeEach(async () => {
    await addPasswordUser(env);
    await addSession(env, 'user-1', 'tok');
  });

  it('refuses without the password, or with a wrong one, and deletes nothing', async () => {
    const missing = await deleteAccount();
    assert.equal(missing.status, 403);
    assert.equal(await errorCode(missing), 'wrong_password');

    const wrong = await deleteAccount({ password: OTHER_PASSWORD });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.headers.get('Set-Cookie'), null);

    assert.deepEqual(await userIds(), ['user-1']);
    assert.equal((await sessionIds()).length, 1);
  });

  it('deletes the account with the right password', async () => {
    const response = await deleteAccount({ password: GOOD_PASSWORD });
    assert.equal(response.status, 200);
    assert.deepEqual(await userIds(), []);
    assert.deepEqual(await sessionIds(), []);
  });

  it('shares its wrong-password limit with changing the password', async () => {
    for (let i = 0; i < 5; i++) await deleteAccount({ password: OTHER_PASSWORD });
    assert.equal((await deleteAccount({ password: GOOD_PASSWORD })).status, 429);
    assert.equal((await change(GOOD_PASSWORD, NEW_PASSWORD)).status, 429);
    assert.deepEqual(await userIds(), ['user-1']);
  });

  it('still asks for the password with the flag off', async () => {
    env.PASSWORD_AUTH_ENABLED = undefined;
    assert.equal((await deleteAccount()).status, 403);
    assert.equal((await deleteAccount({ password: GOOD_PASSWORD })).status, 200);
  });
});

describe('deleting an account that has only Google', () => {
  it('needs no password', async () => {
    await addGoogleUser(env);
    await addSession(env, 'google-1', 'tok');
    const response = await deleteAccount();
    assert.equal(response.status, 200);
    assert.deepEqual(await userIds(), []);
  });
});
