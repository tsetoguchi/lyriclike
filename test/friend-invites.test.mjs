// Inviting a friend: the invite link, a new account taking its code, the
// extra pages both sides get once the friend saves a page, and the event hook
// message that says so.
//
//   node --test test/friend-invites.test.mjs

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import * as account from '../functions/api/account.js';
import * as lyricById from '../functions/api/lyrics/[id].js';
import * as invite from '../functions/api/me/invite.js';
import * as me from '../functions/api/me.js';
import { addGoogleUser, addSession, BASE_URL, makeEnv, query } from './support/auth-harness.mjs';

const INVITER = { id: 'inviter-1', email: 'ann@example.com', token: 'inviter-token' };
const FRIEND = { id: 'friend-1', email: 'bea@example.com', token: 'friend-token' };
const PAGE_LIMIT = { DEFAULT_PAGE_LIMIT: '5' };
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const HOOK = { EVENT_HOOK_URL: 'https://hooks.example.com/events', EVENT_HOOK_SECRET: 'hook-secret' };
const INVITE_REWARDED = 'invite.rewarded';

async function addPerson(env, person, createdAt = Date.now()) {
  await addGoogleUser(env, { id: person.id, email: person.email });
  await env.lyricalmiracle_db.prepare('UPDATE users SET created_at = ? WHERE id = ?')
    .bind(createdAt, person.id).run();
  await addSession(env, person.id, person.token);
}

async function setUp(settings = PAGE_LIMIT) {
  const env = makeEnv(settings);
  await addPerson(env, INVITER, 1);
  await addPerson(env, FRIEND);
  return env;
}

async function call(handler, env, person, method, path, { json, id } = {}) {
  const request = new Request(BASE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `sid=${person.token}` },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const pending = [];
  const name = `onRequest${method[0]}${method.slice(1).toLowerCase()}`;
  const response = await handler[name]({
    request, env, params: { id }, waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  return response;
}

async function inviteCode(env, person = INVITER) {
  const response = await call(invite, env, person, 'GET', '/api/me/invite');
  assert.equal(response.status, 200);
  const body = await response.json();
  return { body, code: new URL(body.url).searchParams.get('invite') };
}

async function claim(env, person, code) {
  const response = await call(invite, env, person, 'POST', '/api/me/invite', { json: { code } });
  return { status: response.status, body: await response.json() };
}

function createPage(env, person, id) {
  return call(lyricById, env, person, 'PUT', `/api/lyrics/${id}`, { json: { body: 'words' }, id });
}

async function pageLimit(env, person) {
  const response = await call(me, env, person, 'GET', '/api/me');
  return (await response.json()).page_limit;
}

describe('the invite link', () => {
  it('is the home page with a 10-letter code, the same each time', async () => {
    const env = await setUp();
    const first = await inviteCode(env);
    const second = await inviteCode(env);
    assert.match(first.body.url, /^https:\/\/lyriclike\.com\/\?invite=[0-9a-f]{10}$/);
    assert.equal(first.code, second.code);
    assert.deepEqual(
      { ...first.body, url: undefined },
      { url: undefined, friends_joined: 0, pages_per_friend: 2, max_friends: 5 },
    );
  });
});

describe('a friend taking the code', () => {
  it('a new account takes it; nobody gets pages until the friend saves one', async () => {
    const env = await setUp();
    const { code } = await inviteCode(env);
    assert.deepEqual((await claim(env, FRIEND, code)).body,
      { claimed: true, rewarded: false, pages_per_friend: 2 });
    assert.equal(await pageLimit(env, INVITER), 5);
    assert.equal(await pageLimit(env, FRIEND), 5);
  });

  it('after the first page, both sides have 2 more pages', async () => {
    const env = await setUp();
    const { code } = await inviteCode(env);
    await claim(env, FRIEND, code);
    assert.equal((await createPage(env, FRIEND, 'friend-page')).status, 200);
    assert.equal(await pageLimit(env, INVITER), 7);
    assert.equal(await pageLimit(env, FRIEND), 7);
    assert.equal((await inviteCode(env)).body.friends_joined, 1);
  });

  it('a friend who already saved a page is rewarded at once', async () => {
    const env = await setUp();
    await createPage(env, FRIEND, 'friend-page');
    const { body } = await claim(env, FRIEND, (await inviteCode(env)).code);
    assert.equal(body.rewarded, true);
    assert.equal(await pageLimit(env, INVITER), 7);
  });

  it('a second page does not count twice', async () => {
    const env = await setUp();
    await claim(env, FRIEND, (await inviteCode(env)).code);
    await createPage(env, FRIEND, 'page-a');
    await createPage(env, FRIEND, 'page-b');
    assert.equal(await pageLimit(env, INVITER), 7);
  });

  it('an account older than a day cannot take a code', async () => {
    const env = await setUp();
    await env.lyricalmiracle_db.prepare('UPDATE users SET created_at = ? WHERE id = ?')
      .bind(Date.now() - TWO_DAYS_MS, FRIEND.id).run();
    assert.deepEqual((await claim(env, FRIEND, (await inviteCode(env)).code)).body,
      { claimed: false, rewarded: false, pages_per_friend: 2 });
  });

  it('nobody can take their own code', async () => {
    const env = await setUp();
    await env.lyricalmiracle_db.prepare('UPDATE users SET created_at = ? WHERE id = ?')
      .bind(Date.now(), INVITER.id).run();
    assert.deepEqual((await claim(env, INVITER, (await inviteCode(env)).code)).body,
      { claimed: false, rewarded: false, pages_per_friend: 2 });
  });

  it('only the first code counts', async () => {
    const env = await setUp();
    const other = { id: 'other-1', email: 'cy@example.com', token: 'other-token' };
    await addPerson(env, other, 1);
    await claim(env, FRIEND, (await inviteCode(env)).code);
    const second = await claim(env, FRIEND, (await inviteCode(env, other)).code);
    assert.deepEqual(second.body, { claimed: false, rewarded: false, pages_per_friend: 2 });
  });

  it('an unknown code is not claimed; a badly shaped one is a 400', async () => {
    const env = await setUp();
    assert.deepEqual((await claim(env, FRIEND, '0123456789')).body, { claimed: false, rewarded: false, pages_per_friend: 2 });
    assert.equal((await claim(env, FRIEND, 'nope')).status, 400);
  });
});

describe('the bonus', () => {
  it('stops at 5 friends: +10 pages', async () => {
    const env = await setUp();
    const { code } = await inviteCode(env);
    for (let i = 0; i < 6; i++) {
      const friend = { id: `friend-x${i}`, email: `f${i}@example.com`, token: `t${i}` };
      await addPerson(env, friend);
      await claim(env, friend, code);
      await createPage(env, friend, `page-x${i}`);
    }
    assert.equal(await pageLimit(env, INVITER), 15);
  });

  it('with no page limit there is nothing to add to', async () => {
    const env = await setUp({});
    await claim(env, FRIEND, (await inviteCode(env)).code);
    await createPage(env, FRIEND, 'friend-page');
    assert.equal(await pageLimit(env, INVITER), null);
  });

  it('INVITE_BONUS_PAGES sets the pages per friend', async () => {
    const env = await setUp({ ...PAGE_LIMIT, INVITE_BONUS_PAGES: '3' });
    const { code, body } = await inviteCode(env);
    assert.equal(body.pages_per_friend, 3);
    await claim(env, FRIEND, code);
    await createPage(env, FRIEND, 'friend-page');
    assert.equal(await pageLimit(env, INVITER), 8);
  });

  it('INVITE_BONUS_PAGES=0 turns the bonus off, and /api/me says so', async () => {
    const env = await setUp({ ...PAGE_LIMIT, INVITE_BONUS_PAGES: '0' });
    const { code, body } = await inviteCode(env);
    assert.equal(body.pages_per_friend, 0);
    await claim(env, FRIEND, code);
    await createPage(env, FRIEND, 'friend-page');
    assert.equal(await pageLimit(env, INVITER), 5);
    const meBody = await (await call(me, env, INVITER, 'GET', '/api/me')).json();
    assert.equal(meBody.invite_pages_per_friend, 0);
  });

  it('a value that is not a whole number keeps 2', async () => {
    for (const value of ['', 'two', '-1', '1.5']) {
      const env = await setUp({ ...PAGE_LIMIT, INVITE_BONUS_PAGES: value });
      assert.equal((await inviteCode(env)).body.pages_per_friend, 2, value);
    }
  });

  it('counts toward the enforced cap: 5 pages + 1 friend lets a 6th page in', async () => {
    const env = await setUp({ ...PAGE_LIMIT, LIMITS_ENFORCED: 'on' });
    for (let i = 0; i < 5; i++) await createPage(env, INVITER, `own-${i}`);
    assert.equal((await createPage(env, INVITER, 'own-5')).status, 402);
    await claim(env, FRIEND, (await inviteCode(env)).code);
    await createPage(env, FRIEND, 'friend-page');
    assert.equal((await createPage(env, INVITER, 'own-5')).status, 200);
  });
});

describe('invites and account delete', () => {
  it("deleting the friend's account removes the invite and the inviter's bonus", async () => {
    const env = await setUp();
    await claim(env, FRIEND, (await inviteCode(env)).code);
    await createPage(env, FRIEND, 'friend-page');
    const response = await call(account, env, FRIEND, 'DELETE', '/api/account');
    assert.equal(response.status, 200);
    assert.deepEqual(await query(env, 'SELECT * FROM friend_invites'), []);
    assert.equal(await pageLimit(env, INVITER), 5);
  });

  it("deleting the inviter's account removes its code and invites", async () => {
    const env = await setUp();
    await claim(env, FRIEND, (await inviteCode(env)).code);
    const response = await call(account, env, INVITER, 'DELETE', '/api/account');
    assert.equal(response.status, 200);
    assert.deepEqual(await query(env, 'SELECT * FROM invite_codes'), []);
    assert.deepEqual(await query(env, 'SELECT * FROM friend_invites'), []);
  });
});

describe('the event hook hears invite.rewarded', () => {
  let originalFetch;
  let sent;

  async function setUpWithHook() {
    sent = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (url !== HOOK.EVENT_HOOK_URL) throw new Error(`unexpected fetch ${url}`);
      sent.push(JSON.parse(init.body));
      return new Response(null, { status: 200 });
    };
    return setUp({ ...PAGE_LIMIT, ...HOOK });
  }

  function rewardMessages() {
    return sent.filter(message => message.type === INVITE_REWARDED)
      .map(message => message.data);
  }

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = null;
  });

  it("on the friend's first page, once", async () => {
    const env = await setUpWithHook();
    await claim(env, FRIEND, (await inviteCode(env)).code);
    assert.deepEqual(rewardMessages(), []);
    await createPage(env, FRIEND, 'page-a');
    await createPage(env, FRIEND, 'page-b');
    assert.deepEqual(rewardMessages(), [{ inviter_id: INVITER.id, friend_id: FRIEND.id }]);
  });

  it('when a friend who already saved a page takes the code', async () => {
    const env = await setUpWithHook();
    await createPage(env, FRIEND, 'page-a');
    await claim(env, FRIEND, (await inviteCode(env)).code);
    assert.deepEqual(rewardMessages(), [{ inviter_id: INVITER.id, friend_id: FRIEND.id }]);
  });

  it('never for a page with no invite behind it', async () => {
    const env = await setUpWithHook();
    await createPage(env, INVITER, 'own-page');
    assert.deepEqual(rewardMessages(), []);
  });

  it('even when the bonus pages are off', async () => {
    const env = await setUpWithHook();
    env.INVITE_BONUS_PAGES = '0';
    await claim(env, FRIEND, (await inviteCode(env)).code);
    await createPage(env, FRIEND, 'page-a');
    assert.equal(rewardMessages().length, 1);
  });
});
