// Where the site tells the client a page is live, and where it closes or
// evicts a room when access changes (plans/live-co-editing.md §4.6, §5.2).
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import * as lyricById from '../functions/api/lyrics/[id].js';
import * as shares from '../functions/api/lyrics/[id]/shares.js';
import * as account from '../functions/api/account.js';
import { askRoom } from '../functions/_live.js';
import { BASE_URL, addSession, makeEnv } from './support/auth-harness.mjs';
import { fakeRoomBinding } from './support/fake-room-binding.mjs';

const SHARED = 'shared-page';
const SOLO = 'solo-page';
let env;

async function exec(sql, ...params) {
  await env.lyricalmiracle_db.prepare(sql).bind(...params).run();
}

async function addUser(id) {
  const email = `${id}@example.com`;
  await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
    id, email, email, id);
  await addSession(env, id, `sid-${id}`);
}

async function call(handler, method, path, { sid, json, params = {} } = {}) {
  const headers = { Cookie: `sid=${sid}`, 'Content-Type': 'application/json' };
  const body = json === undefined ? undefined : JSON.stringify(json);
  const request = new Request(BASE_URL + path, { method, headers, body });
  const pending = [];
  const response = await handler({ request, env, params, waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  return response;
}

function calls() {
  return env.PAGE_ROOM.calls.map(({ page, url }) => {
    const { pathname, search } = new URL(url);
    return `${page} ${pathname}${search}`;
  });
}

// Who each /evict call names: in the body, so the address stays out of the
// room's request logs.
function evicted() {
  return env.PAGE_ROOM.calls.filter(({ url }) => new URL(url).pathname === '/evict')
    .map(({ page, body }) => `${page} ${JSON.parse(body).email}`);
}

function getAs(sid, id, query = '') {
  return call(lyricById.onRequestGet, 'GET', `/api/lyrics/${id}${query}`, { sid, params: { id } });
}

function putAs(sid, id, json) {
  return call(lyricById.onRequestPut, 'PUT', `/api/lyrics/${id}`, { sid, json, params: { id } });
}

function deleteAs(sid, id) {
  return call(lyricById.onRequestDelete, 'DELETE', `/api/lyrics/${id}`, { sid, params: { id } });
}

beforeEach(async () => {
  env = makeEnv({ LIVE_EDITING: 'on', PAGE_ROOM: fakeRoomBinding() });
  await addUser('ann');
  await addUser('bo');
  for (const id of [SHARED, SOLO]) {
    await exec('INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) ' +
      "VALUES (?, 'ann', 'S', 'b', 0, 1, 1)", id);
  }
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) ' +
    "VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", SHARED);
});

describe('the live flag', () => {
  it('is on for a shared page when the switch applies to its owner', async () => {
    assert.equal((await (await getAs('sid-bo', SHARED)).json()).live, true);
    assert.equal((await (await getAs('sid-ann', SOLO)).json()).live, false);
    env.LIVE_EDITING = 'off';
    assert.equal((await (await getAs('sid-bo', SHARED)).json()).live, false);
  });

  it('rides on the poll, a saved PUT and a 409', async () => {
    assert.equal((await (await getAs('sid-bo', SHARED, '?meta=1')).json()).live, true);
    const saved = await putAs('sid-bo', SHARED, { body: 'new', base_revision: 0 });
    assert.equal((await saved.json()).live, true);
    const refused = await putAs('sid-bo', SHARED, { body: 'stale', base_revision: 0 });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).live, true);
  });
});

describe('the meta answer', () => {
  it('says the owner is the owner', async () => {
    assert.equal((await (await getAs('sid-ann', SHARED, '?meta=1')).json()).role, 'owner');
  });

  it('says a co-writer is an editor', async () => {
    assert.equal((await (await getAs('sid-bo', SHARED, '?meta=1')).json()).role, 'editor');
  });
});

describe('room calls', () => {
  it('closes the room when the owner deletes the page', async () => {
    await deleteAs('sid-ann', SHARED);
    assert.deepEqual(calls(), [`${SHARED} /close`]);
  });

  it('evicts an editor who leaves', async () => {
    await deleteAs('sid-bo', SHARED);
    assert.deepEqual(calls(), [`${SHARED} /evict`]);
    assert.deepEqual(evicted(), [`${SHARED} bo@example.com`]);
  });

  it('evicts someone the owner takes off the page', async () => {
    await call(shares.onRequestDelete, 'DELETE', `/api/lyrics/${SHARED}/shares`,
      { sid: 'sid-ann', json: { email: 'bo@example.com' }, params: { id: SHARED } });
    assert.deepEqual(calls(), [`${SHARED} /evict`]);
    assert.deepEqual(evicted(), [`${SHARED} bo@example.com`]);
  });

  it("closes an owner's shared pages and evicts them elsewhere when their account goes", async () => {
    await exec("INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES ('bo-page', 'bo', 'S', 'b', 1, 1)");
    await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) ' +
      "VALUES ('bo-page', 'ann@example.com', 'ann@example.com', 'ann', 1, 0, 1)");
    await call(account.onRequestDelete, 'DELETE', '/api/account', { sid: 'sid-ann' });
    assert.deepEqual(calls().sort(), [`${SHARED} /close`, 'bo-page /evict'].sort());
    assert.deepEqual(evicted(), ['bo-page ann@example.com']);
  });

  it('calls no room for a page that was never shared', async () => {
    await deleteAs('sid-ann', SOLO);
    assert.deepEqual(calls(), []);
  });
});

describe('sharing a page', () => {
  function shareAs(sid, id, email) {
    return call(shares.onRequestPost, 'POST', `/api/lyrics/${id}/shares`, { sid, json: { email }, params: { id } });
  }

  it('tells the owner the page is live now', async () => {
    const res = await shareAs('sid-ann', SOLO, 'cy@example.com');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).live, true);
  });

  it('refuses to share at all when the switch is off', async () => {
    env.LIVE_EDITING = 'off';
    const res = await shareAs('sid-ann', SOLO, 'cy@example.com');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'sharing_paused');
  });
});

describe('askRoom', () => {
  it('returns what the room answered', async () => {
    env.PAGE_ROOM = fakeRoomBinding({ answer: () => Response.json({ revision: 4 }) });
    const answer = await askRoom(env, SHARED, '/replace', { title: 'T', body: 'b' });
    assert.deepEqual(await answer.json(), { revision: 4 });
    assert.deepEqual(calls(), [`${SHARED} /replace`]);
    assert.deepEqual(JSON.parse(env.PAGE_ROOM.calls[0].body), { title: 'T', body: 'b' });
  });

  it('is null with no binding', async () => {
    delete env.PAGE_ROOM;
    assert.equal(await askRoom(env, SHARED, '/replace', {}), null);
  });

  it('is null when the call throws', async () => {
    env.PAGE_ROOM = fakeRoomBinding({ answer: () => { throw new Error('room down'); } });
    assert.equal(await askRoom(env, SHARED, '/replace', {}), null);
  });
});
