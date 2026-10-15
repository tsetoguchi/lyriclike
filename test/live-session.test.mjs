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
import { createFakeLiveStore } from './support/fake-live-store.mjs';
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

function makeSession(identity, { body = LYRIC.body, loadDeps, store = createFakeLiveStore() } = {}) {
  const textarea = new FakeTextarea(body);
  const frames = [];
  const page = {
    indicator: [], titles: [], notices: [], unavailable: [], expired: 0, reloads: 0, readOnly: false,
    isTitleFocusedFlag: false,
    drafts: [],
    setIndicator(text) { this.indicator.push(text); },
    showSaved() { this.indicator.push('Saved'); },
    onTitle(title) { this.titles.push(title); },
    isTitleFocused() { return this.isTitleFocusedFlag; },
    onUnavailable(info) { this.unavailable.push(info); },
    onSessionExpired() { this.expired += 1; },
    reload() { this.reloads += 1; },
    notice(text) { this.notices.push(text); },
    setReadOnly(isReadOnly) { this.readOnly = isReadOnly; },
    // The page writes its draft from this, so it records what the draft holds.
    onLocalCopySaved(saved) { this.drafts.push(saved); },
    // On the way out the draft is written at once, with the newest changes.
    onLeaving(saved) { this.drafts.push(saved); },
  };
  const env = {
    textarea, page, store, liveCore, createTextBinding: binding.createTextBinding,
    loadDeps: loadDeps || (async () => ({ Y, DiffMatchPatch, protocol })),
    openSocket: path => link.connect(path, identity),
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    random: () => 0.5,
    schedule: frame => frames.push(frame),
    isFocused: () => true,
    adjustScroll: () => {},
  };
  const session = new LiveSession(env);
  return { session, textarea, page, frames, store };
}

const hop = () => new Promise(resolve => setImmediate(resolve));

function textOf(update) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc.getText('body').toString();
}

// The page went away (a reload, a closed browser) with `draft` as its last
// stored draft. A new page load shows the draft's words and reopens from
// the same device's copy. Closing the old connection stands in for the
// page dying: its socket goes, and nothing more is written.
function reload(client, identity, draft = client.page.drafts.at(-1)) {
  client.session.connection.close();
  const again = makeSession(identity, { body: draft.text, store: client.store });
  again.restore = { copyAt: draft.stamp, shown: draft.text, delta: draft.delta };
  return again;
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

// Like settle, but moving the clock only about a second: enough to sync and
// send, well inside the 5 s a flush waits.
async function settleBriefly(...clients) {
  for (let round = 0; round < 4; round += 1) {
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
    await settleBriefly(ann);
    await runRoomAlarms();
    await settle(ann);
    assert.equal(await flushing, true);
    assert.equal(link.room.text(), 'hello!');
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

describe('the local copy', () => {
  it('is written at most every 500 ms while words change, and the draft follows it', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    const before = ann.store.writes;
    ann.textarea.type(5, '!');
    ann.textarea.type(6, '!');
    clock.advance(499);
    assert.equal(ann.store.writes, before);
    clock.advance(1);
    assert.equal(ann.store.writes, before + 1);
    await hop();
    const copy = await ann.store.load(PAGE);
    assert.equal(textOf(copy.working), 'hello!!');
    assert.equal(copy.epoch, link.room.epoch);
    assert.deepEqual(ann.page.drafts.at(-1), { id: PAGE, stamp: copy.savedAt, text: 'hello!!', confirmed: 'hello' });
  });

  it('holds unsaved updates until the room has saved them', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, '!');
    await settle(ann);
    let copy = await ann.store.load(PAGE);
    assert.equal(copy.pending.length, 1);
    assert.equal(textOf(copy.confirmed), 'hello');
    await runRoomAlarms();
    await settle(ann);
    copy = await ann.store.load(PAGE);
    assert.equal(copy.pending.length, 0);
    assert.equal(textOf(copy.confirmed), 'hello!');
  });

  it('is not written before the first sync', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    ann.textarea.type(5, '!');
    clock.advance(1000);
    assert.equal(ann.store.writes, 0);
    assert.equal(ann.session.hasLocalCopy(), false);
  });

  it('starts clean: a fresh open drops a copy left from an earlier visit', async () => {
    const store = createFakeLiveStore();
    await store.save({ id: PAGE, epoch: 'old', savedAt: 1, working: new Uint8Array(), confirmed: new Uint8Array(), pending: [] });
    const ann = makeSession(ANN, { store });
    await ann.session.open(LYRIC);
    assert.equal(await store.load(PAGE), null);
  });

  it('is removed when the page closes, and kept when asked', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.session.close({ keepCopy: true });
    await hop();
    assert.ok(await ann.store.load(PAGE));
    ann.session.close();
    await hop();
    assert.equal(await ann.store.load(PAGE), null, 'a later close removes the kept copy');
  });

  it('forgets every copy at sign-out', async () => {
    const ann = makeSession(ANN);
    await ann.store.save({ id: 'a', epoch: 'e', savedAt: 1, working: new Uint8Array(), confirmed: new Uint8Array(), pending: [] });
    await ann.store.save({ id: 'b', epoch: 'e', savedAt: 1, working: new Uint8Array(), confirmed: new Uint8Array(), pending: [] });
    await ann.session.forgetAllCopies();
    assert.equal(await ann.store.load('a'), null);
    assert.equal(await ann.store.load('b'), null);
  });

  it("holds a co-writer's words in both docs only once they are on screen", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    bo.textarea.type(5, ' world');
    clock.advance(200);
    for (let i = 0; i < 4; i += 1) await hop();
    ann.session.saveLocalCopy();
    await hop();
    let copy = await ann.store.load(PAGE);
    assert.equal(textOf(copy.working), 'hello', 'not on screen yet');
    assert.equal(textOf(copy.confirmed), 'hello', 'so not confirmed yet either');
    for (const frame of ann.frames.splice(0)) frame();
    ann.session.saveLocalCopy();
    await hop();
    copy = await ann.store.load(PAGE);
    assert.equal(textOf(copy.working), 'hello world');
    assert.equal(textOf(copy.confirmed), 'hello world');
  });

  it('never fails the page when storage fails', async () => {
    const ann = makeSession(ANN);
    ann.store.isBroken = true;
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, '!');
    await settle(ann);
    ann.session.close();
    await hop();
    assert.equal(link.room.text(), 'hello!');
  });
});

describe('reloading', () => {
  async function openedPair() {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    return { ann, bo };
  }

  it('picks up after a quick reload without repeating words the room already has', async () => {
    const { ann, bo } = await openedPair();
    ann.textarea.type(5, ' world');
    await settle(ann, bo);
    const again = reload(ann, ANN);
    bo.textarea.type(0, 'oh ');
    await settle(bo);
    await again.session.open({ ...LYRIC, restore: again.restore });
    await settle(again, bo);
    assert.equal(again.textarea.value, 'oh hello world');
    assert.equal(bo.textarea.value, 'oh hello world');
  });

  it('re-sends edits the room never got', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    link.isDeaf = true;
    ann.textarea.type(5, '!');
    await settle(ann);
    link.isDeaf = false;
    const again = reload(ann, ANN);
    await again.session.open({ ...LYRIC, restore: again.restore });
    await settle(again);
    assert.equal(link.room.text(), 'hello!');
    assert.equal(again.textarea.value, 'hello!');
  });

  it('keeps words typed after a reload, before the first sync', async () => {
    const { ann, bo } = await openedPair();
    ann.textarea.type(5, ' world');
    await settle(ann, bo);
    const again = reload(ann, ANN);
    const opening = again.session.open({ ...LYRIC, restore: again.restore });
    again.textarea.type(0, 'well ');
    await opening;
    await settle(again, bo);
    assert.equal(again.textarea.value, 'well hello world');
    assert.equal(bo.textarea.value, 'well hello world');
  });

  it('takes the copy when the page went before its draft caught up', async () => {
    const { ann, bo } = await openedPair();
    ann.textarea.type(5, ' world');
    await settle(ann, bo);
    const olderDraft = ann.page.drafts.at(-1);
    ann.textarea.type(11, '!');
    ann.session.saveLocalCopy();
    await hop();
    const again = reload(ann, ANN, olderDraft);
    assert.equal(again.textarea.value, 'hello world', 'the draft is behind');
    bo.textarea.type(0, 'oh ');
    await settle(bo);
    await again.session.open({ ...LYRIC, restore: again.restore });
    await settle(again, bo);
    assert.equal(again.textarea.value, 'oh hello world!');
    assert.equal(bo.textarea.value, 'oh hello world!');
  });

  it('opens without a copy when storage fails, keeping what was typed', async () => {
    const ann = makeSession(ANN, { body: 'hello there' });
    ann.store.isBroken = true;
    await ann.session.open({ ...LYRIC, restore: { copyAt: 5, shown: 'hello there' } });
    await settle(ann);
    assert.equal(ann.textarea.value, 'hello there');
    assert.equal(link.room.text(), 'hello there');
  });

  it('sets aside a copy it cannot read', async () => {
    const ann = makeSession(ANN, { body: 'hello!' });
    await ann.store.save({ id: PAGE, epoch: 'e', savedAt: 5, working: 'garbage', confirmed: new Uint8Array(), pending: [] });
    await ann.session.open({ ...LYRIC, restore: { copyAt: 5, shown: 'hello!' } });
    await settle(ann);
    assert.equal(link.room.text(), 'hello!');
  });

  it('two tabs on one page: a reload of one loses nothing the other typed', async () => {
    const store = createFakeLiveStore();
    const tab1 = makeSession(ANN, { store });
    const tab2 = makeSession(ANN, { store });
    await tab1.session.open(LYRIC);
    await tab2.session.open(LYRIC);
    await settle(tab1, tab2);
    tab2.textarea.type(5, ' two');
    await settle(tab1, tab2);
    tab1.textarea.type(9, ' one');
    await settle(tab1, tab2);
    const drafts = [...tab1.page.drafts, ...tab2.page.drafts].sort((a, b) => a.stamp - b.stamp);
    const again = reload(tab1, ANN, drafts.at(-1));
    await again.session.open({ ...LYRIC, restore: again.restore });
    await settle(again, tab2);
    assert.equal(again.textarea.value, 'hello two one');
    assert.equal(tab2.textarea.value, 'hello two one');
  });

  it("does not let go before the first sync, even when the room's saved snapshot arrives first", async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    ann.textarea.type(5, '!');
    let wasSyncedWhenLetGo = null;
    const flushing = ann.session.flush().then(isSaved => {
      wasSyncedWhenLetGo = ann.session.connection.isSynced;
      return isSaved;
    });
    await settleBriefly(ann);
    await runRoomAlarms();
    await settle(ann);
    assert.equal(await flushing, true);
    assert.equal(wasSyncedWhenLetGo, true);
  });
});

describe('unsaved words in a copy', () => {
  async function copyWith(type) {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    if (type) {
      link.isDeaf = true;
      ann.textarea.type(5, type);
      await settle(ann);
    }
    ann.session.connection.close();
    return ann;
  }

  it('finds pending updates', async () => {
    const ann = await copyWith('!');
    assert.equal(await ann.session.hasUnsavedWords(PAGE, 'hello!'), true);
  });

  it('finds a screen that differs from the copy', async () => {
    const ann = await copyWith(null);
    assert.equal(await ann.session.hasUnsavedWords(PAGE, 'hello?'), true);
  });

  it('finds nothing when the copy is saved and matches the screen', async () => {
    const ann = await copyWith(null);
    assert.equal(await ann.session.hasUnsavedWords(PAGE, 'hello'), false);
  });

  it('counts no copy as unsaved, so words are never dropped', async () => {
    const ann = makeSession(ANN);
    assert.equal(await ann.session.hasUnsavedWords(PAGE, 'hello'), true);
  });
});

describe('after the room emptied', () => {
  // The room writes back, waits its 10 minutes and empties, keeping only
  // the epoch's final snapshot.
  async function emptyTheRoom() {
    // The room's leave runs async; let it finish and set its alarm first.
    await settle();
    await runRoomAlarms();
    assert.equal(link.host.storage.loadState().snapshot, null, 'the room emptied');
  }

  it('after a reload: reached edits once, unreached ones kept', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, ' world');
    await settle(ann);
    link.isDeaf = true;
    ann.textarea.type(11, '!');
    await settle(ann);
    link.isDeaf = false;
    const again = reload(ann, ANN);
    await emptyTheRoom();
    const bo = makeSession(BO, { body: 'hello world' });
    await bo.session.open({ ...LYRIC, body: 'hello world' });
    await settle(bo);
    bo.textarea.type(0, 'oh ');
    await settle(bo);
    await again.session.open({ ...LYRIC, restore: again.restore });
    await settle(again, bo);
    assert.equal(again.textarea.value, 'oh hello world!');
    assert.equal(bo.textarea.value, 'oh hello world!');
  });

  it('keeps the tab open through it: reached edits once, unreached ones kept', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, ' world');
    await settle(ann);
    link.isDeaf = true;
    ann.textarea.type(11, '!');
    clock.advance(200);
    link.isDeaf = false;
    link.offline.add(ANN.userId);
    link.drop(link.sockets[0]);
    await settle(ann);
    await emptyTheRoom();
    const bo = makeSession(BO, { body: 'hello world' });
    await bo.session.open({ ...LYRIC, body: 'hello world' });
    await settle(bo);
    bo.textarea.type(0, 'oh ');
    await settle(bo, ann);
    // Back online. The backoff has grown, so move the clock past its 30 s
    // ceiling; a refused socket still closing gets its hop first.
    link.offline.delete(ANN.userId);
    await hop();
    clock.advance(30_000);
    await settle(ann, bo);
    assert.equal(ann.textarea.value, 'oh hello world!');
    assert.equal(bo.textarea.value, 'oh hello world!');
  });
});

describe('signing out', () => {
  it('writes the copy on a signed-out close, so the words survive', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    link.isDeaf = true;
    ann.textarea.type(0, 'x');
    clock.advance(200);
    link.isDeaf = false;
    link.sockets[0].closeFromServer(protocol.CLOSE.SIGNED_OUT);
    await hop();
    await hop();
    assert.equal(ann.page.expired, 1);
    const copy = await ann.store.load(PAGE);
    assert.equal(textOf(copy.working), 'xhello');
    assert.equal(copy.pending.length, 1);
    ann.session.close({ keepCopy: true });
    assert.equal(ann.session.isLive(), false);
    assert.equal(await ann.session.flush(), true, 'leaving is no longer refused');
    assert.ok(await ann.store.load(PAGE), 'the copy stays for signing back in');
  });

  it('waits as long as asked before giving up on a flush', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    link.isDeaf = true;
    ann.textarea.type(5, '!');
    let result = null;
    ann.session.flush(8000).then(isSaved => { result = isSaved; });
    clock.advance(6000);
    await hop();
    assert.equal(result, null, 'still waiting after 6 s');
    clock.advance(2001);
    await hop();
    assert.equal(result, false);
  });
});

describe('review fixes, 3b', () => {
  it("tells the page the room's confirmed text with each copy, a base for a reload with no copy", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    ann.textarea.type(5, ' world');
    await settle(ann, bo);
    await runRoomAlarms();
    await settle(ann, bo);
    const draft = ann.page.drafts.at(-1);
    assert.equal(draft.confirmed, 'hello world');
    // The copy is gone (another tab dropped it); the reload falls back to the draft's confirmed text.
    ann.session.connection.close();
    await ann.store.clear();
    bo.textarea.type(0, 'oh ');
    await settle(bo);
    const again = makeSession(ANN, { body: draft.text, store: ann.store });
    await again.session.open({ ...LYRIC, body: draft.confirmed, restore: { copyAt: draft.stamp, shown: draft.text } });
    await settle(again, bo);
    assert.equal(again.textarea.value, 'oh hello world');
  });

  it('stops counting on the copy while saving it fails, so the draft takes the words', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    assert.equal(ann.session.hasLocalCopy(), true);
    ann.store.isBroken = true;
    ann.textarea.type(5, '!');
    await settle(ann);
    assert.equal(ann.session.hasLocalCopy(), false);
    ann.store.isBroken = false;
    ann.textarea.type(6, '?');
    await settle(ann);
    assert.equal(ann.session.hasLocalCopy(), true);
  });
});

describe('leaving before the last copy lands', () => {
  it('keeps words typed just before the page went, sent or not', async () => {
    const ann = makeSession(ANN);
    await ann.session.open(LYRIC);
    await settle(ann);
    ann.textarea.type(5, ' world');
    ann.store.isHanging = true;
    ann.session.saveOnLeaving();
    const again = reload(ann, ANN);
    ann.store.isHanging = false;
    await again.session.open({ ...LYRIC, restore: again.restore });
    await settle(again);
    assert.equal(again.textarea.value, 'hello world');
    assert.equal(link.room.text(), 'hello world');
  });

  it("doubles nothing a co-writer typed since the last copy", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await ann.session.open(LYRIC);
    await bo.session.open(LYRIC);
    await settle(ann, bo);
    ann.store.isHanging = true;
    bo.textarea.type(0, 'oh ');
    await settle(ann, bo);
    ann.textarea.type(8, ' world');
    clock.advance(200);
    await hop();
    ann.session.saveOnLeaving();
    const again = reload(ann, ANN);
    ann.store.isHanging = false;
    bo.textarea.type(0, 'so ');
    await settle(bo);
    await again.session.open({ ...LYRIC, restore: again.restore });
    await settle(again, bo);
    assert.equal(again.textarea.value, 'so oh hello world');
    assert.equal(bo.textarea.value, 'so oh hello world');
  });
});
