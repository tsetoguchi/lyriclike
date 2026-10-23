// The room's own D1 queries, run against a database built from migrations/.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { readAccess, readPage, writePage } from '../collab/src/d1-page.js';
import { createFakeD1 } from './support/fake-d1.mjs';

const PAGE = 'page-1';
const NOW = 1_000_000;

let db;

async function exec(sql, ...params) {
  await db.prepare(sql).bind(...params).run();
}

beforeEach(async () => {
  db = createFakeD1();
  for (const [id, email] of [['ann', 'ann@example.com'], ['bo', 'bo@example.com']]) {
    await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
      id, email, email, id);
  }
  await exec('INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) ' +
    "VALUES (?, 'ann', 'Song', 'hello', 3, 1, 1)", PAGE);
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, ' +
    "created_at) VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", PAGE);
});

describe('readPage', () => {
  it('reads the text, title, revision, time and owner, or null', async () => {
    assert.deepEqual(await readPage(db, PAGE),
      { body: 'hello', title: 'Song', revision: 3, updated_at: 1, user_id: 'ann' });
    assert.equal(await readPage(db, 'missing'), null);
  });
});

describe('writePage', () => {
  const save = { body: 'hello world', title: 'Song', now: NOW, baseRevision: 3, baseTitle: 'Song' };

  it('writes and returns the next revision when nothing changed outside', async () => {
    assert.equal(await writePage(db, PAGE, save), 4);
    assert.deepEqual(await readPage(db, PAGE),
      { body: 'hello world', title: 'Song', revision: 4, updated_at: NOW, user_id: 'ann' });
  });

  it('does not land after a save outside the room', async () => {
    await exec("UPDATE lyrics SET body = 'other', revision = 4 WHERE id = ?", PAGE);
    assert.equal(await writePage(db, PAGE, save), null);
    assert.equal((await readPage(db, PAGE)).body, 'other');
  });

  it('does not land after a rename outside the room, which keeps the revision', async () => {
    await exec("UPDATE lyrics SET title = 'Renamed' WHERE id = ?", PAGE);
    assert.equal(await writePage(db, PAGE, save), null);
  });
});

describe('readAccess', () => {
  it('lists unexpired sessions and the emails that can open the page', async () => {
    await exec('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, 1)',
      'live-session', 'bo', NOW + 1);
    await exec('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, 1)',
      'old-session', 'bo', NOW - 1);
    const access = await readAccess(db, PAGE, ['live-session', 'old-session', 'gone'], NOW);
    assert.deepEqual([...access.validSessions], ['live-session']);
    assert.deepEqual([...access.allowedEmails].sort(), ['ann@example.com', 'bo@example.com']);
  });

  it('asks nothing about sessions when there are none', async () => {
    const access = await readAccess(db, PAGE, [], NOW);
    assert.equal(access.validSessions.size, 0);
  });
});
