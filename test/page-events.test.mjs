// The event hook from the page routes: what each save, replace and delete
// sends, and that nothing changes when the hook is unset.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { makeEnv } from './support/auth-harness.mjs';

let env;

async function exec(sql, ...params) {
  await env.lyricalmiracle_db.prepare(sql).bind(...params).run();
}

beforeEach(() => {
  env = makeEnv();
});

describe('the fake D1', () => {
  it('returns the rows of a SELECT and a RETURNING in a batch', async () => {
    await exec("INSERT INTO users (id, email, email_normalized, name, created_at) VALUES ('ann', 'a@x', 'a@x', 'ann', 1)");
    await exec("INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) VALUES ('p', 'ann', 'T', 'one', 0, 1, 1)");
    const db = env.lyricalmiracle_db;
    const [read, written, plain] = await db.batch([
      db.prepare('SELECT body FROM lyrics WHERE id = ?').bind('p'),
      db.prepare("UPDATE lyrics SET body = 'two' WHERE id = ? RETURNING revision").bind('p'),
      db.prepare("UPDATE lyrics SET title = 'U' WHERE id = ?").bind('p'),
    ]);
    assert.deepEqual(read.results, [{ body: 'one' }]);
    assert.deepEqual(written.results, [{ revision: 0 }]);
    assert.equal(written.meta.changes, 1);
    assert.deepEqual(plain.results, []);
    assert.equal(plain.meta.changes, 1);
  });
});
