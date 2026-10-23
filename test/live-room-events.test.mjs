// What the room tells the event hook: who wrote, what the page was just
// before each write and just after, and when the room emptied.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { pageSavedEvent, roomEmptiedEvent, writtenSnapshot } from '../collab/src/room-events.js';
import { PROTOCOL_VERSION } from '../collab/src/protocol.js';
import { EMPTY_AFTER_MS, MAX_BACKOFF_MS, RoomCore, WRITE_BACK_MS } from '../collab/src/room-core.js';
import { createFakeD1 } from './support/fake-d1.mjs';
import { FakeSocket, TestClient, createRoomHost } from './support/fake-room-host.mjs';

const PAGE = 'page-1';
const ANN = { userId: 'ann', email: 'ann@example.com', name: 'Ann', colour: 'hsl(1 65% 42%)' };
const BO = { userId: 'bo', email: 'bo@example.com', name: 'Bo', colour: 'hsl(2 65% 42%)' };
const SESSIONS = { ann: 'session-ann', bo: 'session-bo' };

let db;
let host;
let room;

async function exec(sql, ...params) {
  await db.prepare(sql).bind(...params).run();
}

async function connect(identity) {
  const socket = new FakeSocket();
  host.open.push(socket);
  await room.join(socket, { identity, sessionId: SESSIONS[identity.userId], protocol: PROTOCOL_VERSION, epoch: null });
  const client = new TestClient(room, socket);
  client.askForEverything();
  await client.sync();
  return client;
}

async function runAlarm(at) {
  host.clock = at;
  host.alarmAt = null;
  await room.alarm();
}

async function typed(client, index, text) {
  client.type(index, text);
  await client.sync();
}

function savedEvents() {
  return host.events.filter(event => event.type === 'page.saved');
}

// Holds every UPDATE until released; `waiting` resolves once one waits.
function holdD1Writes() {
  const prepare = db.prepare.bind(db);
  let release;
  let reached;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes('UPDATE lyrics')) return statement;
    return { bind: (...args) => ({ first: async () => {
      reached();
      await gate;
      return statement.bind(...args).first();
    } }) };
  };
  return { waiting, release: () => { db.prepare = prepare; release(); } };
}

function failD1Writes() {
  const prepare = db.prepare.bind(db);
  db.prepare = sql => (sql.includes('UPDATE lyrics')
    ? { bind: () => ({ first: async () => { throw new Error('D1 down'); } }) }
    : prepare(sql));
  return () => { db.prepare = prepare; };
}

async function readUpdatedAt() {
  return (await db.prepare('SELECT updated_at FROM lyrics WHERE id = ?').bind(PAGE).first()).updated_at;
}

beforeEach(async () => {
  db = createFakeD1();
  for (const person of [ANN, BO]) {
    await exec('INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, 1)',
      person.userId, person.email, person.email, person.name);
    await exec('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, 1)',
      SESSIONS[person.userId], person.userId, 9e15);
  }
  await exec('INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) ' +
    "VALUES (?, 'ann', 'Song', 'hello', 0, 1, 1)", PAGE);
  await exec('INSERT INTO lyric_shares (lyric_id, email_normalized, email, user_id, had_account, emailed, ' +
    "created_at) VALUES (?, 'bo@example.com', 'bo@example.com', 'bo', 1, 0, 1)", PAGE);
  host = createRoomHost({ db, lyricId: PAGE });
  room = new RoomCore(host);
});

describe('what the room knows about its page', () => {
  it('a written page remembers when it was written', async () => {
    const ann = await connect(ANN);
    ann.type(5, ' there');
    await ann.sync();
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.equal(room.written.updatedAt, host.clock);
    assert.equal(await readUpdatedAt(), host.clock);
  });

  it('the owner comes from the page', async () => {
    await connect(BO);
    assert.equal(room.ownerId, 'ann');
  });

  it('a room woken from older meta takes the time from D1', async () => {
    await connect(ANN);
    const meta = host.storage.readMeta('room');
    delete meta.written.updatedAt;
    host.storage.saveMeta(meta);
    room = new RoomCore(host);
    await connect(BO);
    assert.equal(room.written.updatedAt, 1);
  });
});

describe('the messages', () => {
  it('pageSavedEvent uses the message names', () => {
    const before = writtenSnapshot({ revision: 0, text: 'hello', title: 'Song', updatedAt: 1 });
    const after = { title: 'Song', body: 'hello there', revision: 1, updated_at: 5 };
    assert.deepEqual(pageSavedEvent({ pageId: PAGE, ownerId: 'ann', writerIds: ['bo'], reason: 'edit', before, after }), {
      type: 'page.saved',
      data: {
        page_id: PAGE, owner_id: 'ann', writer_ids: ['bo'], reason: 'edit', tag: null,
        before: { title: 'Song', body: 'hello', revision: 0, updated_at: 1 }, after,
      },
    });
  });

  it('roomEmptiedEvent names the page', () => {
    assert.deepEqual(roomEmptiedEvent(PAGE), { type: 'page.room_emptied', data: { page_id: PAGE } });
  });
});

describe('page saved from a write-back', () => {
  it('a write-back sends before and after', async () => {
    const ann = await connect(ANN);
    await typed(ann, 5, ' there');
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.deepEqual(host.events, [{
      type: 'page.saved',
      data: {
        page_id: PAGE, owner_id: 'ann', writer_ids: ['ann'], reason: 'edit', tag: null,
        before: { title: 'Song', body: 'hello', revision: 0, updated_at: 1 },
        after: { title: 'Song', body: 'hello there', revision: 1, updated_at: host.clock },
      },
    }]);
  });

  it('two people typing are both named', async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    await typed(ann, 5, '!');
    await typed(bo, 0, 'oh ');
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.deepEqual(savedEvents()[0].data.writer_ids.sort(), ['ann', 'bo']);
  });

  it('the next write names only who typed since', async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    await typed(ann, 5, '!');
    await runAlarm(host.clock + WRITE_BACK_MS);
    await bo.sync();
    await typed(bo, 0, 'oh ');
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.deepEqual(savedEvents().map(event => event.data.writer_ids), [['ann'], ['bo']]);
  });

  it('someone typing during a write stays named for the next one', async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    await typed(ann, 5, '!');
    const held = holdD1Writes();
    const alarm = runAlarm(host.clock + WRITE_BACK_MS);
    await held.waiting;
    await typed(bo, 0, 'oh ');
    held.release();
    await alarm;
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.deepEqual(savedEvents().map(event => event.data.writer_ids), [['ann'], ['bo']]);
  });

  it('ann typing again during her own write stays named', async () => {
    const ann = await connect(ANN);
    await typed(ann, 5, '!');
    const held = holdD1Writes();
    const alarm = runAlarm(host.clock + WRITE_BACK_MS);
    await held.waiting;
    await typed(ann, 0, 'oh ');
    held.release();
    await alarm;
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.deepEqual(savedEvents().map(event => event.data.writer_ids), [['ann'], ['ann']]);
  });

  it('nothing is sent while the write lock is held', async () => {
    const locks = [];
    host.sendEvent = () => locks.push(room.writing);
    const ann = await connect(ANN);
    await typed(ann, 5, '!');
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.deepEqual(locks, [null]);
  });

  it('a write whose answer was lost sends one message', async () => {
    const ann = await connect(ANN);
    await typed(ann, 5, '!');
    const prepare = db.prepare.bind(db);
    db.prepare = sql => {
      const statement = prepare(sql);
      if (!sql.includes('UPDATE lyrics')) return statement;
      db.prepare = prepare;
      return { bind: (...args) => ({ first: async () => { await statement.bind(...args).first(); return null; } }) };
    };
    await runAlarm(host.clock + WRITE_BACK_MS);
    const saved = savedEvents();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].data.after.revision, 1);
    assert.equal(saved[0].data.after.body, 'hello!');
    assert.equal(saved[0].data.before.revision, 0);
  });

  it('a merged outside save sends nothing of its own', async () => {
    const ann = await connect(ANN);
    await typed(ann, 0, 'oh ');
    await exec("UPDATE lyrics SET body = 'hello there', revision = 1, updated_at = 7 WHERE id = ?", PAGE);
    await runAlarm(host.clock + WRITE_BACK_MS);
    const saved = savedEvents();
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].data.before, { title: 'Song', body: 'hello there', revision: 1, updated_at: 7 });
    assert.equal(saved[0].data.after.body, 'oh hello there');
  });

  it('a failing write sends nothing and keeps the writers', async () => {
    const ann = await connect(ANN);
    await typed(ann, 5, '!');
    const heal = failD1Writes();
    await runAlarm(host.clock + WRITE_BACK_MS);
    assert.deepEqual(host.events, []);
    assert.deepEqual([...room.writers], ['ann']);
    heal();
    await runAlarm(host.clock + MAX_BACKOFF_MS);
    assert.deepEqual(savedEvents().map(event => event.data.writer_ids), [['ann']]);
  });

  it('writers survive a wake-up', async () => {
    const ann = await connect(ANN);
    await typed(ann, 5, '!');
    room.saveSnapshot();
    room = new RoomCore(host);
    ann.room = room;
    await runAlarm(host.clock + 1);
    assert.deepEqual(savedEvents().map(event => event.data.writer_ids), [['ann']]);
  });

  it('a woken room from older meta names nobody rather than failing', async () => {
    const ann = await connect(ANN);
    await typed(ann, 5, '!');
    room.saveSnapshot();
    const meta = host.storage.readMeta('room');
    delete meta.writers;
    host.storage.saveMeta(meta);
    room = new RoomCore(host);
    ann.room = room;
    await runAlarm(host.clock + 1);
    assert.deepEqual(savedEvents().map(event => event.data.writer_ids), [[]]);
  });
});

describe('room emptied', () => {
  it('an emptied room says so', async () => {
    const ann = await connect(ANN);
    await room.leave(ann.socket);
    await runAlarm(host.clock + EMPTY_AFTER_MS);
    assert.deepEqual(host.events.at(-1), { type: 'page.room_emptied', data: { page_id: PAGE } });
  });
});

describe('page saved from a live replace', () => {
  it('a live replace sends the flush, then the replace', async () => {
    const ann = await connect(ANN);
    await typed(ann, 5, ' there');
    await room.replace({ title: 'New', body: 'fresh', tag: 'v-1', userId: 'bo' });
    const saved = savedEvents();
    assert.deepEqual(saved.map(event => event.data.reason), ['edit', 'replace']);
    assert.equal(saved[0].data.after.body, 'hello there');
    assert.deepEqual(saved[1].data, {
      page_id: PAGE, owner_id: 'ann', writer_ids: ['bo'], reason: 'replace', tag: 'v-1',
      before: { title: 'Song', body: 'hello there', revision: 1, updated_at: host.clock },
      after: { title: 'New', body: 'fresh', revision: 2, updated_at: host.clock },
    });
  });

  it('a replace with no person or tag names nobody', async () => {
    await connect(ANN);
    await room.replace({ title: 'New', body: 'fresh', tag: null, userId: null });
    assert.deepEqual(savedEvents()[0].data.writer_ids, []);
    assert.equal(savedEvents()[0].data.tag, null);
  });

  it('nothing from a replace is sent while the write lock is held', async () => {
    const locks = [];
    host.sendEvent = () => locks.push(room.writing);
    await connect(ANN);
    await room.replace({ title: 'New', body: 'fresh', tag: null, userId: 'ann' });
    assert.deepEqual(locks, [null]);
  });

  it('a replace that fails sends nothing', async () => {
    await connect(ANN);
    const heal = failD1Writes();
    assert.deepEqual(await room.replace({ title: 'New', body: 'fresh', tag: null, userId: 'ann' }), { error: 'busy' });
    heal();
    assert.deepEqual(host.events, []);
  });
});

describe('same words', () => {
  it('a live replace with the words already there sends nothing', async () => {
    await connect(ANN);
    await room.replace({ title: 'Song', body: 'hello', tag: 'v-1', userId: 'ann' });
    assert.deepEqual(host.events, []);
  });
});
