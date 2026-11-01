// One-time tickets for the mobile apps: the live-socket ticket, and the code
// that carries a Google sign-in from the system browser back to the app.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as appExchange from '../functions/api/auth/app-exchange.js';
import * as callback from '../functions/api/auth/google/callback.js';
import * as googleStart from '../functions/api/auth/google/start.js';
import * as liveTicket from '../functions/api/lyrics/[id]/live-ticket.js';
import * as live from '../functions/api/lyrics/[id]/live.js';
import {
  SIGNIN_TICKET, SOCKET_TICKET, issueAppTicket, redeemAppTicket,
} from '../functions/_app-tickets.js';
import { sha256Hex } from '../functions/_shared.js';
import {
  BASE_URL, addSession, makeEnv, post, query,
} from './support/auth-harness.mjs';
import { fakeRoomBinding } from './support/fake-room-binding.mjs';

const PAGE = 'page-1';
const IOS_ORIGIN = 'capacitor://localhost';
const OTHER_ORIGIN = 'https://evil.example';
const VERIFIER = 'a-secret-only-the-app-knows';
const BEARER = 'bearer-token-bo';
const NO_CONTENT = 204;
const UNAUTHORIZED = 401;
const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const OK = 200;

let env;

async function exec(sql, ...params) {
  await env.lyricalmiracle_db.prepare(sql).bind(...params).run();
}

async function addUser(id) {
  const email = `${id}@example.com`;
  await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
    id, email, email, id);
}

beforeEach(async () => {
  env = makeEnv({ LIVE_EDITING: 'on', PAGE_ROOM: fakeRoomBinding() });
  await addUser('ann');
  await addUser('bo');
  await addSession(env, 'bo', BEARER);
  await exec("INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES (?, 'ann', 'S', 'b', 1, 1)", PAGE);
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at) ' +
    "VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", PAGE);
});

describe('tickets', () => {
  it('redeem once, then never again', async () => {
    const ticket = await issueAppTicket(env, { kind: SOCKET_TICKET, userId: 'bo', sessionId: 'h' });
    assert.deepEqual(await redeemAppTicket(env, ticket, SOCKET_TICKET),
      { user_id: 'bo', session_id: 'h', challenge: null });
    assert.equal(await redeemAppTicket(env, ticket, SOCKET_TICKET), null);
  });

  it('store only a hash', async () => {
    const ticket = await issueAppTicket(env, { kind: SOCKET_TICKET, userId: 'bo' });
    const [row] = await query(env, 'SELECT id FROM app_tickets');
    assert.equal(row.id, await sha256Hex(ticket));
  });

  it('are not accepted for another kind, and that attempt does not use them up', async () => {
    const ticket = await issueAppTicket(env, { kind: SOCKET_TICKET, userId: 'bo' });
    assert.equal(await redeemAppTicket(env, ticket, SIGNIN_TICKET), null);
    assert.notEqual(await redeemAppTicket(env, ticket, SOCKET_TICKET), null);
  });

  it('expire after a minute', async () => {
    const ticket = await issueAppTicket(env, { kind: SOCKET_TICKET, userId: 'bo' });
    await exec('UPDATE app_tickets SET expires_at = ?', Date.now() - 1);
    assert.equal(await redeemAppTicket(env, ticket, SOCKET_TICKET), null);
  });

  it('are refused when empty or not text', async () => {
    assert.equal(await redeemAppTicket(env, '', SOCKET_TICKET), null);
    assert.equal(await redeemAppTicket(env, undefined, SOCKET_TICKET), null);
  });
});

describe('POST /api/lyrics/:id/live-ticket', () => {
  function ask(headers) {
    const request = new Request(`${BASE_URL}/api/lyrics/${PAGE}/live-ticket`, { method: 'POST', headers });
    return liveTicket.onRequestPost({ request, env, params: { id: PAGE } });
  }

  it('gives a signed-in app a ticket', async () => {
    const response = await ask({ Authorization: `Bearer ${BEARER}` });
    const { ticket } = await response.json();
    assert.equal(response.status, OK);
    assert.equal((await redeemAppTicket(env, ticket, SOCKET_TICKET)).user_id, 'bo');
  });

  it('refuses a stranger', async () => {
    assert.equal((await ask({ Authorization: 'Bearer nope' })).status, UNAUTHORIZED);
  });

  it('is for the app only: a cookie alone gets nothing', async () => {
    assert.equal((await ask({ Cookie: `sid=${BEARER}` })).status, BAD_REQUEST);
    assert.equal((await query(env, 'SELECT id FROM app_tickets')).length, 0);
  });
});

describe('the live socket from the app', () => {
  function upgrade({ origin = IOS_ORIGIN, ticket, cookie } = {}) {
    const headers = { Upgrade: 'websocket', Origin: origin };
    if (cookie) headers.Cookie = cookie;
    const query = ticket ? `?protocol=1&epoch=e1&ticket=${ticket}` : '?protocol=1&epoch=e1';
    const request = new Request(`${BASE_URL}/api/lyrics/${PAGE}/live${query}`, { headers });
    return live.onRequestGet({ request, env, params: { id: PAGE } });
  }

  function newTicket(userId = 'bo') {
    return issueAppTicket(env, { kind: SOCKET_TICKET, userId, sessionId: 'session-hash' });
  }

  it('opens with a ticket and hands the room the ticket session, not the ticket', async () => {
    const response = await upgrade({ ticket: await newTicket() });
    assert.equal(response.status, NO_CONTENT);
    const [call] = env.PAGE_ROOM.calls;
    assert.equal(call.headers['x-room-session'], 'session-hash');
    assert.equal(new URL(call.url).search, '?protocol=1&epoch=e1');
  });

  it('works once: a replayed ticket is refused', async () => {
    const ticket = await newTicket();
    assert.equal((await upgrade({ ticket })).status, NO_CONTENT);
    assert.equal((await upgrade({ ticket })).status, UNAUTHORIZED);
  });

  it('refuses the app origin without a ticket, even with a cookie', async () => {
    assert.equal((await upgrade({})).status, UNAUTHORIZED);
    assert.equal((await upgrade({ cookie: `sid=${BEARER}` })).status, UNAUTHORIZED);
  });

  it('still checks that the person may open the page', async () => {
    await addSession(env, 'ann', 'unused');
    await addUser('cy');
    assert.equal((await upgrade({ ticket: await newTicket('cy') })).status, 404);
  });

  it('does not take a ticket from any other origin', async () => {
    assert.equal((await upgrade({ origin: OTHER_ORIGIN, ticket: await newTicket() })).status, FORBIDDEN);
  });
});

describe('Google sign-in for the app', () => {
  const originalFetch = globalThis.fetch;
  const challenge = () => sha256Hex(VERIFIER);

  beforeEach(() => {
    env.GOOGLE_CLIENT_ID = 'client-id';
    env.GOOGLE_CLIENT_SECRET = 'client-secret';
    env.OAUTH_REDIRECT_URL = BASE_URL + '/api/auth/google/callback';
    globalThis.fetch = async url => String(url).includes('oauth2.googleapis.com')
      ? Response.json({ access_token: 'access' })
      : Response.json({ sub: 'sub-bo', email: 'bo@example.com', email_verified: true, name: 'bo' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function start(search) {
    const request = new Request(`${BASE_URL}/api/auth/google/start${search}`);
    return googleStart.onRequestGet({ request, env });
  }

  async function finish(appChallenge) {
    const cookies = ['oauth_state=s', 'oauth_verifier=v'];
    if (appChallenge) cookies.push(`oauth_app_challenge=${appChallenge}`);
    const request = new Request(`${BASE_URL}/api/auth/google/callback?code=abc&state=s`, {
      headers: { Cookie: cookies.join('; ') },
    });
    const pending = [];
    const response = await callback.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    return response;
  }

  function exchange(body) {
    return post(appExchange, env, '/api/auth/app-exchange', body);
  }

  async function codeFrom(response) {
    return /lyriclike:\/\/auth\?code=([0-9a-f]{64})/.exec(await response.text())[1];
  }

  it('start remembers a well-formed challenge from the app', async () => {
    const response = await start(`?client=app&challenge=${await challenge()}`);
    assert.match(response.headers.get('Set-Cookie'), /oauth_app_challenge=[0-9a-f]{64}/);
  });

  it('start ignores a challenge that is not a hash, and the website flow', async () => {
    assert.doesNotMatch((await start('?client=app&challenge=zzz')).headers.get('Set-Cookie'), /oauth_app_challenge/);
    assert.doesNotMatch((await start('')).headers.get('Set-Cookie'), /oauth_app_challenge/);
  });

  it('the callback sends the app back with a code, and sets no session cookie', async () => {
    const response = await finish(await challenge());
    assert.equal(response.status, OK);
    assert.doesNotMatch(response.headers.get('Set-Cookie') || '', /sid=[0-9a-f]/);
    // Only the session seeded in beforeEach: the callback made no new one.
    assert.equal((await query(env, 'SELECT id FROM sessions')).length, 1);
    assert.equal((await query(env, 'SELECT id FROM app_tickets')).length, 1);
  });

  it('the website callback is unchanged: a cookie and a redirect', async () => {
    const response = await finish(null);
    assert.equal(response.status, 302);
    assert.match(response.headers.get('Set-Cookie'), /sid=[0-9a-f]{64}/);
  });

  it('the app trades the code and its secret for a session token', async () => {
    const code = await codeFrom(await finish(await challenge()));
    const response = await exchange({ code, verifier: VERIFIER });
    const body = await response.json();
    assert.equal(response.status, OK);
    assert.equal(body.user.email, 'bo@example.com');
    const rows = await query(env, 'SELECT user_id FROM sessions WHERE id = ?', await sha256Hex(body.token));
    assert.equal(rows[0].user_id, 'bo');
  });

  it('refuses a code without the secret, and the wrong guess burns the code', async () => {
    const code = await codeFrom(await finish(await challenge()));
    assert.equal((await exchange({ code, verifier: 'a-guess' })).status, UNAUTHORIZED);
    assert.equal((await exchange({ code, verifier: VERIFIER })).status, UNAUTHORIZED);
  });

  it('refuses a replayed code', async () => {
    const code = await codeFrom(await finish(await challenge()));
    assert.equal((await exchange({ code, verifier: VERIFIER })).status, OK);
    assert.equal((await exchange({ code, verifier: VERIFIER })).status, UNAUTHORIZED);
  });

  it('refuses a body without a code and verifier', async () => {
    assert.equal((await exchange({})).status, BAD_REQUEST);
    assert.equal((await exchange({ code: 'x' })).status, BAD_REQUEST);
  });
});
