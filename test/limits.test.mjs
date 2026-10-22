// Per-account limits on pages and people per page: what /api/me reports from
// the site settings and the user_limits table.
//
//   node --test test/limits.test.mjs

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as account from '../functions/api/account.js';
import * as lyricById from '../functions/api/lyrics/[id].js';
import * as shares from '../functions/api/lyrics/[id]/shares.js';
import * as me from '../functions/api/me.js';
import {
  addGoogleUser, addSession, BASE_URL, makeEnv, query, stubServices,
} from './support/auth-harness.mjs';

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

const NEW_PAGE = 'new-page';
const SHARED_PAGE = `${OWNER_ID}-page-0`;
const MAX_PEOPLE_PER_PAGE = 25;
const OVER_LIMIT = 402;

// Calls a handler as the owner, the way Pages does, and waits for its
// waitUntil work.
async function callAsOwner(env, handler, method, path, { json, id } = {}) {
  const request = new Request(BASE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `sid=${OWNER_TOKEN}` },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const pending = [];
  const name = `onRequest${method[0]}${method.slice(1).toLowerCase()}`;
  const response = await handler[name]({
    request, env, params: { id }, waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  return response;
}

function createPage(env, id = NEW_PAGE) {
  return callAsOwner(env, lyricById, 'PUT', `/api/lyrics/${id}`, { json: { body: 'words' }, id });
}

function savePage(env, id, json) {
  return callAsOwner(env, lyricById, 'PUT', `/api/lyrics/${id}`, { json, id });
}

function renamePage(env, id) {
  return callAsOwner(env, lyricById, 'PATCH', `/api/lyrics/${id}`, { json: { title: 'New' }, id });
}

function deletePage(env, id) {
  return callAsOwner(env, lyricById, 'DELETE', `/api/lyrics/${id}`, { id });
}

function sharePage(env, email, id = SHARED_PAGE) {
  return callAsOwner(env, shares, 'POST', `/api/lyrics/${id}/shares`, { json: { email }, id });
}

async function addPeople(env, lyricId, count) {
  for (let i = 0; i < count; i++) {
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO lyric_shares (lyric_id, email_normalized, email, had_account, emailed, ' +
      'created_at) VALUES (?, ?, ?, 0, 0, ?)'
    ).bind(lyricId, `p${i}@example.com`, `p${i}@example.com`, i + 1).run();
  }
}

async function ownPageCount(env) {
  const [row] = await query(env, 'SELECT count(*) AS n FROM lyrics WHERE user_id = ?', OWNER_ID);
  return row.n;
}

describe('the page cap', () => {
  const ENFORCED = { DEFAULT_PAGE_LIMIT: '5', LIMITS_ENFORCED: 'on' };

  it('switch off, at 5 of 5: a new page is still created (200)', async () => {
    const env = await setUp({ DEFAULT_PAGE_LIMIT: '5' });
    await addLyrics(env, OWNER_ID, 5);
    assert.equal((await createPage(env)).status, 200);
    assert.equal(await ownPageCount(env), 6);
  });

  it('switch on, at 5 of 5: a new page gets 402 and no row is written', async () => {
    const env = await setUp(ENFORCED);
    await addLyrics(env, OWNER_ID, 5);
    const response = await createPage(env);
    assert.equal(response.status, OVER_LIMIT);
    assert.deepEqual(await response.json(), { error: 'page_limit', limit: 5 });
    assert.equal(await ownPageCount(env), 5);
  });

  it('switch on, 7 pages (over): saving, renaming and deleting an old page all work', async () => {
    const env = await setUp(ENFORCED);
    await addLyrics(env, OWNER_ID, 7);
    const saved = await savePage(env, SHARED_PAGE, { body: 'more words', base_revision: 0 });
    assert.equal(saved.status, 200);
    assert.equal((await renamePage(env, SHARED_PAGE)).status, 200);
    assert.equal((await deletePage(env, SHARED_PAGE)).status, 204);
    assert.equal(await ownPageCount(env), 6);
  });

  it('switch on, at 4 of 5: two creates in a row → first 200, second 402', async () => {
    const env = await setUp(ENFORCED);
    await addLyrics(env, OWNER_ID, 4);
    assert.equal((await createPage(env, 'first')).status, 200);
    assert.equal((await createPage(env, 'second')).status, OVER_LIMIT);
  });

  it('switch on, at 5 of 5: a create retried on an id I already own is not a 402', async () => {
    const env = await setUp(ENFORCED);
    await addLyrics(env, OWNER_ID, 5);
    assert.equal((await createPage(env, SHARED_PAGE)).status, 200);
  });

  it("switch on, at 5 of 5: a create on someone else's id is 404, not 402", async () => {
    const env = await setUp(ENFORCED);
    await addGoogleUser(env, { id: OTHER_ID, email: OTHER_EMAIL });
    await addLyrics(env, OWNER_ID, 5);
    await addLyrics(env, OTHER_ID, 1);
    assert.equal((await createPage(env, `${OTHER_ID}-page-0`)).status, 404);
  });

  it('switch on, 5 pages shared with me and none of my own: I can create', async () => {
    const env = await setUp(ENFORCED);
    await addGoogleUser(env, { id: OTHER_ID, email: OTHER_EMAIL });
    await addLyrics(env, OTHER_ID, 5);
    for (let i = 0; i < 5; i++) await shareWithOwner(env, `${OTHER_ID}-page-${i}`);
    assert.equal((await createPage(env)).status, 200);
  });
});

describe('the people cap', () => {
  let services;
  beforeEach(() => { services = stubServices(); });
  afterEach(() => services.restore());

  async function setUpSharing(settings) {
    const env = await setUp({ LIVE_EDITING: 'on', ...settings });
    await addLyrics(env, OWNER_ID, 1);
    return env;
  }

  it('switch on, people limit 1: second person gets 402; the first is still on', async () => {
    const env = await setUpSharing({ DEFAULT_PEOPLE_LIMIT: '1', LIMITS_ENFORCED: 'on' });
    assert.equal((await sharePage(env, 'one@example.com')).status, 200);
    const response = await sharePage(env, 'two@example.com');
    assert.equal(response.status, OVER_LIMIT);
    assert.deepEqual(await response.json(), { error: 'people_limit', limit: 1 });
    const people = await query(env, 'SELECT email FROM lyric_shares');
    assert.deepEqual(people.map(row => row.email), ['one@example.com']);
  });

  it('switch off, people limit 1: second person is added', async () => {
    const env = await setUpSharing({ DEFAULT_PEOPLE_LIMIT: '1' });
    assert.equal((await sharePage(env, 'one@example.com')).status, 200);
    assert.equal((await sharePage(env, 'two@example.com')).status, 200);
  });

  it('switch on, people limit -1 (row): 25 people → 409 page_full still', async () => {
    const env = await setUpSharing({ DEFAULT_PEOPLE_LIMIT: '1', LIMITS_ENFORCED: 'on' });
    await setOwnerLimits(env, null, -1);
    await addPeople(env, SHARED_PAGE, MAX_PEOPLE_PER_PAGE);
    const response = await sharePage(env, 'late@example.com');
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'page_full');
  });

  it('re-sharing someone already on the page at the limit answers already_shared', async () => {
    const env = await setUpSharing({ DEFAULT_PEOPLE_LIMIT: '1', LIMITS_ENFORCED: 'on' });
    assert.equal((await sharePage(env, 'one@example.com')).status, 200);
    const response = await sharePage(env, 'one@example.com');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'already_shared');
  });
});

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

describe('the extension script in /api/me', () => {
  it('EXTENSION_SCRIPT_URL unset reports null', async () => {
    const env = await setUp();
    assert.equal((await getMe(env)).extension_script_url, null);
  });

  it('a same-origin path is reported as is', async () => {
    const env = await setUp({ EXTENSION_SCRIPT_URL: '/ext-test/site.js' });
    assert.equal((await getMe(env)).extension_script_url, '/ext-test/site.js');
  });

  it('another origin is reported as null', async () => {
    for (const url of ['https://evil.example/x.js', '//evil.example/x.js', '/\\evil.example/x.js']) {
      const env = await setUp({ EXTENSION_SCRIPT_URL: url });
      assert.equal((await getMe(env)).extension_script_url, null, url);
    }
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
