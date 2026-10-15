// Browser sessions against the real room, in one process: two people's
// typing reaching each other, words typed before the first sync, saved
// acks, batching, reconnects, close codes and live renames.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import * as protocol from '../collab/src/protocol.js';
import binding from '../live-binding.js';
import liveCore from '../live-core.js';
import live from '../live.js';
import { createFakeD1 } from './support/fake-d1.mjs';
import { createFakeClock } from './support/fake-clock.mjs';
import { FakeTextarea } from './support/fake-textarea.mjs';
import { DiffMatchPatch, Y } from './support/live-deps.mjs';
import { createRoomLink } from './support/room-link.mjs';

const { LiveSession, TEXT } = live;
const PAGE = 'page-1';
const ANN = { userId: 'ann', email: 'ann@example.com', name: 'Ann', colour: 'hsl(1 65% 42%)', sessionId: 'session-ann' };
const BO = { userId: 'bo', email: 'bo@example.com', name: 'Bo', colour: 'hsl(2 65% 42%)', sessionId: 'session-bo' };
const LYRIC = { id: PAGE, body: 'hello', title: 'Song', live: true };

let db;
let link;
let clock;

async function exec(sql, ...params) {
  await db.prepare(sql).bind(...params).run();
}

function makeSession(identity, { body = LYRIC.body, loadDeps } = {}) {
  const textarea = new FakeTextarea(body);
  const frames = [];
  const page = {
    indicator: [], titles: [], notices: [], unavailable: [], expired: 0, reloads: 0, readOnly: false,
    isTitleFocusedFlag: false,
    setIndicator(text) { this.indicator.push(text); },
    showSaved() { this.indicator.push('Saved'); },
    onTitle(title) { this.titles.push(title); },
    isTitleFocused() { return this.isTitleFocusedFlag; },
    onUnavailable(info) { this.unavailable.push(info); },
    onSessionExpired() { this.expired += 1; },
    reload() { this.reloads += 1; },
    notice(text) { this.notices.push(text); },
    setReadOnly(isReadOnly) { this.readOnly = isReadOnly; },
    confirmed: [],
    onConfirmed(text) { this.confirmed.push(text); },
  };
  const env = {
    textarea, page, liveCore, createTextBinding: binding.createTextBinding,
    loadDeps: loadDeps || (async () => ({ Y, DiffMatchPatch, protocol })),
    openSocket: path => link.connect(path, identity),
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    random: () => 0.5,
    schedule: frame => frames.push(frame),
    isFocused: () => true,
    adjustScroll: () => {},
  };
  const session = new LiveSession(env);
  return { session, textarea, page, frames };
}

// Lets messages cross, runs due frames, and moves the clock a little, until
// nothing is left moving.
async function settle(...clients) {
  for (let round = 0; round < 30; round += 1) {
    await new Promise(resolve => setImmediate(resolve));
    for (const client of clients) for (const frame of client.frames.splice(0)) frame();
    clock.advance(250);
  }
}

async function runRoomAlarms() {
  for (let i = 0; i < 5 && link.host.alarmAt !== null; i += 1) {
    link.host.clock = Math.max(link.host.clock, link.host.alarmAt);
    link.host.alarmAt = null;
    await link.room.alarm();
  }
}

beforeEach(async () => {
  db = createFakeD1();
  for (const person of [ANN, BO]) {
    await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
      person.userId, person.email, person.email, person.name);
    await exec('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, 1)',
      person.sessionId, person.userId, 9e15);
  }
  await exec('INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) ' +
    "VALUES (?, 'ann', 'Song', 'hello', 0, 1, 1)", PAGE);
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, ' +
    "created_at) VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", PAGE);
  link = createRoomLink({ db, lyricId: PAGE });
  clock = createFakeClock();
});

describe('syncing and typing', () => {
  it("shows each person's typing on the other's screen", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    ann.textarea.type(5, ' world');
    bo.textarea.type(0, 'oh ');
    await settle(ann, bo);
    assert.equal(ann.textarea.value, 'oh hello world');
    assert.equal(bo.textarea.value, 'oh hello world');
  });

  it('keeps words typed before the first sync, rebased onto what the room has', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, ' there');
    await settle(ann);
    const bo = makeSession(BO);
    const opening = bo.session.open(LYRIC);
    bo.textarea.type(0, 'well ');
    await opening;
    await settle(ann, bo);
    assert.equal(bo.textarea.value, 'well hello there');
    assert.equal(ann.textarea.value, 'well hello there');
  });

  it('says Saving until the room has saved the edit, then Saved', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, '!');
    await settle(ann);
    assert.equal(ann.page.indicator.at(-1), TEXT.saving);
    await runRoomAlarms();
    await settle(ann);
    assert.equal(ann.page.indicator.at(-1), 'Saved');
  });

  it('sends a burst of typing as at most one message per 200 ms', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    const socket = link.sockets[0];
    const before = socket.sent.length;
    for (const letter of 'abcde') ann.textarea.type(0, letter);
    await new Promise(resolve => setImmediate(resolve));
    clock.advance(199);
    assert.ok(socket.sent.length - before <= 1);
    await settle(ann);
    assert.equal(link.room.text(), 'edcbahello');
  });

  it('flushes: true once the room saved everything, false if it cannot in time', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, '!');
    await settle(ann);
    const flushing = ann.session.flush();
    await runRoomAlarms();
    await settle(ann);
    assert.equal(await flushing, true);
    link.isDeaf = true;
    ann.textarea.type(0, '?');
    const stuck = ann.session.flush();
    clock.advance(6000);
    assert.equal(await stuck, false);
  });

  it('is live from open until close, and closes cleanly', async () => {
    const ann = makeSession(ANN);
    assert.equal(ann.session.isLive(), false);
    await ann.session.follow(LYRIC);
    assert.equal(ann.session.isLive(), true);
    await ann.session.follow({ ...LYRIC, live: false });
    assert.equal(ann.session.isLive(), false);
  });
});

describe('connection trouble', () => {
  async function openedPair() {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    return { ann, bo };
  }

  it('reconnects after a drop, and edits made offline reach the others', async () => {
    const { ann, bo } = await openedPair();
    link.drop(link.sockets[0]);
    await new Promise(resolve => setImmediate(resolve));
    ann.textarea.type(5, ' offline');
    clock.advance(5000);
    assert.equal(ann.page.indicator.at(-1), TEXT.offline);
    await settle(ann, bo);
    assert.equal(bo.textarea.value, 'hello offline');
  });

  it('finds a socket iOS killed while the tab slept, and reconnects', async () => {
    const { ann, bo } = await openedPair();
    link.isDeaf = true;
    ann.session.checkAlive();
    await new Promise(resolve => setImmediate(resolve));
    clock.advance(2001);
    link.isDeaf = false;
    ann.textarea.type(5, '!');
    await settle(ann, bo);
    assert.ok(link.sockets.length >= 3, 'a new socket was opened');
    assert.equal(bo.textarea.value, 'hello!');
  });

  it('sends a keepalive ping every 30 seconds', async () => {
    const { ann } = await openedPair();
    const socket = link.sockets[0];
    clock.advance(30_000);
    assert.ok(socket.sent.includes('ping'));
    assert.equal(ann.page.reloads, 0);
  });

  it('reloads on 4001, at the old app', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    link.sockets[0].closeFromServer(protocol.CLOSE.OLD_PROTOCOL);
    await settle(ann);
    assert.equal(ann.page.reloads, 1);
    assert.equal(link.sockets.length, 1, 'no reconnect');
  });

  it('reports a page no longer shared, saying whether words were unsaved', async () => {
    const { bo } = await openedPair();
    link.isDeaf = true;
    bo.textarea.type(0, 'x');
    link.isDeaf = false;
    await link.room.evict(BO.email);
    await settle(bo);
    assert.deepEqual(bo.page.unavailable, [{ hasUnsaved: true }]);
  });

  it('hands a signed-out close to the page', async () => {
    const { bo } = await openedPair();
    link.sockets[1].closeFromServer(protocol.CLOSE.SIGNED_OUT);
    await settle(bo);
    assert.equal(bo.page.expired, 1);
  });

  it('goes read-only with a notice when there are too many tabs, and does not retry', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    link.sockets[0].closeFromServer(protocol.CLOSE.TOO_MANY_TABS);
    await settle(ann);
    assert.equal(ann.page.readOnly, true);
    assert.deepEqual(ann.page.notices, [TEXT.tooManyTabs]);
    assert.equal(link.sockets.length, 1);
  });
});

describe('titles', () => {
  it("shows the co-writer's rename, unless I am typing in the title", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    ann.session.rename('Rain Song');
    await settle(ann, bo);
    assert.deepEqual(bo.page.titles, ['Rain Song']);
    bo.page.isTitleFocusedFlag = true;
    ann.session.rename('River Song');
    await settle(ann, bo);
    assert.deepEqual(bo.page.titles, ['Rain Song']);
  });

  it('keeps a rename made before the first sync', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await bo.session.open(LYRIC);
    await settle(bo);
    const opening = ann.session.open(LYRIC);
    ann.session.rename('Early');
    await opening;
    await settle(ann, bo);
    assert.deepEqual(bo.page.titles, ['Early']);
  });

  it('writes a live rename to D1 with the text', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.session.rename('Rain Song');
    await settle(ann);
    await runRoomAlarms();
    const stored = await db.prepare('SELECT title FROM lyrics WHERE id = ?').bind(PAGE).first();
    assert.equal(stored.title, 'Rain Song');
  });
});

describe('the confirmed text', () => {
  it('tells the page what the room has confirmed, for a reload to rebase on', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    assert.equal(ann.page.confirmed.at(-1), 'hello');
    ann.textarea.type(5, '!');
    await settle(ann);
    assert.equal(ann.page.confirmed.at(-1), 'hello');
    await runRoomAlarms();
    await settle(ann);
    assert.equal(ann.page.confirmed.at(-1), 'hello!');
  });
});

describe('review fixes', () => {
  const DEPS = { Y, DiffMatchPatch, protocol };

  function gatedDeps() {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    return { loadDeps: () => gate.then(() => DEPS), release };
  }

  it('opens one connection when a page is reopened while the bundle still loads', async () => {
    const deps = gatedDeps();
    const ann = makeSession(ANN, { loadDeps: deps.loadDeps });
    const first = ann.session.open(LYRIC);
    ann.session.close();
    const second = ann.session.open(LYRIC);
    deps.release();
    await Promise.all([first, second]);
    await settle(ann);
    assert.equal(link.sockets.length, 1);
    ann.textarea.type(5, ' world');
    await settle(ann);
    assert.equal(link.room.text(), 'hello world');
  });

  it('refuses to leave while the bundle loads if words were typed', async () => {
    const deps = gatedDeps();
    const ann = makeSession(ANN, { loadDeps: deps.loadDeps });
    ann.session.open(LYRIC);
    assert.equal(await ann.session.flush(), true);
    ann.textarea.type(5, '!');
    assert.equal(await ann.session.flush(), false);
  });

  it('waits for the first sync before letting words typed while connecting go', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    ann.textarea.type(5, '!');
    const flushing = ann.session.flush();
    let isDone = false;
    flushing.then(() => { isDone = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(isDone, false, 'must wait for the sync');
    await settle(ann);
    await runRoomAlarms();
    await settle(ann);
    assert.equal(await flushing, true);
    assert.equal(link.room.text(), 'hello!');
  });

  it("counts a co-writer's words as confirmed as soon as they arrive", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    bo.textarea.type(5, ' world');
    await settle(ann, bo);
    assert.equal(ann.page.confirmed.at(-1), 'hello world');
  });

  it('keeps the caret after words typed while connecting', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, ' there');
    await settle(ann);
    const bo = makeSession(BO);
    const opening = bo.session.open(LYRIC);
    bo.textarea.type(0, 'well ');
    await opening;
    await settle(ann, bo);
    assert.equal(bo.textarea.value, 'well hello there');
    assert.equal(bo.textarea.selectionStart, 5);
  });

  it('lifts read-only when the page is closed', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    link.sockets[0].closeFromServer(protocol.CLOSE.TOO_MANY_TABS);
    await settle(ann);
    assert.equal(ann.page.readOnly, true);
    ann.session.close();
    assert.equal(ann.page.readOnly, false);
  });

  it('retries a bundle that failed to load, staying live and saying offline', async () => {
    let tries = 0;
    const ann = makeSession(ANN, {
      loadDeps: async () => {
        tries += 1;
        if (tries === 1) throw new Error('network');
        return DEPS;
      },
    });
    await ann.session.open(LYRIC);
    assert.equal(ann.session.isLive(), true);
    assert.equal(ann.page.indicator.at(-1), TEXT.offline);
    ann.textarea.type(5, '!');
    clock.advance(5000);
    await settle(ann);
    assert.equal(link.room.text(), 'hello!');
  });

  it('takes the room as it is when the screen already matches it, after a reload', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, ' +ann');
    await settle(ann);
    ann.session.close();
    // A reload: the draft shows what was typed, but the room never confirmed it.
    const again = makeSession(ANN, { body: 'hello +ann' });
    await again.session.open({ ...LYRIC, body: 'hello' });
    await settle(again);
    assert.equal(again.textarea.value, 'hello +ann');
    assert.equal(link.room.text(), 'hello +ann');
  });

  it('knows which page it is live for', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    assert.equal(ann.session.isLiveFor(PAGE), true);
    assert.equal(ann.session.isLiveFor('other'), false);
  });
});

describe('going offline', () => {
  it('says offline as soon as the browser reports it, and syncs on return', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    ann.session.noteOffline();
    assert.equal(ann.page.indicator.at(-1), TEXT.offline);
    ann.textarea.type(5, '!');
    assert.equal(ann.page.indicator.at(-1), TEXT.offline);
    ann.session.reconnectNow();
    await settle(ann, bo);
    assert.equal(bo.textarea.value, 'hello!');
    assert.notEqual(ann.page.indicator.at(-1), TEXT.offline);
  });

  it('treats a keepalive with no answer as a dead socket', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    link.isDeaf = true;
    clock.advance(30_000);
    clock.advance(2001);
    assert.ok(link.sockets.length >= 2, 'a new socket was opened');
    clock.advance(5000);
    assert.equal(ann.page.indicator.at(-1), TEXT.offline);
  });
});
