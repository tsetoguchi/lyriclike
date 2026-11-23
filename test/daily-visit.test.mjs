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
const IOS_ORIGIN = 'capacitor://localhost';
const ANDROID_ORIGIN = 'https://localhost';

let env;
let userId;

async function loadPage({ token = TOKEN } = {}) {
  const request = new Request(BASE_URL + '/api/me', { headers: { Cookie: `sid=${token}` } });
  const pending = [];
  const response = await me.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return response;
}

// How the iOS or Android app calls the API: its own origin, the marker header
// and the token as a Bearer header.
async function loadAppPage(origin) {
  const headers = { Origin: origin, 'X-LyricLike-Client': 'app', Authorization: `Bearer ${TOKEN}` };
  const request = new Request(BASE_URL + '/api/me', { headers });
  const pending = [];
  const response = await me.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return response;
}

async function visits() {
  return query(env, "SELECT user_id, platform, created_at FROM logs WHERE event = 'app_open'");
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

  it('marks a website visit as web', async () => {
    await loadPage();

    assert.equal((await visits())[0].platform, 'web');
  });

  it('marks an iPhone app visit as ios', async () => {
    const response = await loadAppPage(IOS_ORIGIN);

    assert.equal(response.status, 200);
    assert.equal((await visits())[0].platform, 'ios');
  });

  it('marks an Android app visit as android', async () => {
    await loadAppPage(ANDROID_ORIGIN);

    assert.equal((await visits())[0].platform, 'android');
  });

  it('logs the website and the app once each on the same day', async () => {
    await loadPage();
    await loadAppPage(IOS_ORIGIN);
    await loadAppPage(IOS_ORIGIN);
    await loadPage();

    const platforms = (await visits()).map(row => row.platform).sort();
    assert.deepEqual(platforms, ['ios', 'web']);
  });

  it('treats the app header without an app origin as web', async () => {
    const headers = { Cookie: `sid=${TOKEN}`, 'X-LyricLike-Client': 'app' };
    const request = new Request(BASE_URL + '/api/me', { headers });
    const pending = [];
    await me.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
    await Promise.all(pending);

    assert.equal((await visits())[0].platform, 'web');
  });
});
