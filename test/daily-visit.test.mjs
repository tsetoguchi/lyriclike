// The first signed-in page load each day leaves one row in the account log, so
// return visits can be counted even when nothing is saved.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import * as me from '../functions/api/me.js';
import { BASE_URL, addGoogleUser, addSession, makeEnv, query } from './support/auth-harness.mjs';

const TOKEN = 'a'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

let env;
let userId;

async function loadPage({ token = TOKEN } = {}) {
  const request = new Request(BASE_URL + '/api/me', { headers: { Cookie: `sid=${token}` } });
  const pending = [];
  const response = await me.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return response;
}

async function visits() {
  return query(env, "SELECT user_id, created_at FROM logs WHERE event = 'app_open'");
}

beforeEach(async () => {
  env = makeEnv();
  userId = await addGoogleUser(env);
  await addSession(env, userId, TOKEN);
});

describe('daily visit log', () => {
  it('logs the first page load of the day', async () => {
    const response = await loadPage();

    assert.equal(response.status, 200);
    const rows = await visits();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, userId);
  });

  it('logs only once on the same day', async () => {
    await loadPage();
    await loadPage();
    await loadPage();

    assert.equal((await visits()).length, 1);
  });

  it('logs again on a new day', async () => {
    await env.lyricalmiracle_db.prepare(
      "INSERT INTO logs (id, user_id, event, ip, created_at) VALUES ('old', ?, 'app_open', NULL, ?)"
    ).bind(userId, Date.now() - 2 * DAY_MS).run();

    await loadPage();

    assert.equal((await visits()).length, 2);
  });

  it('logs nothing when signed out', async () => {
    const response = await loadPage({ token: 'b'.repeat(64) });

    assert.equal(response.status, 401);
    assert.equal((await visits()).length, 0);
  });
});
