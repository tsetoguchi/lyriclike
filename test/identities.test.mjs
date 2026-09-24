// Sign-in methods live in `identities`, apart from the account. Covers the
// 0004 migration that moved them there and the Google callback's linking
// ladder.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as callback from '../functions/api/auth/google/callback.js';
import { normalizeEmail, sha256Hex } from '../functions/_shared.js';
import { createFakeD1 } from './support/fake-d1.mjs';

const BASE_URL = 'https://lyriclike.com';
const HASH = 'pbkdf2-sha256$v1$100000$salt$hash';
const INSERT_IDENTITY =
  'INSERT INTO identities (id, user_id, provider, provider_subject, created_at) VALUES (?, ?, ?, ?, ?)';

let env;

function database() {
  return env.lyricalmiracle_db;
}

async function rows(db, sql, ...params) {
  return (await db.prepare(sql).bind(...params).all()).results;
}

describe('normalizeEmail', () => {
  const cases = [
    ['  Writer@Example.COM ', 'writer@example.com'],
    ['a.b+tag@gmail.com', 'a.b+tag@gmail.com'],
    ['no-at-sign', null],
    ['two@@example.com', null],
    ['a@b@c', null],
    ['@example.com', null],
    ['writer@', null],
    ['x'.repeat(250) + '@e.co', null],
    [undefined, null],
    [42, null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} becomes ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizeEmail(input), expected);
    });
  }
});

describe('migration 0004', () => {
  const SEEDED = [
    ['u1', 'sub-1', 'Ann@Example.com'],
    ['u2', 'sub-2', 'bob@example.com'],
  ];
  let db;

  beforeEach(async () => {
    db = createFakeD1({ through: '0003' });
    for (const [id, sub, email] of SEEDED) {
      await db.prepare(
        'INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(id, sub, email, id, 1000).run();
      await db.prepare(
        'INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(`lyric-${id}`, id, 'T', 'B', 1, 1).run();
      await db.prepare(
        'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
      ).bind(`session-${id}`, id, 9e15, 1).run();
    }
    db.migrateTo();
  });

  it('keeps every user, and gives each one a Google identity', async () => {
    const users = await rows(db, 'SELECT id FROM users ORDER BY id');
    const identities = await rows(db,
      'SELECT user_id, provider, provider_subject FROM identities ORDER BY user_id');

    assert.equal(users.length, SEEDED.length);
    assert.deepEqual(identities, SEEDED.map(([id, sub]) =>
      ({ user_id: id, provider: 'google', provider_subject: sub })));
  });

  it('keeps the email as entered and adds a lowercased key', async () => {
    const [ann] = await rows(db, 'SELECT * FROM users WHERE id = ?', 'u1');
    assert.equal(ann.email, 'Ann@Example.com');
    assert.equal(ann.email_normalized, 'ann@example.com');
    assert.equal(ann.created_at, 1000);
  });

  it('leaves every user without a password', async () => {
    const withPassword = await rows(db,
      'SELECT id FROM users WHERE password_hash IS NOT NULL OR password_updated_at IS NOT NULL');
    assert.deepEqual(withPassword, []);
  });

  it('leaves lyrics and sessions with the same owner', async () => {
    assert.deepEqual(await rows(db, 'SELECT id, user_id FROM lyrics ORDER BY id'),
      SEEDED.map(([id]) => ({ id: `lyric-${id}`, user_id: id })));
    assert.deepEqual(await rows(db, 'SELECT id, user_id FROM sessions ORDER BY id'),
      SEEDED.map(([id]) => ({ id: `session-${id}`, user_id: id })));
  });

  it('drops google_sub and enforces unique addresses and identities', async () => {
    const columns = (await rows(db, "SELECT name FROM pragma_table_info('users')"))
      .map(row => row.name);
    assert.ok(!columns.includes('google_sub'));

    await assert.rejects(db.prepare(
      'INSERT INTO users (id, email, email_normalized, created_at) VALUES (?, ?, ?, ?)'
    ).bind('u3', 'ANN@example.com', 'ann@example.com', 1).run());
    await assert.rejects(db.prepare(INSERT_IDENTITY).bind('i3', 'u2', 'google', 'sub-1', 1).run());
  });

  it('leaves the indexes on the tables it emptied and refilled', async () => {
    const names = (await rows(db, "SELECT name FROM sqlite_master WHERE type = 'index'"))
      .map(row => row.name);
    for (const name of ['lyrics_user', 'sessions_user', 'identities_user', 'users_email_normalized']) {
      assert.ok(names.includes(name), name);
    }
    const leftovers = await rows(db, "SELECT name FROM sqlite_master WHERE name LIKE '%_keep'");
    assert.deepEqual(leftovers, []);
  });

  it('leaves the foreign keys intact', async () => {
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
    await assert.rejects(db.prepare(INSERT_IDENTITY)
      .bind('i4', 'no-such-user', 'google', 'sub-9', 1).run());
  });
});

describe('Google sign-in callback: linking ladder', () => {
  const originalFetch = globalThis.fetch;
  let profile;
  let sentMail;

  beforeEach(() => {
    env = {
      lyricalmiracle_db: createFakeD1(),
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      OAUTH_REDIRECT_URL: BASE_URL + '/api/auth/google/callback',
      RESEND_API_KEY: 'resend-key',
      EMAIL_FROM: 'LyricLike <noreply@lyriclike.com>',
      APP_BASE_URL: BASE_URL,
    };
    profile = { sub: 'sub-a', email: 'Ann@Example.com', email_verified: true, name: 'Ann' };
    sentMail = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.resend.com')) {
        sentMail.push(JSON.parse(init.body));
        return Response.json({ id: 'email-id' });
      }
      return String(url).includes('oauth2.googleapis.com')
        ? Response.json({ access_token: 'access' })
        : Response.json(profile);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const query = (sql, ...params) => rows(database(), sql, ...params);
  const events = async () => (await query('SELECT event FROM logs ORDER BY rowid'))
    .map(row => row.event);

  async function signIn() {
    const request = new Request(`${BASE_URL}/api/auth/google/callback?code=abc&state=s`, {
      headers: { Cookie: 'oauth_state=s; oauth_verifier=v' },
    });
    const pending = [];
    const response = await callback.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    return response;
  }

  async function addLocalAccount({ email = 'ann@example.com', passwordHash = null } = {}) {
    await database().prepare(
      'INSERT INTO users (id, email, email_normalized, name, password_hash, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('local', email, email, 'Local Ann', passwordHash, 1).run();
  }

  it('1. signs in the account that already has this Google identity', async () => {
    await signIn();
    const [{ id }] = await query('SELECT id FROM users');

    const response = await signIn();
    assert.equal(response.status, 302);
    assert.equal((await query('SELECT id FROM users')).length, 1);
    assert.deepEqual((await query('SELECT user_id FROM sessions')).map(row => row.user_id), [id, id]);
    assert.deepEqual(await events(), ['signup', 'login']);
  });

  it('1. refreshes the name but never the stored email', async () => {
    await signIn();
    profile = { ...profile, email: 'new-address@example.com', name: 'Ann Renamed' };
    await signIn();

    const [user] = await query('SELECT email, email_normalized, name FROM users');
    assert.equal(user.email, 'Ann@Example.com');
    assert.equal(user.email_normalized, 'ann@example.com');
    assert.equal(user.name, 'Ann Renamed');
    assert.deepEqual(await events(), ['signup', 'oauth_email_differs', 'login']);
  });

  it('1. does not log a difference when only the case changed', async () => {
    await signIn();
    profile = { ...profile, email: 'ANN@example.com' };
    await signIn();
    assert.deepEqual(await events(), ['signup', 'login']);
  });

  it('1. lets a known identity in even if Google stops vouching for the address', async () => {
    await signIn();
    profile = { ...profile, email_verified: false };
    assert.equal((await signIn()).status, 302);
  });

  it('2. refuses an unverified address with a page, not a bare 400', async () => {
    for (const email_verified of [false, undefined, 'true']) {
      profile = { ...profile, email_verified };
      const response = await signIn();
      const cookies = response.headers.get('Set-Cookie');

      assert.equal(response.status, 403);
      assert.match(response.headers.get('Content-Type'), /text\/html/);
      assert.match(await response.text(), /verified/);
      assert.match(cookies, /oauth_state=;/);
      assert.doesNotMatch(cookies, /sid=[0-9a-f]/);
    }
    assert.deepEqual(await query('SELECT id FROM users'), []);
    assert.deepEqual(await query('SELECT id FROM sessions'), []);
  });

  it('2. refuses an unverified address even when a local account holds it', async () => {
    await addLocalAccount();
    profile = { ...profile, email_verified: false };

    assert.equal((await signIn()).status, 403);
    assert.deepEqual(await query('SELECT id FROM identities'), []);
  });

  it('3. creates a user and an identity for a new verified address', async () => {
    const response = await signIn();
    const [user] = await query('SELECT * FROM users');
    const [identity] = await query('SELECT * FROM identities');

    assert.equal(response.status, 302);
    assert.equal(user.email, 'Ann@Example.com');
    assert.equal(user.email_normalized, 'ann@example.com');
    assert.equal(user.password_hash, null);
    assert.equal(identity.user_id, user.id);
    assert.equal(identity.provider_subject, 'sub-a');
    assert.deepEqual(await events(), ['signup']);
  });

  it('3. falls back to the account a concurrent sign-in created first', async () => {
    await addLocalAccount();
    // The lookup ran before the other request committed, so it saw nothing;
    // the insert then hits the unique address.
    const realPrepare = database().prepare.bind(database());
    let lookups = 0;
    database().prepare = (text) => {
      if (text.includes('FROM users WHERE email_normalized') && lookups++ === 0) {
        return realPrepare('SELECT id, password_hash FROM users WHERE email_normalized = ? AND 0');
      }
      return realPrepare(text);
    };

    const response = await signIn();

    assert.equal(response.status, 302);
    assert.equal((await query('SELECT id FROM users')).length, 1);
    assert.deepEqual((await query('SELECT user_id FROM sessions')).map(row => row.user_id), ['local']);
  });

  it('4. links Google to a local account with the same verified address', async () => {
    await addLocalAccount();
    const response = await signIn();

    assert.equal(response.status, 302);
    assert.equal((await query('SELECT id FROM users')).length, 1);
    assert.deepEqual(await query('SELECT user_id, provider_subject FROM identities'),
      [{ user_id: 'local', provider_subject: 'sub-a' }]);
    assert.equal((await query('SELECT user_id FROM sessions'))[0].user_id, 'local');
    assert.deepEqual(await events(), ['oauth_linked']);
    assert.deepEqual(sentMail, []);
  });

  it('4. tells the owner of a password account, with a live reset link', async () => {
    await addLocalAccount({ passwordHash: HASH });
    await signIn();

    assert.equal(sentMail.length, 1);
    assert.deepEqual(sentMail[0].to, ['ann@example.com']);
    assert.match(sentMail[0].subject, /Google sign-in was added/);
    const [, token] = /#reset_token=([0-9a-f]{64})/.exec(sentMail[0].text);
    const stored = await query('SELECT token_hash, user_id, expires_at FROM reset_tokens');
    assert.deepEqual(stored.map(row => row.user_id), ['local']);
    assert.equal(stored[0].token_hash, await sha256Hex(token));
    assert.ok(stored[0].expires_at > Date.now());
  });

  it('4. matches the address whatever its case, and keeps the stored copy', async () => {
    await addLocalAccount({ email: 'ann@example.com' });
    profile = { ...profile, email: '  ANN@EXAMPLE.COM ' };
    await signIn();

    assert.equal((await query('SELECT id FROM users')).length, 1);
    assert.equal((await query('SELECT email FROM users'))[0].email, 'ann@example.com');
  });

  it('4. does not treat a Gmail dot or plus tag as the same address', async () => {
    await addLocalAccount({ email: 'ann@example.com' });
    profile = { ...profile, email: 'a.nn+news@example.com' };
    await signIn();
    assert.equal((await query('SELECT id FROM users')).length, 2);
  });

  it('4. signs in a linked identity directly the second time, password untouched', async () => {
    await addLocalAccount({ passwordHash: HASH });
    await signIn();
    await signIn();

    assert.deepEqual(await events(), ['oauth_linked', 'login']);
    assert.equal((await query('SELECT id FROM identities')).length, 1);
    assert.equal((await query('SELECT password_hash FROM users'))[0].password_hash, HASH);
  });
});
