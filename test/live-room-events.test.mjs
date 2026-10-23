// What the room tells the event hook: who wrote, what the page was just
// before each write and just after, and when the room emptied.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { pageSavedEvent, roomEmptiedEvent, writtenSnapshot } from '../collab/src/room-events.js';
import { PROTOCOL_VERSION } from '../collab/src/protocol.js';
import { RoomCore, WRITE_BACK_MS } from '../collab/src/room-core.js';
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
