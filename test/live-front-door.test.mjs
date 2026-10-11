// The site's side of live editing: the LIVE_EDITING switch, the front door
// that hands a page's WebSocket to its room, and the middleware letting the
// 101 through.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';
import * as live from '../functions/api/lyrics/[id]/live.js';
import { isLiveFor } from '../functions/_live.js';
import { sha256Hex } from '../functions/_shared.js';
import { BASE_URL, addSession, makeEnv } from './support/auth-harness.mjs';
import { fakeRoomBinding } from './support/fake-room-binding.mjs';

const PAGE = 'page-1';
let env;

async function exec(sql, ...params) {
  await env.lyricalmiracle_db.prepare(sql).bind(...params).run();
}

async function addUser(id, name) {
  const email = `${id}@example.com`;
  await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
    id, email, email, name);
  await addSession(env, id, `sid-${id}`);
}

function upgrade({ sid, origin = BASE_URL, query = '?protocol=1&epoch=e1', id = PAGE } = {}) {
  const headers = { Upgrade: 'websocket' };
  if (origin) headers.Origin = origin;
  if (sid) headers.Cookie = `sid=${sid}`;
  const request = new Request(`${BASE_URL}/api/lyrics/${id}/live${query}`, { headers });
  return live.onRequestGet({ request, env, params: { id } });
}

beforeEach(async () => {
  env = makeEnv({ LIVE_EDITING: 'on', PAGE_ROOM: fakeRoomBinding() });
  await addUser('ann', 'Ann');
  await addUser('bo', 'Bö 鈴木');
  await addUser('cy', 'Cy');
  await exec("INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES (?, 'ann', 'S', 'b', 1, 1)", PAGE);
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) ' +
    "VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", PAGE);
});

describe('isLiveFor', () => {
  it('follows the switch: off, allowlist by owner, on', () => {
    assert.equal(isLiveFor({}, 'ann'), false);
    assert.equal(isLiveFor({ LIVE_EDITING: 'off' }, 'ann'), false);
    assert.equal(isLiveFor({ LIVE_EDITING: 'on' }, 'ann'), true);
    const allow = { LIVE_EDITING: 'allowlist', LIVE_EDITING_USERS: 'ann, dee' };
    assert.equal(isLiveFor(allow, 'ann'), true);
    assert.equal(isLiveFor(allow, 'bo'), false);
  });
});

describe('the front door', () => {
  it('hands an editor through to the room, with no cookie and a readable name', async () => {
    const response = await upgrade({ sid: 'sid-bo' });
    assert.equal(response.status, 204);
    const [call] = env.PAGE_ROOM.calls;
    assert.equal(call.page, PAGE);
    assert.equal(new URL(call.url).search, '?protocol=1&epoch=e1');
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers['x-room-page'], PAGE);
    assert.equal(call.headers['x-room-session'], await sha256Hex('sid-bo'));
    const user = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(call.headers['x-room-user']), c => c.charCodeAt(0))));
    assert.deepEqual(user, { id: 'bo', email: 'bo@example.com', name: 'Bö 鈴木' });
  });

  it('refuses another origin with 403', async () => {
    assert.equal((await upgrade({ sid: 'sid-bo', origin: 'https://evil.example' })).status, 403);
    assert.equal((await upgrade({ sid: 'sid-bo', origin: null })).status, 403);
  });

  it('refuses no login with 401 and a stranger with 404', async () => {
    assert.equal((await upgrade({})).status, 401);
    assert.equal((await upgrade({ sid: 'sid-cy' })).status, 404);
  });

  it('refuses a page that is not shared, or not live for its owner, with 404', async () => {
    await exec('DELETE FROM lyric_shares');
    assert.equal((await upgrade({ sid: 'sid-ann' })).status, 404);
    await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) ' +
      "VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", PAGE);
    env.LIVE_EDITING = 'allowlist';
    env.LIVE_EDITING_USERS = 'bo';
    assert.equal((await upgrade({ sid: 'sid-bo' })).status, 404);
  });

  it('asks for an upgrade with 426', async () => {
    const request = new Request(`${BASE_URL}/api/lyrics/${PAGE}/live`, { headers: { Cookie: 'sid=sid-bo' } });
    assert.equal((await live.onRequestGet({ request, env, params: { id: PAGE } })).status, 426);
  });

  it('limits connects per person with 429', async () => {
    let last;
    for (let i = 0; i <= 30; i += 1) last = await upgrade({ sid: 'sid-bo' });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('Retry-After')) > 0);
  });
});

describe('the middleware', () => {
  it('passes a 101 through untouched, so its socket survives', async () => {
    const handoff = { status: 101, webSocket: {} };
    const request = new Request(`${BASE_URL}/api/lyrics/${PAGE}/live`);
    const answer = await apiMiddleware({ request, env, next: async () => handoff });
    assert.equal(answer, handoff);
  });
});
