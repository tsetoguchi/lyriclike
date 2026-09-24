// Password hashing, the password policy, the breached-password check, and the
// rate-limit counters the auth routes are built on.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  DUMMY_HASH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_PROBLEM, PBKDF2_ITERATIONS,
  checkPasswordPolicy, hashPassword, isBreachedPassword, needsRehash, verifyPassword,
} from '../functions/_password.js';
import {
  DAY_MS, HOUR_MS, checkRateLimit, clientIpKey, hitRateLimit, peekRateLimit, rateLimitedResponse,
} from '../functions/_ratelimit.js';
import { rateLimitIp } from '../functions/_shared.js';
import { GOOD_PASSWORD, makeEnv, query, stubServices } from './support/auth-harness.mjs';

const WORKERD_MAX_ITERATIONS = 100_000;

let env;

beforeEach(() => {
  env = makeEnv();
});

// A hash with older parameters, made the way hashPassword makes one.
async function hashWith(password, iterations) {
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey('raw', encoder.encode(env.PASSWORD_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const peppered = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey,
    encoder.encode(password.normalize('NFKC'))));
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  return `pbkdf2-sha256$v1$${iterations}$${b64(salt)}$${b64(bits)}`;
}

describe('password hashing', () => {
  it('never asks for more iterations than workerd allows', () => {
    // Node has no such cap and would not notice; workerd throws.
    assert.ok(PBKDF2_ITERATIONS <= WORKERD_MAX_ITERATIONS);
  });

  it('keeps the dummy hash on the live iteration count', async () => {
    assert.equal(DUMMY_HASH.split('$')[2], String(PBKDF2_ITERATIONS));
    assert.equal(needsRehash(DUMMY_HASH), false);
    assert.equal(await verifyPassword(GOOD_PASSWORD, DUMMY_HASH, env), false);
  });

  it('writes scheme, pepper version, iterations, salt and hash', async () => {
    const stored = await hashPassword(GOOD_PASSWORD, env);
    const parts = stored.split('$');
    assert.equal(parts.length, 5);
    assert.deepEqual(parts.slice(0, 3), ['pbkdf2-sha256', 'v1', String(PBKDF2_ITERATIONS)]);
    assert.doesNotMatch(stored, new RegExp(GOOD_PASSWORD));
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const stored = await hashPassword(GOOD_PASSWORD, env);
    assert.equal(await verifyPassword(GOOD_PASSWORD, stored, env), true);
    assert.equal(await verifyPassword(GOOD_PASSWORD + 'x', stored, env), false);
    assert.equal(await verifyPassword('', stored, env), false);
  });

  it('salts every hash differently', async () => {
    const [a, b] = [await hashPassword(GOOD_PASSWORD, env), await hashPassword(GOOD_PASSWORD, env)];
    assert.notEqual(a, b);
  });

  it('does not verify under a different pepper', async () => {
    const stored = await hashPassword(GOOD_PASSWORD, env);
    assert.equal(await verifyPassword(GOOD_PASSWORD, stored, makeEnv({ PASSWORD_PEPPER: 'other' })), false);
  });

  it('refuses to hash without a pepper', async () => {
    await assert.rejects(hashPassword(GOOD_PASSWORD, makeEnv({ PASSWORD_PEPPER: '' })), /PASSWORD_PEPPER/);
  });

  it('treats canonically equivalent characters as the same password', async () => {
    const composed = 'café au lait';
    const decomposed = 'café au lait';
    const stored = await hashPassword(composed, env);
    assert.equal(await verifyPassword(decomposed, stored, env), true);
  });

  it('still verifies a hash made with older parameters, and flags it for rehash', async () => {
    const old = await hashWith(GOOD_PASSWORD, 1000);
    assert.equal(await verifyPassword(GOOD_PASSWORD, old, env), true);
    assert.equal(needsRehash(old), true);
  });

  it('cannot check a hash that asks for more iterations than allowed', async () => {
    const parts = (await hashPassword(GOOD_PASSWORD, env)).split('$');
    parts[2] = String(PBKDF2_ITERATIONS + 1);
    assert.equal(await verifyPassword(GOOD_PASSWORD, parts.join('$'), env), false);
  });

  it('answers false, not an error, for a malformed or unknown-scheme hash', async () => {
    for (const stored of [null, '', 'plain', 'argon2id$v1$1$a$b', 'pbkdf2-sha256$v9$1000$AA==$AA==']) {
      assert.equal(await verifyPassword(GOOD_PASSWORD, stored, env), false, String(stored));
    }
    assert.equal(needsRehash('plain'), true);
    assert.equal(needsRehash(await hashPassword(GOOD_PASSWORD, env)), false);
  });
});

describe('password policy', () => {
  it('accepts a long enough password', () => {
    assert.equal(checkPasswordPolicy(GOOD_PASSWORD, 'ann@example.com'), null);
  });

  it('counts characters, not bytes, against the minimum', () => {
    assert.equal(checkPasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH - 1), 'x@example.com'),
      PASSWORD_PROBLEM.TOO_SHORT);
    assert.equal(checkPasswordPolicy('é'.repeat(MIN_PASSWORD_LENGTH), 'x@example.com'), null);
  });

  it('refuses a password over the maximum', () => {
    assert.equal(checkPasswordPolicy('a'.repeat(MAX_PASSWORD_LENGTH + 1), 'x@example.com'),
      PASSWORD_PROBLEM.TOO_LONG);
    assert.equal(checkPasswordPolicy('a'.repeat(MAX_PASSWORD_LENGTH), 'x@example.com'), null);
  });

  it("refuses a password that contains the email's local part, in any case", () => {
    assert.equal(checkPasswordPolicy('my-Writer-pass1', 'writer@example.com'), PASSWORD_PROBLEM.HAS_EMAIL);
  });

  it('ignores a local part too short to mean anything', () => {
    assert.equal(checkPasswordPolicy('a very good password', 'a@example.com'), null);
  });

  it('applies the length rule after normalisation, and rejects non-strings', () => {
    assert.equal(checkPasswordPolicy(undefined, 'x@example.com'), PASSWORD_PROBLEM.TOO_SHORT);
    assert.equal(checkPasswordPolicy('ﬁﬁﬁﬁ', 'x@example.com'), null);
  });
});

describe('breached-password check', () => {
  let services;

  beforeEach(() => {
    services = stubServices({ breached: ['password1234'] });
  });

  afterEach(() => {
    services.restore();
  });

  it('flags a password found in the range response', async () => {
    assert.equal(await isBreachedPassword('password1234'), true);
    assert.equal(await isBreachedPassword('a-fresh-unlikely-phrase'), false);
  });

  it('sends only a five character prefix, asks for padding, and ignores padded rows', async () => {
    await isBreachedPassword('password1234');
    assert.equal(services.hibpPrefixes[0].length, 5);
    assert.equal(services.hibpHeaders[0]['Add-Padding'], 'true');
    // The stand-in always returns a zero-count padding row; it must not match.
    assert.equal(await isBreachedPassword('a-fresh-unlikely-phrase'), false);
  });

  it('fails open when the service is down, slow or broken', async () => {
    services.hibpDown = true;
    assert.equal(await isBreachedPassword('password1234'), false);

    services.restore();
    globalThis.fetch = () => Promise.reject(new Error('network'));
    assert.equal(await isBreachedPassword('password1234'), false);
  });
});

describe('rate limits', () => {
  it('allows up to the limit and refuses the next call with a retry time', async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await checkRateLimit(env, 'k', 3, HOUR_MS)).allowed, true);
    }
    const refused = await checkRateLimit(env, 'k', 3, HOUR_MS);
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= HOUR_MS / 1000);

    const response = rateLimitedResponse(refused.retryAfterSeconds);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), String(refused.retryAfterSeconds));
    assert.equal((await response.json()).error.code, 'rate_limited');
  });

  it('keeps separate keys apart', async () => {
    await checkRateLimit(env, 'a', 1, HOUR_MS);
    assert.equal((await checkRateLimit(env, 'a', 1, HOUR_MS)).allowed, false);
    assert.equal((await checkRateLimit(env, 'b', 1, HOUR_MS)).allowed, true);
  });

  it('starts a fresh window once the old one has run out', async () => {
    await checkRateLimit(env, 'k', 1, HOUR_MS);
    await checkRateLimit(env, 'k', 1, HOUR_MS);
    await env.lyricalmiracle_db.prepare('UPDATE rate_limits SET window_start = ? WHERE key = ?')
      .bind(Date.now() - HOUR_MS - 1, 'k').run();

    assert.equal((await checkRateLimit(env, 'k', 1, HOUR_MS)).allowed, true);
    const [row] = await query(env, 'SELECT count FROM rate_limits WHERE key = ?', 'k');
    assert.equal(row.count, 1);
  });

  it('peeks without counting', async () => {
    assert.equal((await peekRateLimit(env, 'k', 2, HOUR_MS)).allowed, true);
    assert.deepEqual(await query(env, 'SELECT key FROM rate_limits'), []);

    await hitRateLimit(env, 'k', HOUR_MS);
    assert.equal((await peekRateLimit(env, 'k', 2, HOUR_MS)).allowed, true);
    await hitRateLimit(env, 'k', HOUR_MS);
    const blocked = await peekRateLimit(env, 'k', 2, HOUR_MS);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds >= 1);
  });

  it('counts atomically under concurrent calls', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => checkRateLimit(env, 'k', 4, DAY_MS)));
    assert.equal(results.filter(r => r.allowed).length, 4);
  });

  it('keys IPv4 on the full address', () => {
    assert.equal(rateLimitIp('203.0.113.7'), '203.0.113.7');
    assert.notEqual(rateLimitIp('203.0.113.7'), rateLimitIp('203.0.113.8'));
    assert.equal(rateLimitIp('::ffff:203.0.113.7'), '203.0.113.7');
  });

  it('keys IPv6 on the /64, so one client rotating inside it shares a key', () => {
    const a = rateLimitIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const b = rateLimitIp('2001:0db8:0001:0002::1');
    assert.equal(a, b);
    assert.notEqual(a, rateLimitIp('2001:db8:1:3::1'));
    assert.equal(rateLimitIp('not an ip'), null);
  });

  it('shares one limit across a /64 and falls back to a fixed key with no IP', async () => {
    const request = ip => new Request('https://lyriclike.com/', ip ? { headers: { 'CF-Connecting-IP': ip } } : {});
    assert.equal(clientIpKey(request('2001:db8::1')), clientIpKey(request('2001:db8::ffff')));
    assert.equal(clientIpKey(request(null)), 'unknown');
  });
});
