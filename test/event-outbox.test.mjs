// The event hook outbox: messages that failed both tries are parked in D1
// and sent again later.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { RETRY_CAP_MS, parkEvent, retryDelay } from '../functions/_event-outbox.js';
import { makeEnv, query } from './support/auth-harness.mjs';

const NOW = 1_800_000_000_000;

let env;

async function exec(sql, ...params) {
  await env.lyricalmiracle_db.prepare(sql).bind(...params).run();
}

async function addPage(id) {
  await exec('INSERT INTO users (id, email, email_normalized, name, created_at) ' +
    "VALUES ('owner', 'o@example.com', 'o@example.com', 'o', 1) ON CONFLICT DO NOTHING");
  await exec("INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) " +
    "VALUES (?, 'owner', 't', 'b', 1, 1, 1)", id);
}

function savedMessage(pageId) {
  return { id: crypto.randomUUID(), type: 'page.saved', data: { page_id: pageId } };
}

function parkedRows() {
  return query(env, 'SELECT id, page_id, body, attempts FROM event_outbox');
}

beforeEach(() => {
  env = makeEnv();
});

describe('parkEvent', () => {
  it('parks a page.saved for a page that exists', async () => {
    await addPage('p1');
    const message = savedMessage('p1');
    assert.equal(await parkEvent(env.lyricalmiracle_db, message, NOW), true);
    const [row] = await parkedRows();
    assert.equal(row.attempts, 1);
    assert.equal(row.page_id, 'p1');
    assert.equal(JSON.parse(row.body).id, message.id);
  });

  it('does not park a page.saved for a missing page', async () => {
    assert.equal(await parkEvent(env.lyricalmiracle_db, savedMessage('gone'), NOW), false);
    assert.deepEqual(await parkedRows(), []);
  });

  it('parks a page.deleted even with the page gone', async () => {
    const message = { id: crypto.randomUUID(), type: 'page.deleted', data: { page_id: 'gone' } };
    assert.equal(await parkEvent(env.lyricalmiracle_db, message, NOW), true);
  });
});

describe('retryDelay', () => {
  it('stays in [d/2, d] and caps', () => {
    assert.equal(retryDelay(0, () => 0), 30_000);
    assert.equal(retryDelay(0, () => 1), 60_000);
    assert.equal(retryDelay(20, () => 1), RETRY_CAP_MS);
  });
});
