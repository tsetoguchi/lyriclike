// Who may read, change and delete lyrics. Each test runs the real API handlers
// against a fresh database built from migrations/.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';
import * as logout from '../functions/api/auth/logout.js';
import * as lyricById from '../functions/api/lyrics/[id].js';
import * as lyricList from '../functions/api/lyrics/index.js';
import * as me from '../functions/api/me.js';
import { sha256Hex } from '../functions/_shared.js';
import { createFakeD1 } from './support/fake-d1.mjs';

const BASE_URL = 'https://lyriclike.com';
const HOUR_MS = 60 * 60 * 1000;
const MAX_TITLE_LENGTH = 300;
const MAX_BODY_LENGTH = 500_000;
const ALICE_LYRIC_ID = 'alice-lyric';
const ALICE_TITLE = 'Alice song';
const ALICE_BODY = 'only alice should see this';

let env;

function database() {
  return env.lyricalmiracle_db;
}

async function addSession(userId, expiresAt) {
  const sid = crypto.randomUUID();
  // The cookie holds the token; the table holds its hash.
  await database().prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(await sha256Hex(sid), userId, expiresAt, Date.now()).run();
  return sid;
}

async function addUser(name) {
  const id = crypto.randomUUID();
  const email = `${name}@example.com`;
  await database().batch([
    database().prepare(
      'INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, email, email, name, Date.now()),
    database().prepare(
      'INSERT INTO identities (id, user_id, provider, provider_subject, created_at) ' +
      'VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), id, 'google', `sub-${name}`, Date.now()),
  ]);
  const sid = await addSession(id, Date.now() + HOUR_MS);
  return { id, sid };
}

async function addLyric(userId, { id, title, body, updatedAt = Date.now() }) {
  await database().prepare(
    'INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, title, body, updatedAt, updatedAt).run();
}

async function readStoredLyric(id) {
  return database().prepare('SELECT * FROM lyrics WHERE id = ?').bind(id).first();
}

function makeRequest(path, { method = 'GET', sid, json, rawBody } = {}) {
  const headers = new Headers();
  if (sid) headers.set('Cookie', `sid=${sid}`);
  const body = json === undefined ? rawBody : JSON.stringify(json);
  return new Request(BASE_URL + path, { method, headers, body });
}

function listLyrics(sid) {
  return lyricList.onRequestGet({ request: makeRequest('/api/lyrics', { sid }), env });
}

function getLyric(sid, id) {
  const request = makeRequest(`/api/lyrics/${id}`, { sid });
  return lyricById.onRequestGet({ request, env, params: { id } });
}

function saveLyric(sid, id, json) {
  const request = makeRequest(`/api/lyrics/${id}`, { method: 'PUT', sid, json });
  return lyricById.onRequestPut({ request, env, params: { id } });
}

function saveRawBody(sid, id, rawBody) {
  const request = makeRequest(`/api/lyrics/${id}`, { method: 'PUT', sid, rawBody });
  return lyricById.onRequestPut({ request, env, params: { id } });
}

function patchLyric(sid, id, json) {
  const request = makeRequest(`/api/lyrics/${id}`, { method: 'PATCH', sid, json });
  return lyricById.onRequestPatch({ request, env, params: { id } });
}

function getLyricMeta(sid, id) {
  const request = makeRequest(`/api/lyrics/${id}?meta=1`, { sid });
  return lyricById.onRequestGet({ request, env, params: { id } });
}

async function loggedEvents() {
  const { results } = await database().prepare('SELECT event FROM logs ORDER BY created_at').all();
  return results.map(row => row.event);
}

async function shareWith(lyricId, email) {
  await database().prepare(
    'INSERT INTO lyric_shares (lyric_id, email_normalized, email, had_account, emailed, created_at) ' +
    'VALUES (?, ?, ?, 0, 0, ?)'
  ).bind(lyricId, email, email, Date.now()).run();
}

function deleteLyric(sid, id) {
  const request = makeRequest(`/api/lyrics/${id}`, { method: 'DELETE', sid });
  return lyricById.onRequestDelete({ request, env, params: { id } });
}

async function getMe(sid) {
  const pending = [];
  const request = makeRequest('/api/me', { sid });
  const response = await me.onRequestGet({ request, env, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return response;
}

function deleteAccount(sid) {
  return me.onRequestDelete({ request: makeRequest('/api/me', { method: 'DELETE', sid }), env });
}

function logOut(sid) {
  const request = makeRequest('/api/auth/logout', { method: 'POST', sid });
  return logout.onRequestPost({ request, env });
}

const SIGNED_IN_ROUTES = [
  ['GET /api/lyrics', (sid) => listLyrics(sid)],
  ['GET /api/lyrics/:id', (sid) => getLyric(sid, ALICE_LYRIC_ID)],
  ['PUT /api/lyrics/:id', (sid) => saveLyric(sid, ALICE_LYRIC_ID, { title: 'x', body: 'x' })],
  ['PATCH /api/lyrics/:id', (sid) => patchLyric(sid, ALICE_LYRIC_ID, { title: 'x' })],
  ['DELETE /api/lyrics/:id', (sid) => deleteLyric(sid, ALICE_LYRIC_ID)],
  ['GET /api/me', (sid) => getMe(sid)],
  ['DELETE /api/me', (sid) => deleteAccount(sid)]
];

let alice;
let bob;

beforeEach(async () => {
  env = { lyricalmiracle_db: createFakeD1() };
  alice = await addUser('alice');
  bob = await addUser('bob');
  await addLyric(alice.id, { id: ALICE_LYRIC_ID, title: ALICE_TITLE, body: ALICE_BODY });
});

describe('signed-out requests', () => {
  for (const [route, call] of SIGNED_IN_ROUTES) {
    it(`${route} needs a session cookie`, async () => {
      assert.equal((await call(undefined)).status, 401);
    });

    it(`${route} rejects an unknown session`, async () => {
      assert.equal((await call('not-a-real-session')).status, 401);
    });

    it(`${route} rejects an expired session`, async () => {
      const expiredSid = await addSession(alice.id, Date.now() - HOUR_MS);
      assert.equal((await call(expiredSid)).status, 401);
    });
  }

  it('change nothing', async () => {
    for (const [, call] of SIGNED_IN_ROUTES) await call(undefined);
    const lyric = await readStoredLyric(ALICE_LYRIC_ID);
    assert.equal(lyric.body, ALICE_BODY);
    assert.ok(await database().prepare('SELECT id FROM users WHERE id = ?')
      .bind(alice.id).first());
  });
});

describe("another user's lyrics", () => {
  it('are left out of the list', async () => {
    const response = await listLyrics(bob.sid);
    assert.deepEqual(await response.json(), []);
  });

  it('cannot be read, and look the same as a lyric that does not exist', async () => {
    const response = await getLyric(bob.sid, ALICE_LYRIC_ID);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
  });

  it('cannot be overwritten', async () => {
    await saveLyric(bob.sid, ALICE_LYRIC_ID, { title: 'stolen', body: 'overwritten' });
    const lyric = await readStoredLyric(ALICE_LYRIC_ID);
    assert.equal(lyric.user_id, alice.id);
    assert.equal(lyric.title, ALICE_TITLE);
    assert.equal(lyric.body, ALICE_BODY);
  });

  it('cannot be taken over by saving to the same id', async () => {
    await saveLyric(bob.sid, ALICE_LYRIC_ID, { title: 'stolen', body: 'overwritten' });
    assert.deepEqual(await (await listLyrics(bob.sid)).json(), []);
    assert.equal((await getLyric(bob.sid, ALICE_LYRIC_ID)).status, 404);
  });

  it('cannot be deleted', async () => {
    await deleteLyric(bob.sid, ALICE_LYRIC_ID);
    assert.ok(await readStoredLyric(ALICE_LYRIC_ID));
    assert.equal((await getLyric(alice.sid, ALICE_LYRIC_ID)).status, 200);
  });

  it('survive another user deleting their account', async () => {
    await addLyric(bob.id, { id: 'bob-lyric', title: 'Bob song', body: 'bob' });
    assert.equal((await deleteAccount(bob.sid)).status, 200);

    assert.equal((await getLyric(alice.sid, ALICE_LYRIC_ID)).status, 200);
    assert.equal((await getMe(alice.sid)).status, 200);
    assert.equal(await readStoredLyric('bob-lyric'), null);
    assert.equal((await getMe(bob.sid)).status, 401);
  });

  it("stay reachable when another user logs out", async () => {
    await logOut(bob.sid);
    assert.equal((await getMe(bob.sid)).status, 401);
    assert.equal((await getLyric(alice.sid, ALICE_LYRIC_ID)).status, 200);
  });
});

describe('own lyrics', () => {
  it('can be read in full', async () => {
    const lyric = await (await getLyric(alice.sid, ALICE_LYRIC_ID)).json();
    assert.equal(lyric.title, ALICE_TITLE);
    assert.equal(lyric.body, ALICE_BODY);
  });

  it('are listed newest first, without their bodies', async () => {
    await addLyric(alice.id, { id: 'older', title: 'Older', body: 'b', updatedAt: 1 });
    const listed = await (await listLyrics(alice.sid)).json();
    assert.deepEqual(listed.map((lyric) => lyric.id), [ALICE_LYRIC_ID, 'older']);
    assert.deepEqual(
      Object.keys(listed[0]).sort(), ['created_at', 'id', 'share_count', 'title', 'updated_at']);
  });

  it('keep their created date in the list after a rename', async () => {
    const id = 'renamed-lyric';
    // An old timestamp, so a rename in the same millisecond cannot mask a bug.
    const createdAt = 1;
    await addLyric(alice.id, { id, title: 'Before', body: 'words', updatedAt: createdAt });

    await saveLyric(alice.sid, id, { title: 'After', body: 'words' });
    const listed = await (await listLyrics(alice.sid)).json();
    const renamed = listed.find((lyric) => lyric.id === id);
    assert.equal(renamed.title, 'After');
    assert.equal(renamed.created_at, createdAt);
    assert.ok(renamed.updated_at > createdAt);
  });

  it('can be created, updated and deleted', async () => {
    const id = 'new-lyric';
    assert.equal((await saveLyric(alice.sid, id, { title: 'Draft', body: 'one' })).status, 200);
    const created = await readStoredLyric(id);

    await saveLyric(alice.sid, id, { title: 'Final', body: 'two' });
    const updated = await readStoredLyric(id);
    assert.equal(updated.title, 'Final');
    assert.equal(updated.body, 'two');
    assert.equal(updated.created_at, created.created_at);

    assert.equal((await deleteLyric(alice.sid, id)).status, 204);
    assert.equal((await getLyric(alice.sid, id)).status, 404);
  });
});

describe('saving', () => {
  const invalidSaves = [
    ['a missing body', { title: 'x' }, 400],
    ['a non-text title', { title: 5, body: 'x' }, 400],
    ['a title that is too long', { title: 'x'.repeat(MAX_TITLE_LENGTH + 1), body: 'x' }, 413],
    ['a body that is too large', { title: 'x', body: 'x'.repeat(MAX_BODY_LENGTH + 1) }, 413]
  ];

  for (const [description, json, status] of invalidSaves) {
    it(`refuses ${description} and stores nothing`, async () => {
      assert.equal((await saveLyric(alice.sid, 'rejected', json)).status, status);
      assert.equal(await readStoredLyric('rejected'), null);
    });
  }

  const garbledBodies = [
    ['an empty body', ''],
    ['cut-off JSON', '{"title": "x", "bo'],
    ['plain text', 'not json'],
    ['JSON null', 'null']
  ];

  for (const [description, rawBody] of garbledBodies) {
    it(`answers ${description} with 400 and stores nothing`, async () => {
      assert.equal((await saveRawBody(alice.sid, 'garbled', rawBody)).status, 400);
      assert.equal(await readStoredLyric('garbled'), null);
    });
  }

  it('accepts a title and body at their limits', async () => {
    const json = { title: 'x'.repeat(MAX_TITLE_LENGTH), body: 'x'.repeat(MAX_BODY_LENGTH) };
    assert.equal((await saveLyric(alice.sid, 'at-limit', json)).status, 200);
  });
});

describe('revisions', () => {
  async function revisionOf(id) {
    return (await readStoredLyric(id)).revision;
  }

  it('start at 0 on a new page, come back from GET, and go up on each save', async () => {
    const created = await (await saveLyric(alice.sid, 'fresh', { title: 'T', body: 'one' })).json();
    assert.equal(created.revision, 0);
    assert.equal((await (await getLyric(alice.sid, 'fresh')).json()).revision, 0);

    const saved = await saveLyric(alice.sid, 'fresh', { body: 'two', base_revision: 0 });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, 1);
    assert.equal((await readStoredLyric('fresh')).body, 'two');
  });

  it('refuse a stale save with 409, change nothing, and send what is there now', async () => {
    await saveLyric(alice.sid, ALICE_LYRIC_ID, { body: 'newer', base_revision: 0 });
    const stale = await saveLyric(alice.sid, ALICE_LYRIC_ID, { body: 'older', base_revision: 0 });

    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(),
      { error: 'conflict', body: 'newer', title: ALICE_TITLE, revision: 1 });
    assert.equal((await readStoredLyric(ALICE_LYRIC_ID)).body, 'newer');
    assert.equal(await revisionOf(ALICE_LYRIC_ID), 1);
  });

  it('let only one of two saves on the same revision land', async () => {
    const answers = await Promise.all([
      saveLyric(alice.sid, ALICE_LYRIC_ID, { body: 'first', base_revision: 0 }),
      saveLyric(alice.sid, ALICE_LYRIC_ID, { body: 'second', base_revision: 0 }),
    ]);
    assert.deepEqual(answers.map(r => r.status).sort(), [200, 409]);
    assert.equal(await revisionOf(ALICE_LYRIC_ID), 1);
  });

  it('never change the title on a body save', async () => {
    await saveLyric(alice.sid, ALICE_LYRIC_ID, { title: 'sneaky', body: 'b', base_revision: 0 });
    assert.equal((await readStoredLyric(ALICE_LYRIC_ID)).title, ALICE_TITLE);
  });

  it('answer a stranger with 404, with or without a revision', async () => {
    assert.equal((await saveLyric(bob.sid, ALICE_LYRIC_ID, { body: 'x', base_revision: 0 })).status, 404);
    assert.equal((await saveLyric(bob.sid, ALICE_LYRIC_ID, { title: 'x', body: 'x' })).status, 404);
    assert.equal((await readStoredLyric(ALICE_LYRIC_ID)).body, ALICE_BODY);
    assert.equal(await revisionOf(ALICE_LYRIC_ID), 0);
  });

  for (const bad of [-1, 1.5, '0', null]) {
    it(`refuse a base_revision of ${JSON.stringify(bad)}`, async () => {
      const response = await saveLyric(alice.sid, ALICE_LYRIC_ID, { body: 'x', base_revision: bad });
      assert.equal(response.status, 400);
    });
  }
});

describe('saves from tabs still running the old app', () => {
  it('save for the owner as before, title included, bump the revision, and are logged', async () => {
    const response = await saveLyric(alice.sid, ALICE_LYRIC_ID, { title: 'Renamed', body: 'old tab' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, 1);

    const stored = await readStoredLyric(ALICE_LYRIC_ID);
    assert.equal(stored.title, 'Renamed');
    assert.equal(stored.body, 'old tab');
    assert.deepEqual(await loggedEvents(), ['save_no_revision']);
  });

  it('make a new tab holding the old revision get a 409', async () => {
    await saveLyric(alice.sid, ALICE_LYRIC_ID, { title: ALICE_TITLE, body: 'old tab' });
    const newTab = await saveLyric(alice.sid, ALICE_LYRIC_ID, { body: 'new tab', base_revision: 0 });
    assert.equal(newTab.status, 409);
  });

  it('get a 409 on a page that is shared, and change nothing', async () => {
    await shareWith(ALICE_LYRIC_ID, 'carol@example.com');
    const response = await saveLyric(alice.sid, ALICE_LYRIC_ID, { title: 'x', body: 'x' });
    assert.equal(response.status, 409);
    assert.equal((await readStoredLyric(ALICE_LYRIC_ID)).body, ALICE_BODY);
    assert.deepEqual(await loggedEvents(), []);
  });
});

describe('renaming', () => {
  it('changes the title only, without bumping the revision', async () => {
    const before = await readStoredLyric(ALICE_LYRIC_ID);
    const response = await patchLyric(alice.sid, ALICE_LYRIC_ID, { title: 'New name' });
    assert.equal(response.status, 200);

    const after = await readStoredLyric(ALICE_LYRIC_ID);
    assert.equal(after.title, 'New name');
    assert.equal(after.body, ALICE_BODY);
    assert.equal(after.revision, before.revision);
    assert.ok(after.updated_at >= before.updated_at);
  });

  it('gives a stranger 404 and leaves the title alone', async () => {
    assert.equal((await patchLyric(bob.sid, ALICE_LYRIC_ID, { title: 'stolen' })).status, 404);
    assert.equal((await patchLyric(bob.sid, 'no-such-page', { title: 'x' })).status, 404);
    assert.equal((await readStoredLyric(ALICE_LYRIC_ID)).title, ALICE_TITLE);
  });

  it('refuses a title that is too long or not text', async () => {
    const tooLong = 'x'.repeat(MAX_TITLE_LENGTH + 1);
    assert.equal((await patchLyric(alice.sid, ALICE_LYRIC_ID, { title: tooLong })).status, 413);
    assert.equal((await patchLyric(alice.sid, ALICE_LYRIC_ID, { title: 5 })).status, 400);
    assert.equal((await patchLyric(alice.sid, ALICE_LYRIC_ID, {})).status, 400);
    assert.equal((await readStoredLyric(ALICE_LYRIC_ID)).title, ALICE_TITLE);
  });
});

describe('the poll', () => {
  it('gets only the revision, title and time', async () => {
    const response = await getLyricMeta(alice.sid, ALICE_LYRIC_ID);
    assert.deepEqual(Object.keys(await response.json()).sort(), ['revision', 'title', 'updated_at']);
  });

  it('gets 404 for a stranger', async () => {
    assert.equal((await getLyricMeta(bob.sid, ALICE_LYRIC_ID)).status, 404);
  });
});

describe('account deletion', () => {
  it('removes the account, its lyrics and its sessions', async () => {
    const secondSid = await addSession(alice.id, Date.now() + HOUR_MS);
    const response = await deleteAccount(alice.sid);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie'), /sid=;.*Max-Age=0/);
    assert.equal(await readStoredLyric(ALICE_LYRIC_ID), null);
    assert.equal((await getMe(secondSid)).status, 401);
  });

  it('removes its sign-in identities and leaves other accounts alone', async () => {
    await deleteAccount(alice.sid);
    const { results } = await database().prepare('SELECT user_id FROM identities').all();
    assert.deepEqual(results.map(row => row.user_id), [bob.id]);
  });
});

describe('API caching headers', () => {
  it('keep answers that depend on the session out of shared caches', async () => {
    const response = await apiMiddleware({
      request: makeRequest('/api/me'),
      next: async () => Response.json({ ok: true })
    });
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Vary'), 'Cookie');
  });

  it("leave a route's own caching choice alone", async () => {
    const cached = new Response('{}', { headers: { 'Cache-Control': 'public, max-age=60' } });
    const response = await apiMiddleware({
      request: makeRequest('/api/define/word'),
      next: async () => cached
    });
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
  });
});
