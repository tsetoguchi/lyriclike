// The apps' pages run on localhost, so the Turnstile widget there is issued
// for that hostname. The server accepts it only from an app, and the website
// still needs its own hostname.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as forgot from '../functions/api/auth/password/forgot.js';
import * as signup from '../functions/api/auth/signup.js';
import {
  GOOD_PASSWORD, addPasswordUser, makeEnv, post, stubServices, turnstileToken,
} from './support/auth-harness.mjs';

const SIGNUP = '/api/auth/signup';
const FORGOT = '/api/auth/password/forgot';
const IOS_ORIGIN = 'capacitor://localhost';
const ANDROID_ORIGIN = 'https://localhost';
const APP_HEADERS = { 'X-LyricLike-Client': 'app' };
const ACCEPTED = 202;

let env;
let services;

beforeEach(() => {
  env = makeEnv();
  services = stubServices();
  services.turnstileHostname = 'localhost';
});

afterEach(() => {
  services.restore();
});

function signUp(headers) {
  return post(signup, env, SIGNUP, {
    email: 'ann@example.com', password: GOOD_PASSWORD, name: 'Ann',
    turnstile: turnstileToken('signup'),
  }, { headers });
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

describe('Turnstile on signup from an app', () => {
  for (const origin of [IOS_ORIGIN, ANDROID_ORIGIN]) {
    it(`accepts a token issued for localhost from ${origin}`, async () => {
      const response = await signUp({ Origin: origin, ...APP_HEADERS });
      assert.equal(response.status, ACCEPTED);
    });
  }

  it('refuses it from the website', async () => {
    assert.equal(await errorCode(await signUp({})), 'captcha_failed');
  });

  it('refuses it with the marker header but no app origin', async () => {
    const response = await signUp({ Origin: 'https://evil.example', ...APP_HEADERS });
    assert.equal(await errorCode(response), 'captcha_failed');
  });

  it('refuses it from an app origin without the marker header', async () => {
    assert.equal(await errorCode(await signUp({ Origin: IOS_ORIGIN })), 'captcha_failed');
  });

  it('still refuses another hostname from an app', async () => {
    services.turnstileHostname = 'evil.example';
    const response = await signUp({ Origin: IOS_ORIGIN, ...APP_HEADERS });
    assert.equal(await errorCode(response), 'captcha_failed');
  });

  it('still needs the right action', async () => {
    const response = await post(signup, env, SIGNUP, {
      email: 'ann@example.com', password: GOOD_PASSWORD, name: 'Ann',
      turnstile: turnstileToken('forgot'),
    }, { headers: { Origin: IOS_ORIGIN, ...APP_HEADERS } });
    assert.equal(await errorCode(response), 'captcha_failed');
  });
});

describe('Turnstile on forgot-password from an app', () => {
  it('accepts a token issued for localhost', async () => {
    await addPasswordUser(env);
    const response = await post(forgot, env, FORGOT, {
      email: 'ann@example.com', turnstile: turnstileToken('forgot'),
    }, { headers: { Origin: IOS_ORIGIN, ...APP_HEADERS } });
    assert.equal(response.status, ACCEPTED);
  });

  it('refuses it from the website', async () => {
    const response = await post(forgot, env, FORGOT, {
      email: 'ann@example.com', turnstile: turnstileToken('forgot'),
    });
    assert.equal(await errorCode(response), 'captcha_failed');
  });
});
