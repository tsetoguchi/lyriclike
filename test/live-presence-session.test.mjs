// Presence between real sessions and the in-process room: who is here,
// co-writers' carets, and what a dropped or closed tab does to them.
//
//   cd collab && npm install; cd .. && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import * as protocol from '../collab/src/protocol.js';
import binding from '../live-binding.js';
import liveCore from '../live-core.js';
import livePresence from '../live-presence.js';
import live from '../live.js';
import { createFakeD1 } from './support/fake-d1.mjs';
import { createFakeClock } from './support/fake-clock.mjs';
import { createFakeLiveStore } from './support/fake-live-store.mjs';
import { FakeTextarea } from './support/fake-textarea.mjs';
import { awarenessProtocol, DiffMatchPatch, Y } from './support/live-deps.mjs';
import { createRoomLink } from './support/room-link.mjs';

const { LiveSession } = live;
const PAGE = 'page-1';
const LYRIC = { id: PAGE, body: 'hello', title: 'Song', live: true };

function person(userId, name) {
  return {
    userId, name, email: `${userId}@example.com`,
    colour: livePresence.colourFor(userId), sessionId: `session-${userId}`,
  };
}

const ANN = person('ann', 'Ann Lee');
const BO = person('bo', 'Bo');

let db;
let link;
let clock;

const PAGE_STUB = {
  setIndicator() {}, showSaved() {}, onTitle() {}, isTitleFocused: () => false,
  onUnavailable() {}, onSessionExpired() {}, reload() {}, notice() {}, setReadOnly() {},
  onLocalCopySaved() {}, onLeaving() {},
};

function makeSession(identity, { isFocused = true } = {}) {
  const client = { textarea: new FakeTextarea(LYRIC.body), frames: [], views: [], isFocused };
  const env = {
    textarea: client.textarea, page: PAGE_STUB, store: createFakeLiveStore(),
    liveCore, livePresence, createTextBinding: binding.createTextBinding,
    loadDeps: async () => ({ Y, DiffMatchPatch, protocol, awarenessProtocol }),
    openSocket: path => link.connect(path, identity),
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    random: () => 0.5,
    schedule: frame => client.frames.push(frame),
    isFocused: () => client.isFocused,
    adjustScroll: () => {},
    me: () => ({ id: identity.userId, name: identity.name, email: identity.email }),
    showPresence: view => client.views.push(view),
  };
  client.session = new LiveSession(env);
  return client;
}

async function openAll(...clients) {
  for (const client of clients) client.session.open(LYRIC);
  await settle(...clients);
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

const lastView = client => client.views.at(-1) || livePresence.EMPTY_VIEW;
const namesHere = client => lastView(client).people.map(entry => entry.name);
const headsOf = client => lastView(client).carets.map(caret => caret.head);

function moveCaret(client, start, end = start, direction = 'forward') {
  client.textarea.setSelectionRange(start, end);
  client.textarea.selectionDirection = direction;
  client.textarea.dispatchEvent(new Event('select'));
}

function presenceSent(client) {
  return client.session.connection.socket.sent
    .filter(data => typeof data !== 'string' && protocol.readIncoming(new Uint8Array(data)).kind === 'presence')
    .length;
}

async function exec(sql, ...params) {
  await db.prepare(sql).bind(...params).run();
}

beforeEach(async () => {
  db = createFakeD1();
  for (const { userId, email, name, sessionId } of [ANN, BO]) {
    await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
      userId, email, email, name);
    await exec('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, 1)',
      sessionId, userId, 9e15);
  }
  await exec('INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) ' +
    "VALUES (?, 'ann', 'Song', 'hello', 0, 1, 1)", PAGE);
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, ' +
    "created_at) VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", PAGE);
  link = createRoomLink({ db, lyricId: PAGE });
  clock = createFakeClock();
});

describe('who is here', () => {
  it('shows each person the others, once each however many tabs they have', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    const boAgain = makeSession(BO);
    await openAll(ann, bo, boAgain);
    assert.deepEqual(namesHere(ann), ['Bo']);
    assert.deepEqual(namesHere(bo), ['Ann Lee']);
    assert.deepEqual(namesHere(boAgain), ['Ann Lee']);
    assert.equal(lastView(bo).people[0].initials, 'AL');
  });

  it('shows people before they click into the page, with no caret yet', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO, { isFocused: false });
    await openAll(ann, bo);
    moveCaret(bo, 2);
    await settle(ann, bo);
    assert.deepEqual(namesHere(ann), ['Bo']);
    assert.deepEqual(lastView(ann).carets, []);
  });

  it('shows a newcomer the people already there', async () => {
    const ann = makeSession(ANN);
    await openAll(ann);
    const bo = makeSession(BO);
    await openAll(bo);
    await settle(ann, bo);
    assert.deepEqual(namesHere(bo), ['Ann Lee']);
  });

  it('takes a person away when their tab closes', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    bo.session.close();
    await settle(ann);
    assert.deepEqual(namesHere(ann), []);
  });

  it('shows nobody once my page is closed', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    ann.session.close();
    assert.equal(lastView(ann), livePresence.EMPTY_VIEW);
  });

  it('keeps a reader listed for minutes, sending nothing', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    const before = presenceSent(bo);
    // 24 settles of 7.5 s: three minutes, in steps small enough for each
    // keepalive's pong to arrive, so the socket stays the same one.
    for (let round = 0; round < 24; round += 1) await settle(ann, bo);
    assert.deepEqual(namesHere(ann), ['Bo']);
    assert.equal(presenceSent(bo), before);
  });
});

describe('carets', () => {
  it("shows a co-writer's caret where they put it, in their colour", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    moveCaret(bo, 3);
    await settle(ann, bo);
    const [caret] = lastView(ann).carets;
    assert.deepEqual([caret.name, caret.start, caret.end, caret.head], ['Bo', 3, 3, 3]);
    assert.equal(caret.colour, livePresence.screenColour(BO.colour));
  });

  it('keeps the caret on the same letter while I type above it', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    moveCaret(bo, 3);
    await settle(ann, bo);
    ann.textarea.type(0, 'oh ');
    await settle(ann, bo);
    assert.deepEqual(headsOf(ann), [6]);
  });

  it('marks where the caret is after a keystroke, not before it', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    bo.textarea.type(2, 'X');
    await settle(ann, bo);
    assert.equal(ann.textarea.value, 'heXllo');
    assert.deepEqual(headsOf(ann), [3]);
  });

  it('shows a selection, with the caret at its start when made backwards', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    moveCaret(bo, 1, 4, 'backward');
    await settle(ann, bo);
    const [caret] = lastView(ann).carets;
    assert.deepEqual([caret.start, caret.end, caret.head], [1, 4, 1]);
  });

  it('never shows me, from this tab or my others', async () => {
    const ann = makeSession(ANN);
    const annAgain = makeSession(ANN);
    await openAll(ann, annAgain);
    moveCaret(annAgain, 2);
    await settle(ann, annAgain);
    assert.deepEqual(lastView(ann), { people: [], carets: [] });
  });
});

describe('sending', () => {
  it('sends at most one presence message per 300 ms', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    const before = presenceSent(bo);
    for (let index = 0; index < 5; index += 1) {
      moveCaret(bo, index);
      clock.advance(50);
    }
    assert.equal(presenceSent(bo) - before, 1);
    clock.advance(300);
    assert.equal(presenceSent(bo) - before, 2);
  });

  it('sends nothing when the caret has not moved', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    moveCaret(bo, 2);
    await settle(ann, bo);
    const before = presenceSent(bo);
    moveCaret(bo, 2);
    await settle(ann, bo);
    assert.equal(presenceSent(bo), before);
  });
});

describe('connection trouble', () => {
  it('forgets co-writers while my connection is down, and shows them again after', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    link.drop(ann.session.connection.socket);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(namesHere(ann), []);
    await settle(ann, bo);
    assert.deepEqual(namesHere(ann), ['Bo']);
  });

  it('shows a co-writer who dropped and came back, at once, with their caret', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    moveCaret(bo, 1);
    await settle(ann, bo);
    link.drop(bo.session.connection.socket);
    await settle(ann, bo);
    assert.deepEqual(namesHere(ann), ['Bo']);
    assert.deepEqual(headsOf(ann), [1]);
    moveCaret(bo, 4);
    await settle(ann, bo);
    assert.deepEqual(headsOf(ann), [4]);
  });

  it('shows one caret for a co-writer whose old connection the room never saw close', async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    moveCaret(bo, 1);
    await settle(ann, bo);
    // The phone's socket died without the room hearing: no leave goes out.
    const dead = bo.session.connection.socket;
    dead.readyState = 3;
    setImmediate(() => dead.onclose?.({ code: 1006 }));
    await settle(ann, bo);
    moveCaret(bo, 4);
    await settle(ann, bo);
    assert.deepEqual(headsOf(ann), [4]);
  });

  it("takes a co-writer's caret away while their tab is hidden, and back when shown", async () => {
    const ann = makeSession(ANN);
    const bo = makeSession(BO);
    await openAll(ann, bo);
    moveCaret(bo, 3);
    await settle(ann, bo);
    bo.session.presenceHidden();
    await settle(ann, bo);
    assert.deepEqual(namesHere(ann), ['Bo']);
    assert.deepEqual(headsOf(ann), []);
    bo.session.presenceShown();
    await settle(ann, bo);
    assert.deepEqual(headsOf(ann), [3]);
  });
});
