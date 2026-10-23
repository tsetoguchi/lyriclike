// POST /api/lyrics/:id/replace: new words and a title over a whole page,
// for everyone on it.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import * as replace from '../functions/api/lyrics/[id]/replace.js';
import { BASE_URL, addSession, makeEnv } from './support/auth-harness.mjs';
import { fakeRoomBinding } from './support/fake-room-binding.mjs';

const SHARED = 'shared-page';
const SOLO = 'solo-page';
const NEW = { title: 'New', body: 'new words' };
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

function replaceAs(sid, id, json = NEW) {
  const headers = { 'Content-Type': 'application/json' };
  if (sid) headers.Cookie = `sid=${sid}`;
  const body = typeof json === 'string' ? json : JSON.stringify(json);
  const request = new Request(`${BASE_URL}/api/lyrics/${id}/replace`, { method: 'POST', headers, body });
  return replace.onRequestPost({ request, env, params: { id }, waitUntil: () => {} });
}

function readStored(id) {
  return env.lyricalmiracle_db.prepare('SELECT title, body, revision FROM lyrics WHERE id = ?').bind(id).first();
}

function roomAnswers(response) {
  env.PAGE_ROOM = fakeRoomBinding({ answer: () => response });
}

// Someone's save lands just before the route's first write, as if it came
// in between the route's read and its write.
function saveBeforeFirstWrite(id) {
  const db = env.lyricalmiracle_db;
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    if (!sql.trimStart().startsWith('UPDATE lyrics')) return prepare(sql);
    db.prepare = prepare;
    const statement = prepare(sql);
    return {
      bind: (...params) => ({
        first: async () => {
          await prepare("UPDATE lyrics SET body = 'typed meanwhile', revision = revision + 1 WHERE id = ?")
            .bind(id).run();
          return statement.bind(...params).first();
        },
      }),
    };
  };
}

beforeEach(async () => {
  env = makeEnv({ LIVE_EDITING: 'on', PAGE_ROOM: fakeRoomBinding() });
  for (const id of ['ann', 'bo', 'cy']) await addUser(id);
  for (const id of [SHARED, SOLO]) {
    await exec('INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) ' +
      "VALUES (?, 'ann', 'Old', 'old words', 3, 1, 1)", id);
  }
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) ' +
    "VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", SHARED);
});

describe('replacing a solo page', () => {
  it('puts the new words and title on the page', async () => {
    const response = await replaceAs('sid-ann', SOLO);
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.live, false);
    assert.equal(answer.revision, 4);
    assert.equal(answer.title, 'New');
    assert.deepEqual(await readStored(SOLO), { title: 'New', body: 'new words', revision: 4 });
    assert.equal(env.PAGE_ROOM.calls.length, 0);
  });

  it('lands after a save that came in between its read and its write', async () => {
    saveBeforeFirstWrite(SOLO);
    const response = await replaceAs('sid-ann', SOLO);
    assert.equal(response.status, 200);
    assert.deepEqual(await readStored(SOLO), { title: 'New', body: 'new words', revision: 5 });
  });
});

describe('replacing a live page', () => {
  it('goes through the room and passes its answer on', async () => {
    roomAnswers(Response.json({ revision: 9, updated_at: 5 }));
    const response = await replaceAs('sid-bo', SHARED);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(),
      { id: SHARED, title: 'New', revision: 9, updated_at: 5, live: true });
    assert.equal(new URL(env.PAGE_ROOM.calls[0].url).pathname, '/replace');
    assert.deepEqual(JSON.parse(env.PAGE_ROOM.calls[0].body), { ...NEW, tag: null, userId: 'bo' });
    assert.deepEqual(await readStored(SHARED), { title: 'Old', body: 'old words', revision: 3 });
  });

  it('the site passes tag and the person to the room', async () => {
    roomAnswers(Response.json({ revision: 9, updated_at: 5 }));
    await replaceAs('sid-bo', SHARED, { ...NEW, tag: 'v-1' });
    assert.deepEqual(JSON.parse(env.PAGE_ROOM.calls[0].body), { ...NEW, tag: 'v-1', userId: 'bo' });
  });

  it('gives busy when the room is busy', async () => {
    roomAnswers(Response.json({ error: 'busy' }, { status: 409 }));
    const response = await replaceAs('sid-bo', SHARED);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'busy' });
  });

  it('gives 404 when the room finds the page gone', async () => {
    roomAnswers(Response.json({ error: 'not_found' }, { status: 404 }));
    assert.equal((await replaceAs('sid-bo', SHARED)).status, 404);
  });

  it('gives 503 busy when an older room answers 426', async () => {
    roomAnswers(new Response(null, { status: 426 }));
    const response = await replaceAs('sid-bo', SHARED);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'busy' });
  });

  it('gives 503 busy with no room binding', async () => {
    delete env.PAGE_ROOM;
    assert.equal((await replaceAs('sid-bo', SHARED)).status, 503);
  });
});

describe('who may replace', () => {
  it('not a paused co-writer', async () => {
    env.LIVE_EDITING = 'off';
    const response = await replaceAs('sid-bo', SHARED);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'paused' });
    assert.deepEqual(await readStored(SHARED), { title: 'Old', body: 'old words', revision: 3 });
  });

  it('the owner of a paused page, directly', async () => {
    env.LIVE_EDITING = 'off';
    assert.equal((await replaceAs('sid-ann', SHARED)).status, 200);
    assert.equal((await readStored(SHARED)).body, 'new words');
  });

  it('not a stranger', async () => {
    assert.equal((await replaceAs('sid-cy', SOLO)).status, 404);
  });

  it('not someone signed out', async () => {
    assert.equal((await replaceAs(null, SOLO)).status, 401);
  });
});

describe('what a replace may carry', () => {
  it('refuses the 61st in an hour', async () => {
    for (let count = 0; count < 60; count += 1) {
      assert.equal((await replaceAs('sid-ann', SOLO, { title: 'T', body: `take ${count}` })).status, 200);
    }
    assert.equal((await replaceAs('sid-ann', SOLO, { title: 'T', body: 'one too many' })).status, 429);
    assert.equal((await readStored(SOLO)).body, 'take 59');
  });

  it('refuses a title over 300 characters', async () => {
    assert.equal((await replaceAs('sid-ann', SOLO, { title: 'x'.repeat(301), body: 'b' })).status, 413);
  });

  it('refuses a body over 500,000 characters', async () => {
    assert.equal((await replaceAs('sid-ann', SOLO, { title: 'T', body: 'x'.repeat(500_001) })).status, 413);
  });

  it('refuses a tag over 64 characters, and takes one at 64', async () => {
    assert.equal((await replaceAs('sid-ann', SOLO, { ...NEW, tag: 'x'.repeat(65) })).status, 400);
    assert.equal((await replaceAs('sid-ann', SOLO, { ...NEW, tag: 'x'.repeat(64) })).status, 200);
  });

  it('refuses a body that is not a string, a missing title, or not JSON', async () => {
    assert.equal((await replaceAs('sid-ann', SOLO, { title: 'T', body: 4 })).status, 400);
    assert.equal((await replaceAs('sid-ann', SOLO, { body: 'b' })).status, 400);
    assert.equal((await replaceAs('sid-ann', SOLO, 'not json')).status, 400);
  });
});
