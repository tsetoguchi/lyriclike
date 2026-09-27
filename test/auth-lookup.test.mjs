// The email step of the sign-in modal: what comes next for an address, and
// the limits that keep it from being a free list of who has an account.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as lookup from '../functions/api/auth/lookup.js';
import { hashPassword } from '../functions/_password.js';
import {
  GOOD_PASSWORD, addGoogleUser, addPasswordUser, makeEnv, post, stubServices, turnstileToken,
} from './support/auth-harness.mjs';

const LOOKUP = '/api/auth/lookup';

let env;
let services;

beforeEach(() => {
  env = makeEnv();
  services = stubServices();
});

afterEach(() => {
  services.restore();
});

function lookUp(body = { email: 'ann@example.com' }, options = {}) {
  return post(lookup, env, LOOKUP, body, options);
}

async function nextStep(body, options) {
  return (await (await lookUp(body, options)).json()).next;
}

describe('email lookup', () => {
  it('asks for a password when the account has one', async () => {
    await addPasswordUser(env);
    assert.equal(await nextStep(), 'password');
  });

  it('asks for a password when a Google account also has one', async () => {
    await addGoogleUser(env, { id: 'g1' });
    await env.lyricalmiracle_db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(GOOD_PASSWORD, env), 'g1').run();
    assert.equal(await nextStep(), 'password');
  });

  it('points a Google-only account to Google', async () => {
    await addGoogleUser(env);
    assert.equal(await nextStep(), 'google');
  });

  it('offers signup for an address with no account', async () => {
    assert.equal(await nextStep(), 'sign-up');
  });

  it('matches the address whatever its case or surrounding spaces', async () => {
    await addPasswordUser(env);
    assert.equal(await nextStep({ email: '  ANN@Example.com ' }), 'password');
  });

  it('refuses a body with no usable email', async () => {
    for (const body of [{}, { email: 42 }, { email: 'not an email' }, 'nope']) {
      const response = await lookUp(body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'invalid_email');
    }
  });

  it('asks for Turnstile after 20 lookups from one IP, and accepts a good token', async () => {
    for (let i = 0; i < 20; i++) assert.equal((await lookUp()).status, 200);

    const refused = await lookUp();
    assert.equal(refused.status, 428);
    assert.equal((await refused.json()).error.code, 'captcha_required');
    assert.equal((await lookUp({ email: 'ann@example.com', turnstile: turnstileToken('login') })).status, 428);
    assert.equal((await lookUp({ email: 'ann@example.com', turnstile: turnstileToken('lookup') })).status, 200);
  });

  it('counts each IP on its own', async () => {
    for (let i = 0; i < 21; i++) await lookUp();
    assert.equal((await lookUp(undefined, { ip: '198.51.100.9' })).status, 200);
  });

  it('stops one IP after 100 lookups an hour, even with Turnstile', async () => {
    const body = { email: 'ann@example.com', turnstile: turnstileToken('lookup') };
    for (let i = 0; i < 100; i++) assert.equal((await lookUp(body)).status, 200);
    const refused = await lookUp(body);
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get('Retry-After')) > 0);
  });
});
