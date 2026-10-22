// Per-account limits on pages and people per page: what /api/me reports from
// the site settings and the user_limits table.
//
//   node --test test/limits.test.mjs

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as account from '../functions/api/account.js';
import * as me from '../functions/api/me.js';
import { addGoogleUser, addSession, BASE_URL, makeEnv, query } from './support/auth-harness.mjs';

const OWNER_ID = 'owner-1';
const OWNER_TOKEN = 'owner-token';
const OTHER_ID = 'other-1';
const OTHER_EMAIL = 'bea@example.com';

async function setUp(settings = {}) {
  const env = makeEnv(settings);
  await addGoogleUser(env, { id: OWNER_ID });
  await addSession(env, OWNER_ID, OWNER_TOKEN);
  return env;
}

function ownerRequest(path, method = 'GET') {
  return new Request(BASE_URL + path, { method, headers: { Cookie: `sid=${OWNER_TOKEN}` } });
}

async function getMe(env) {
  const pending = [];
  const response = await me.onRequestGet({
    request: ownerRequest('/api/me'), env, waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  assert.equal(response.status, 200);
  return response.json();
}

async function addLyrics(env, userId, count) {
  for (let i = 0; i < count; i++) {
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES (?, ?, ?, ?, 1, 1)'
    ).bind(`${userId}-page-${i}`, userId, 'Title', 'body').run();
  }
}

async function shareWithOwner(env, lyricId) {
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, ' +
    'created_at) VALUES (?, ?, ?, ?, 1, 0, 1)'
  ).bind(lyricId, 'ann@example.com', 'ann@example.com', OWNER_ID).run();
}

async function setOwnerLimits(env, pageLimit, peopleLimit) {
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO user_limits (user_id, page_limit, people_limit) VALUES (?, ?, ?)'
  ).bind(OWNER_ID, pageLimit, peopleLimit).run();
}

describe('limits in /api/me', () => {
  it('no settings: reports page_count and null limits, limits_enforced false', async () => {
    const env = await setUp();
    await addLyrics(env, OWNER_ID, 2);
    const body = await getMe(env);
    assert.equal(body.page_count, 2);
    assert.equal(body.page_limit, null);
    assert.equal(body.people_limit, null);
    assert.equal(body.limits_enforced, false);
  });

  it('DEFAULT_PAGE_LIMIT=5, DEFAULT_PEOPLE_LIMIT=1: reports 5 and 1', async () => {
    const env = await setUp({ DEFAULT_PAGE_LIMIT: '5', DEFAULT_PEOPLE_LIMIT: '1' });
    const body = await getMe(env);
    assert.equal(body.page_limit, 5);
    assert.equal(body.people_limit, 1);
  });

  it('LIMITS_ENFORCED=on reports limits_enforced true', async () => {
    const env = await setUp({ LIMITS_ENFORCED: 'on' });
    assert.equal((await getMe(env)).limits_enforced, true);
  });

  it('a user_limits row of -1 overrides the default to null', async () => {
    const env = await setUp({ DEFAULT_PAGE_LIMIT: '5', DEFAULT_PEOPLE_LIMIT: '1' });
    await setOwnerLimits(env, -1, -1);
    const body = await getMe(env);
    assert.equal(body.page_limit, null);
    assert.equal(body.people_limit, null);
  });

  it('a user_limits row of 20 overrides the default; a NULL column keeps it', async () => {
    const env = await setUp({ DEFAULT_PAGE_LIMIT: '5', DEFAULT_PEOPLE_LIMIT: '1' });
    await setOwnerLimits(env, 20, null);
    const body = await getMe(env);
    assert.equal(body.page_limit, 20);
    assert.equal(body.people_limit, 1);
  });

  it('bad settings mean no limit and not enforced, never 0 or on', async () => {
    const env = await setUp({
      DEFAULT_PAGE_LIMIT: 'five', DEFAULT_PEOPLE_LIMIT: '-3', LIMITS_ENFORCED: 'true',
    });
    const body = await getMe(env);
    assert.equal(body.page_limit, null);
    assert.equal(body.people_limit, null);
    assert.equal(body.limits_enforced, false);
  });

  it('empty and fractional settings mean no limit', async () => {
    const env = await setUp({ DEFAULT_PAGE_LIMIT: '', DEFAULT_PEOPLE_LIMIT: '1.5' });
    const body = await getMe(env);
    assert.equal(body.page_limit, null);
    assert.equal(body.people_limit, null);
  });

  it('a 0 setting is a real limit of 0', async () => {
    const env = await setUp({ DEFAULT_PAGE_LIMIT: '0' });
    assert.equal((await getMe(env)).page_limit, 0);
  });

  it('page_count counts only my own pages, not pages shared with me', async () => {
    const env = await setUp();
    await addGoogleUser(env, { id: OTHER_ID, email: OTHER_EMAIL });
    await addLyrics(env, OWNER_ID, 2);
    await addLyrics(env, OTHER_ID, 3);
    for (let i = 0; i < 3; i++) await shareWithOwner(env, `${OTHER_ID}-page-${i}`);
    assert.equal((await getMe(env)).page_count, 2);
  });
});

describe('limits and account delete', () => {
  it('deleting the account removes its user_limits row', async () => {
    const env = await setUp();
    await setOwnerLimits(env, 20, null);
    const response = await account.onRequestDelete({
      request: ownerRequest('/api/account', 'DELETE'), env,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await query(env, 'SELECT * FROM user_limits'), []);
  });
});
