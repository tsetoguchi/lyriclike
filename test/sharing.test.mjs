// Sharing a page by email: who can open, save, rename and leave a shared
// page, the invite mail and its limits, and the "stop emails" route. Each test
// runs the real handlers against a fresh database built from migrations/.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';
import * as signup from '../functions/api/auth/signup.js';
import * as confirm from '../functions/api/auth/signup/confirm.js';
import * as stop from '../functions/api/invites/stop.js';
import * as lyricById from '../functions/api/lyrics/[id].js';
import * as shares from '../functions/api/lyrics/[id]/shares.js';
import * as lyricList from '../functions/api/lyrics/index.js';
import * as me from '../functions/api/me.js';
import { inviteStopToken, sendResetEmail } from '../functions/_email.js';
import { sha256Hex } from '../functions/_shared.js';
import {
  BASE_URL, GOOD_PASSWORD, addSession, events, latestToken, makeEnv, post, query, stubServices,
  turnstileToken,
} from './support/auth-harness.mjs';

const PAGE = 'alice-page';
const TITLE = 'Our song';
const BODY = 'the words';

let env;
let services;

async function addUser(name, { email = `${name}@example.com`, displayName = name } = {}) {
  const id = `user-${name}`;
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, email, email.toLowerCase(), displayName, 1).run();
  const sid = `sid-${name}`;
  await addSession(env, id, sid);
  return { id, sid, email };
}

async function addPage(ownerId, id = PAGE) {
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, ownerId, TITLE, BODY, 1, 1).run();
}

// Calls a handler the way Pages does, and waits for its waitUntil work.
async function call(handler, method, path, { sid, json, id = PAGE } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sid) headers.Cookie = `sid=${sid}`;
  const request = new Request(BASE_URL + path, {
    method, headers, body: json === undefined ? undefined : JSON.stringify(json),
  });
  const pending = [];
  const name = `onRequest${method[0]}${method.slice(1).toLowerCase()}`;
  const response = await handler[name]({ request, env, params: { id }, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return response;
}

const share = (sid, email, id = PAGE) =>
  call(shares, 'POST', `/api/lyrics/${id}/shares`, { sid, json: { email }, id });
const unshare = (sid, email) => call(shares, 'DELETE', `/api/lyrics/${PAGE}/shares`, { sid, json: { email } });
const listShares = sid => call(shares, 'GET', `/api/lyrics/${PAGE}/shares`, { sid });
const getPage = (sid, id = PAGE) => call(lyricById, 'GET', `/api/lyrics/${id}`, { sid, id });
const pollPage = sid => call(lyricById, 'GET', `/api/lyrics/${PAGE}?meta=1`, { sid });
const savePage = (sid, json, id = PAGE) => call(lyricById, 'PUT', `/api/lyrics/${id}`, { sid, json, id });
const renamePage = (sid, title) => call(lyricById, 'PATCH', `/api/lyrics/${PAGE}`, { sid, json: { title } });
const deletePage = sid => call(lyricById, 'DELETE', `/api/lyrics/${PAGE}`, { sid });
const listPages = sid => call(lyricList, 'GET', '/api/lyrics', { sid });
const deleteAccount = sid => call(me, 'DELETE', '/api/me', { sid });

async function storedPage() {
  return (await query(env, 'SELECT * FROM lyrics WHERE id = ?', PAGE))[0] || null;
}

async function shareRows() {
  return query(env, 'SELECT * FROM lyric_shares ORDER BY created_at');
}

async function setCounter(key, count) {
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)'
  ).bind(key, count, Date.now()).run();
}

async function counter(key) {
  const [row] = await query(env, 'SELECT count FROM rate_limits WHERE key = ?', key);
  return row ? row.count : 0;
}

let alice;
let bob;
let carol;

beforeEach(async () => {
  env = makeEnv();
  services = stubServices();
  alice = await addUser('alice', { displayName: 'Alice' });
  bob = await addUser('bob');
  carol = await addUser('carol');
  await addPage(alice.id);
});

afterEach(() => {
  services.restore();
});

describe('sharing a page', () => {
  it('emails a friend with an account a link to the page', async () => {
    const response = await share(alice.sid, 'Bob@Example.com');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'shared', email: 'Bob@Example.com', emailed: true, link: `${BASE_URL}/#shared=${PAGE}`,
    });

    const [mail] = services.mail;
    assert.deepEqual(mail.to, ['Bob@Example.com']);
    assert.equal(mail.subject, `Alice shared "${TITLE}" with you`);
    assert.match(mail.text, new RegExp(`${BASE_URL}/#shared=${PAGE}\\n`));
    assert.doesNotMatch(mail.text, /signup=1/);
    assert.doesNotMatch(mail.text + mail.html, new RegExp(BODY));
    assert.deepEqual(await events(env), ['share_sent']);
  });

  it('asks a friend with no account to sign up with that address', async () => {
    await share(alice.sid, 'new@example.com');
    const [mail] = services.mail;
    assert.match(mail.text, new RegExp(`#shared=${PAGE}&signup=1`));
    assert.match(mail.html, /Sign up to see it/);
  });

  it('answers the same whether or not the address has an account', async () => {
    await addPage(alice.id, 'second');
    const withAccount = await (await share(alice.sid, 'bob@example.com')).json();
    const withoutAccount = await (await share(alice.sid, 'nobody@example.com', 'second')).json();
    assert.deepEqual(Object.keys(withAccount), Object.keys(withoutAccount));
    assert.equal(withAccount.status, withoutAccount.status);
    assert.equal(withAccount.emailed, withoutAccount.emailed);
  });

  it('adds a stop link and one-click unsubscribe headers that hold no address', async () => {
    await share(alice.sid, 'bob@example.com');
    const [{ headers, text, html }] = services.mail;
    const token = await inviteStopToken(env, 'bob@example.com');

    assert.equal(headers['List-Unsubscribe'], `<${BASE_URL}/api/invites/stop?token=${token}>`);
    assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.match(text, new RegExp(`${BASE_URL}/#stop_token=${token.replace('.', '\\.')}`));
    assert.match(html, /Stop emails like this\./);
    assert.doesNotMatch(token, /bob/);
  });

  it('keeps names and titles to one short line in the subject', async () => {
    await env.lyricalmiracle_db.prepare('UPDATE users SET name = ? WHERE id = ?')
      .bind('LyricLike\r\nSecurity Team Very Official Name That Goes On', alice.id).run();
    await env.lyricalmiracle_db.prepare('UPDATE lyrics SET title = ? WHERE id = ?')
      .bind('Claim\nyour prize ' + 'x'.repeat(100), PAGE).run();
    await share(alice.sid, 'bob@example.com');

    const { subject } = services.mail[0];
    assert.doesNotMatch(subject, /[\r\n]/);
    assert.ok(subject.length < 130, subject);
  });

  it('refuses an address that is not one, or is the sender’s own', async () => {
    assert.equal((await share(alice.sid, 'not-an-email')).status, 400);
    assert.equal((await share(alice.sid, 'bob@localhost')).status, 400);
    assert.equal((await share(alice.sid, 'ALICE@example.com')).status, 400);
    assert.deepEqual(await shareRows(), []);
  });

  it('says "already shared" and sends no second mail', async () => {
    await share(alice.sid, 'bob@example.com');
    const again = await share(alice.sid, 'BOB@example.com');
    assert.equal((await again.json()).status, 'already_shared');
    assert.equal(services.mail.length, 1);
  });

  it('is only for the owner: an editor or a stranger gets 404', async () => {
    await share(alice.sid, 'bob@example.com');
    assert.equal((await share(bob.sid, 'dave@example.com')).status, 404);
    assert.equal((await share(carol.sid, 'dave@example.com')).status, 404);
    assert.equal((await shareRows()).length, 1);
  });
});

describe('invite limits', () => {
  it('still shares past 5 invites a day, but sends no mail and says so', async () => {
    for (let i = 0; i < 5; i++) await share(alice.sid, `friend${i}@example.com`);
    const sixth = await (await share(alice.sid, 'friend5@example.com')).json();

    assert.equal(sixth.status, 'shared');
    assert.equal(sixth.emailed, false);
    assert.equal(services.mail.length, 5);
    assert.equal((await shareRows()).length, 6);
    assert.equal((await shareRows())[5].emailed, 0);
    assert.ok((await events(env)).includes('email_skipped_sender'));
  });

  it('sends one address at most 2 invites a day, without touching its signup and reset limit', async () => {
    const dave = await addUser('dave');
    await addPage(bob.id, 'bob-page');
    await addPage(carol.id, 'carol-page');
    await addPage(dave.id, 'dave-page');
    await share(alice.sid, 'target@example.com');
    await share(bob.sid, 'target@example.com', 'bob-page');
    const third = await (await share(carol.sid, 'target@example.com', 'carol-page')).json();

    assert.equal(third.emailed, false);
    assert.equal(services.mail.length, 2);
    assert.ok((await events(env)).includes('email_skipped_address'));

    await sendResetEmail({ env, request: new Request(BASE_URL) }, { to: 'target@example.com', token: 'a'.repeat(64) });
    assert.equal(services.mail.length, 3);
  });

  it('logs a full invite pool, and a refused invite uses up nobody’s allowance', async () => {
    await setCounter('email:pool:invite', 30);
    const answer = await (await share(alice.sid, 'bob@example.com')).json();

    assert.equal(answer.emailed, false);
    assert.equal(services.mail.length, 0);
    assert.ok((await events(env)).includes('email_skipped_pool_invite'));
    assert.equal(await counter(`email:invite:sender:${alice.id}`), 0);
    assert.equal(await counter(`email:invite:addr:${await sha256Hex('bob@example.com')}`), 0);
  });

  it('refuses the 21st share in a day with 429 and adds no row', async () => {
    await setCounter(`share:rows:${alice.id}`, 20);
    const response = await share(alice.sid, 'bob@example.com');
    assert.equal(response.status, 429);
    assert.deepEqual(await shareRows(), []);
  });

  it('shares a page with 25 people at most', async () => {
    for (let i = 0; i < 25; i++) {
      await env.lyricalmiracle_db.prepare(
        'INSERT INTO lyric_shares (lyric_id, email_normalized, email, had_account, emailed, created_at) ' +
        'VALUES (?, ?, ?, 0, 0, ?)'
      ).bind(PAGE, `p${i}@example.com`, `p${i}@example.com`, i).run();
    }
    assert.equal((await share(alice.sid, 'bob@example.com')).status, 409);
  });

  it('sends no mail to an address that opted out, and does not tell the sender', async () => {
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO email_suppressions (address_hash, created_at) VALUES (?, ?)'
    ).bind(await sha256Hex('bob@example.com'), 1).run();
    const answer = await (await share(alice.sid, 'bob@example.com')).json();

    assert.equal(answer.emailed, true);
    assert.equal(services.mail.length, 0);
    assert.equal((await shareRows()).length, 1);
  });
});

describe('a shared page', () => {
  beforeEach(async () => {
    await share(alice.sid, 'bob@example.com');
  });

  it('opens for the editor, and says whose it is', async () => {
    const response = await getPage(bob.sid);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.body, BODY);
    assert.equal(page.role, 'editor');
    assert.equal(page.owner_name, 'Alice');
    assert.equal(page.share_count, 1);
  });

  it('tells the owner it is shared', async () => {
    const page = await (await getPage(alice.sid)).json();
    assert.equal(page.role, 'owner');
    assert.equal(page.share_count, 1);
  });

  it('stays closed to anyone signed in with another address', async () => {
    assert.equal((await getPage(carol.sid)).status, 404);
    assert.equal((await pollPage(carol.sid)).status, 404);
    assert.equal((await savePage(carol.sid, { body: 'x', base_revision: 0 })).status, 404);
    assert.equal((await renamePage(carol.sid, 'x')).status, 404);
  });

  it('can be saved and renamed by the editor', async () => {
    assert.equal((await savePage(bob.sid, { body: 'bob wrote', base_revision: 0 })).status, 200);
    assert.equal((await renamePage(bob.sid, 'Bob named it')).status, 200);
    const stored = await storedPage();
    assert.equal(stored.body, 'bob wrote');
    assert.equal(stored.title, 'Bob named it');
    assert.equal(stored.user_id, alice.id);
  });

  it('never lets an editor create over it or take it over', async () => {
    const response = await savePage(bob.sid, { title: 'mine now', body: 'x' });
    assert.equal(response.status, 409);
    const stored = await storedPage();
    assert.equal(stored.user_id, alice.id);
    assert.equal(stored.body, BODY);
  });

  it('is in the editor’s list, marked shared, after their own pages', async () => {
    await addPage(bob.id, 'bob-own');
    const listed = await (await listPages(bob.sid)).json();
    assert.deepEqual(listed.map(page => page.id), ['bob-own', PAGE]);
    assert.equal(listed[1].shared, true);
    assert.equal(listed[1].owner_name, 'Alice');
    assert.equal(listed[1].role, 'editor');
  });

  it('shows in the owner’s list with its share count', async () => {
    const [page] = await (await listPages(alice.sid)).json();
    assert.equal(page.share_count, 1);
    assert.equal(page.shared, undefined);
  });

  it('records the first open once, and never from the poll', async () => {
    await pollPage(bob.sid);
    assert.equal((await shareRows())[0].first_opened_at, null);

    await getPage(bob.sid);
    const opened = (await shareRows())[0].first_opened_at;
    assert.ok(opened);
    await getPage(bob.sid);
    assert.equal((await shareRows())[0].first_opened_at, opened);
    assert.deepEqual((await events(env)).filter(e => e === 'share_opened'), ['share_opened']);
  });

  it('lists who has it for the owner and the editor, and 404 for anyone else', async () => {
    await getPage(bob.sid);
    const forOwner = await (await listShares(alice.sid)).json();
    assert.deepEqual(forOwner, {
      role: 'owner',
      owner: { name: 'Alice', email: 'alice@example.com' },
      people: [{ email: 'bob@example.com', joined: true }],
    });
    assert.equal((await (await listShares(bob.sid)).json()).role, 'editor');
    assert.equal((await listShares(carol.sid)).status, 404);
  });

  it('lets the editor leave; the page stays with its owner', async () => {
    assert.equal((await deletePage(bob.sid)).status, 204);
    assert.ok(await storedPage());
    assert.deepEqual(await shareRows(), []);
    assert.equal((await getPage(bob.sid)).status, 404);
  });

  it('lets the editor remove only themselves', async () => {
    await share(alice.sid, 'carol@example.com');
    assert.equal((await unshare(bob.sid, 'carol@example.com')).status, 404);
    assert.equal((await unshare(bob.sid, 'bob@example.com')).status, 204);
    assert.deepEqual((await shareRows()).map(row => row.email), ['carol@example.com']);
  });

  it('lets the owner remove anyone, which closes the page to them', async () => {
    assert.equal((await unshare(alice.sid, 'bob@example.com')).status, 204);
    assert.equal((await getPage(bob.sid)).status, 404);
  });

  it('is deleted with its share list when the owner deletes it', async () => {
    assert.equal((await deletePage(alice.sid)).status, 204);
    assert.equal(await storedPage(), null);
    assert.deepEqual(await shareRows(), []);
  });

  it('keeps its share list when a stranger calls delete on it', async () => {
    await deletePage(carol.sid);
    assert.ok(await storedPage());
    assert.equal((await shareRows()).length, 1);
  });

  it('does not stop the owner or the editor from deleting their accounts', async () => {
    await addPage(bob.id, 'bob-own');
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO lyric_shares (lyric_id, email_normalized, email, had_account, emailed, created_at) ' +
      'VALUES (?, ?, ?, 0, 0, ?)'
    ).bind('bob-own', 'carol@example.com', 'carol@example.com', 1).run();

    assert.equal((await deleteAccount(bob.sid)).status, 200);
    assert.ok(await storedPage());
    assert.deepEqual((await shareRows()).map(row => row.lyric_id), []);

    await share(alice.sid, 'carol@example.com');
    assert.equal((await deleteAccount(alice.sid)).status, 200);
    assert.equal(await storedPage(), null);
    assert.deepEqual(await shareRows(), []);
  });
});

describe('a share made before the friend signs up', () => {
  it('opens for them as soon as the account exists, and is counted', async () => {
    await share(alice.sid, 'Newbie@Example.com');
    assert.equal((await shareRows())[0].had_account, 0);

    await post(signup, env, '/api/auth/signup', {
      email: 'newbie@example.com', password: GOOD_PASSWORD, name: 'Newbie', turnstile: turnstileToken('signup'),
    });
    const confirmed = await post(confirm, env, '/api/auth/signup/confirm', {
      token: latestToken(services, 'signup_token'), password: GOOD_PASSWORD,
    });
    const sid = /sid=([^;]+)/.exec(confirmed.headers.get('Set-Cookie'))[1];

    assert.equal((await getPage(sid)).status, 200);
    const [row] = await shareRows();
    const [user] = await query(env, 'SELECT id FROM users WHERE email_normalized = ?', 'newbie@example.com');
    assert.equal(row.user_id, user.id);
    assert.ok((await events(env)).includes('share_signup'));
  });
});

describe('the stop route', () => {
  function stopRequest({ token, json, form } = {}) {
    const url = BASE_URL + '/api/invites/stop' + (token ? `?token=${encodeURIComponent(token)}` : '');
    const init = { method: 'POST', headers: {} };
    if (json) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
    if (form) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = form;
    }
    return new Request(url, init);
  }

  async function suppressed() {
    return (await query(env, 'SELECT address_hash FROM email_suppressions')).map(row => row.address_hash);
  }

  it('suppresses the address from our button, storing only its hash', async () => {
    const token = await inviteStopToken(env, 'bob@example.com');
    const response = await stop.onRequestPost({ request: stopRequest({ json: { token } }), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await suppressed(), [await sha256Hex('bob@example.com')]);
  });

  it('suppresses from a mail app’s one-click POST', async () => {
    const token = await inviteStopToken(env, 'bob@example.com');
    const request = stopRequest({ token, form: 'List-Unsubscribe=One-Click' });
    assert.equal((await stop.onRequestPost({ request, env })).status, 200);
    assert.equal((await suppressed()).length, 1);
  });

  it('only acts on POST', () => {
    assert.equal(stop.onRequestGet, undefined);
    assert.equal(stop.onRequest, undefined);
  });

  it('suppresses nothing for a bad token, and answers the same', async () => {
    const good = await inviteStopToken(env, 'bob@example.com');
    const [hash, signature] = good.split('.');
    const other = await inviteStopToken(makeEnv({ INVITE_SIGNING_SECRET: 'another' }), 'bob@example.com');
    const bad = [
      'junk', good.slice(0, -3), `${await sha256Hex('carol@example.com')}.${signature}`,
      `${hash}.${'A'.repeat(43)}`, other, '',
    ];
    for (const token of bad) {
      const response = await stop.onRequestPost({ request: stopRequest({ json: { token } }), env });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(await suppressed(), []);
  });

  it('gets its one-click POST past the API guard, and only that route does', async () => {
    const next = async () => Response.json({ ok: true });
    const form = { form: 'List-Unsubscribe=One-Click', token: 'x' };
    const through = await apiMiddleware({ request: stopRequest(form), next });
    assert.equal(through.status, 200);

    const elsewhere = new Request(BASE_URL + '/api/lyrics/x', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=b',
    });
    assert.equal((await apiMiddleware({ request: elsewhere, next })).status, 403);

    const sameSite = new Request(BASE_URL + '/api/lyrics/x', {
      method: 'POST',
      headers: { Origin: BASE_URL, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=b',
    });
    assert.equal((await apiMiddleware({ request: sameSite, next })).status, 415);
  });
});
