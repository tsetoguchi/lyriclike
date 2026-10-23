// The event hook from the page routes: what each save, replace and delete
// sends, and that nothing changes when the hook is unset.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as account from '../functions/api/account.js';
import * as page from '../functions/api/lyrics/[id].js';
import * as replace from '../functions/api/lyrics/[id]/replace.js';
import { BASE_URL, addSession, makeEnv } from './support/auth-harness.mjs';
import { fakeRoomBinding } from './support/fake-room-binding.mjs';

const HOOK = { EVENT_HOOK_URL: 'https://hooks.example.com/events', EVENT_HOOK_SECRET: 'hook-secret' };
const SOLO = 'solo-page';
const SHARED = 'shared-page';

let env;
let pending;
let sent;
let hookStatus;
let originalFetch;

async function exec(sql, ...params) {
  await env.lyricalmiracle_db.prepare(sql).bind(...params).run();
}

async function addUser(id) {
  const email = `${id}@example.com`;
  await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
    id, email, email, id);
  await addSession(env, id, `sid-${id}`);
}

// Calls a route the way Pages does, then lets the queued work finish.
async function call(handler, method, sid, id, json) {
  const headers = { Cookie: `sid=${sid}` };
  const init = { method, headers };
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = typeof json === 'string' ? json : JSON.stringify(json);
  }
  const request = new Request(`${BASE_URL}/api/lyrics/${id}`, init);
  const response = await handler({ request, env, params: { id }, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return response;
}

const save = (sid, id, json) => call(page.onRequestPut, 'PUT', sid, id, json);

function events() {
  return sent.map(body => JSON.parse(body));
}

// Records every statement the routes prepare, and each batch's size.
function recordSql() {
  const db = env.lyricalmiracle_db;
  const log = { sql: [], batches: [] };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  db.prepare = sql => { log.sql.push(sql.trim()); return prepare(sql); };
  db.batch = statements => { log.batches.push(statements.length); return batch(statements); };
  return log;
}

beforeEach(async () => {
  env = makeEnv({ ...HOOK, LIVE_EDITING: 'on' });
  pending = [];
  sent = [];
  hookStatus = 200;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url !== HOOK.EVENT_HOOK_URL) throw new Error(`unexpected fetch ${url}`);
    sent.push(init.body);
    return new Response(null, { status: hookStatus });
  };
  for (const id of ['ann', 'bo']) await addUser(id);
  for (const id of [SOLO, SHARED]) {
    await exec('INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) ' +
      "VALUES (?, 'ann', 'Old', 'one', 0, 1, 1)", id);
  }
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) ' +
    "VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", SHARED);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the fake D1', () => {
  it('returns the rows of a SELECT and a RETURNING in a batch', async () => {
    const db = env.lyricalmiracle_db;
    const [read, written, plain] = await db.batch([
      db.prepare('SELECT body FROM lyrics WHERE id = ?').bind(SOLO),
      db.prepare("UPDATE lyrics SET body = 'two' WHERE id = ? RETURNING revision").bind(SOLO),
      db.prepare("UPDATE lyrics SET title = 'U' WHERE id = ?").bind(SOLO),
    ]);
    assert.deepEqual(read.results, [{ body: 'one' }]);
    assert.deepEqual(written.results, [{ revision: 0 }]);
    assert.equal(written.meta.changes, 1);
    assert.deepEqual(plain.results, []);
    assert.equal(plain.meta.changes, 1);
  });
});

describe('saving with the hook unset', () => {
  it('sends nothing and reads nothing extra', async () => {
    delete env.EVENT_HOOK_URL;
    const log = recordSql();
    const response = await save('sid-ann', SOLO, { body: 'two', base_revision: 0 });
    assert.equal(response.status, 200);
    assert.equal(sent.length, 0);
    assert.equal(pending.length, 0);
    assert.equal(log.batches.length, 0);
    assert.equal(log.sql.filter(sql => /^SELECT[\s\S]*\bFROM lyrics\b/.test(sql)).length, 0);
  });
});

describe('page.saved from a save', () => {
  it('sends the page before and after an update', async () => {
    const response = await save('sid-ann', SOLO, { body: 'two', base_revision: 0 });
    assert.equal(response.status, 200);
    const { updated_at: updatedAt } = await response.json();
    assert.deepEqual(events(), [{
      type: 'page.saved',
      data: {
        page_id: SOLO, owner_id: 'ann', writer_ids: ['ann'], reason: 'edit', tag: null,
        before: { title: 'Old', body: 'one', revision: 0, updated_at: 1 },
        after: { title: 'Old', body: 'two', revision: 1, updated_at: updatedAt },
      },
    }]);
  });

  it('names a co-writer as the writer and the owner as the owner', async () => {
    await save('sid-bo', SHARED, { body: 'two', base_revision: 0 });
    const [{ data }] = events();
    assert.equal(data.owner_id, 'ann');
    assert.deepEqual(data.writer_ids, ['bo']);
  });

  it('sends before null for a new page', async () => {
    const response = await save('sid-ann', 'new-page', { title: 'Fresh', body: 'hi' });
    const { updated_at: updatedAt } = await response.json();
    const [{ data }] = events();
    assert.equal(data.before, null);
    assert.deepEqual(data.after, { title: 'Fresh', body: 'hi', revision: 0, updated_at: updatedAt });
    assert.equal(data.owner_id, 'ann');
  });

  it('sends nothing when the words did not change', async () => {
    await save('sid-ann', SOLO, { body: 'one', base_revision: 0 });
    assert.equal(sent.length, 0);
  });

  it('sends nothing when the update missed', async () => {
    const response = await save('sid-ann', SOLO, { body: 'two', base_revision: 7 });
    assert.equal(response.status, 409);
    assert.equal(sent.length, 0);
  });

  it('reads the page before in the same batch as the update', async () => {
    const log = recordSql();
    await save('sid-ann', SOLO, { body: 'two', base_revision: 0 });
    assert.deepEqual(log.batches, [2]);
  });

  it('labels a keep mine save as overwrite', async () => {
    await save('sid-ann', SOLO, { body: 'two', base_revision: 0, overwrite: true });
    assert.equal(events()[0].data.reason, 'overwrite');
  });

  it('still refuses a keep mine save on an old revision', async () => {
    const response = await save('sid-ann', SOLO, { body: 'two', base_revision: 5, overwrite: true });
    assert.equal(response.status, 409);
    assert.equal(sent.length, 0);
  });

  it('refuses overwrite that is not true or false', async () => {
    const response = await save('sid-ann', SOLO, { body: 'two', base_revision: 0, overwrite: 'yes' });
    assert.equal(response.status, 400);
  });

  it('sends the page before and after an old tab save', async () => {
    const response = await save('sid-ann', SOLO, { title: 'Tab', body: 'old tab words' });
    assert.equal(response.status, 200);
    const [{ data }] = events();
    assert.deepEqual(data.before, { title: 'Old', body: 'one', revision: 0, updated_at: 1 });
    assert.equal(data.after.title, 'Tab');
    assert.equal(data.after.body, 'old tab words');
    assert.equal(data.after.revision, 1);
    assert.equal(data.reason, 'edit');
  });

  it('sends nothing for a rename', async () => {
    const response = await call(page.onRequestPatch, 'PATCH', 'sid-ann', SOLO, { title: 'Renamed' });
    assert.equal(response.status, 200);
    assert.equal(sent.length, 0);
  });

  it('still saves when the hook is down, and logs it once', async () => {
    hookStatus = 500;
    const response = await save('sid-ann', SOLO, { body: 'two', base_revision: 0 });
    assert.equal(response.status, 200);
    assert.equal(sent.length, 2);
    const logged = await env.lyricalmiracle_db.prepare(
      "SELECT count(*) AS n FROM logs WHERE event = 'event_hook_failed'"
    ).first();
    assert.equal(logged.n, 1);
  });
});

const replaceAs = (sid, id, json) => call(replace.onRequestPost, 'POST', sid, id, json);

describe('page.saved from a replace', () => {
  it('sends replace with its tag on a solo page', async () => {
    const response = await replaceAs('sid-ann', SOLO, { title: 'New', body: 'new words', tag: 't1' });
    assert.equal(response.status, 200);
    const { updated_at: updatedAt } = await response.json();
    assert.deepEqual(events(), [{
      type: 'page.saved',
      data: {
        page_id: SOLO, owner_id: 'ann', writer_ids: ['ann'], reason: 'replace', tag: 't1',
        before: { title: 'Old', body: 'one', revision: 0, updated_at: 1 },
        after: { title: 'New', body: 'new words', revision: 1, updated_at: updatedAt },
      },
    }]);
  });

  it('sends tag null when there is none', async () => {
    await replaceAs('sid-ann', SOLO, { title: 'New', body: 'new words' });
    assert.equal(events()[0].data.tag, null);
  });

  it('sends nothing from the site for a live page', async () => {
    env.PAGE_ROOM = fakeRoomBinding({ answer: () => Response.json({ revision: 9, updated_at: 5 }) });
    const response = await replaceAs('sid-bo', SHARED, { title: 'New', body: 'new words' });
    assert.equal(response.status, 200);
    assert.equal(sent.length, 0);
  });
});

describe('page.deleted', () => {
  it('is sent when the owner deletes a page', async () => {
    env.PAGE_ROOM = fakeRoomBinding();
    const response = await call(page.onRequestDelete, 'DELETE', 'sid-ann', SOLO);
    assert.equal(response.status, 204);
    assert.deepEqual(events(), [{ type: 'page.deleted', data: { page_id: SOLO } }]);
  });

  it('is not sent when a co-writer leaves', async () => {
    env.PAGE_ROOM = fakeRoomBinding();
    await call(page.onRequestDelete, 'DELETE', 'sid-bo', SHARED);
    assert.equal(sent.length, 0);
  });
});

describe('account.deleted', () => {
  async function deleteAccount(sid) {
    env.PAGE_ROOM = fakeRoomBinding();
    const request = new Request(`${BASE_URL}/api/account`, { method: 'DELETE', headers: { Cookie: `sid=${sid}` } });
    const response = await account.onRequestDelete({ request, env, waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    return response;
  }

  it('sends every page the account owned', async () => {
    await exec("INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) VALUES ('bo-page', 'bo', '', 'x', 0, 1, 1)");
    const response = await deleteAccount('sid-ann');
    assert.equal(response.status, 200);
    const [event] = events();
    assert.equal(event.type, 'account.deleted');
    assert.equal(event.data.user_id, 'ann');
    assert.deepEqual([...event.data.page_ids].sort(), [SHARED, SOLO]);
  });

  it('reads no page ids with the hook unset', async () => {
    delete env.EVENT_HOOK_SECRET;
    const log = recordSql();
    await deleteAccount('sid-ann');
    assert.equal(log.sql.filter(sql => sql === 'SELECT id FROM lyrics WHERE user_id = ?').length, 0);
    assert.equal(sent.length, 0);
  });
});
