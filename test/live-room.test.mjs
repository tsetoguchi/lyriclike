// RoomCore against fakes: a database built from migrations/, storage on
// node:sqlite, sockets that record what they were sent, and a hand-moved
// clock with one alarm.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { awarenessProtocol, Y } from '../collab/src/deps.js';
import { decodePresence } from '../collab/src/presence.js';
import { CLOSE, encodeUpdate, PROTOCOL_VERSION } from '../collab/src/protocol.js';
import {
  EMPTY_AFTER_MS, MAX_BACKOFF_MS, MAX_MESSAGE_BYTES, MAX_SOCKETS, MAX_SOCKETS_PER_USER, RATE_LIMIT,
  RECHECK_MS, RoomCore, SNAPSHOT_MS, WRITE_BACK_MS,
} from '../collab/src/room-core.js';
import liveCore from '../live-core.js';
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

async function readStored() {
  return db.prepare('SELECT body, title, revision FROM lyrics WHERE id = ?').bind(PAGE).first();
}

async function connect(identity, { protocol = PROTOCOL_VERSION, epoch = null } = {}) {
  const socket = new FakeSocket();
  host.open.push(socket);
  const sessionId = SESSIONS[identity.userId] ?? SESSIONS.bo;
  await room.join(socket, { identity, sessionId, protocol, epoch });
  const client = new TestClient(room, socket);
  // As the browser does on open: tell the room what it has, get the rest.
  if (!socket.closed) client.askForEverything();
  await client.sync();
  return client;
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

describe('joining', () => {
  it('greets with an epoch, the page and a saved snapshot', async () => {
    const ann = await connect(ANN);
    assert.match(ann.hello.epoch, /^[0-9a-f-]{36}$/);
    assert.equal(ann.hello.oldEpochSnapshot, null);
    assert.equal(ann.text, 'hello');
    assert.equal(ann.title, 'Song');
    assert.ok(ann.persisted);
  });

  it('seeds the page once, so a second person joins the same history', async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    assert.equal(bo.hello.epoch, ann.hello.epoch);
    assert.equal(bo.text, 'hello');
    assert.ok(host.storage.loadState().snapshot);
  });

  it('refuses an old protocol with 4001', async () => {
    const socket = new FakeSocket();
    host.open.push(socket);
    await room.join(socket, { identity: ANN, sessionId: SESSIONS.ann, protocol: 0, epoch: null });
    assert.equal(socket.closed.code, CLOSE.OLD_PROTOCOL);
  });

  it(`refuses a socket past ${MAX_SOCKETS_PER_USER} for one person with 4008`, async () => {
    for (let i = 0; i < MAX_SOCKETS_PER_USER; i += 1) await connect(ANN);
    const extra = await connect(ANN);
    assert.equal(extra.socket.closed.code, CLOSE.TOO_MANY_TABS);
  });

  it(`refuses a socket past ${MAX_SOCKETS} in one room with 4007`, async () => {
    for (let i = 0; i < MAX_SOCKETS; i += 1) {
      await connect({ ...BO, userId: `bo-${i}` });
    }
    const extra = await connect(ANN);
    assert.equal(extra.socket.closed.code, CLOSE.ROOM_FULL);
  });
});

describe('relaying', () => {
  it("sends one person's typing to the other, not back to them", async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    const sentToAnn = ann.socket.sent.length;
    ann.type(5, ' world');
    await ann.sync();
    await bo.sync();
    assert.equal(bo.text, 'hello world');
    assert.equal(ann.socket.sent.length, sentToAnn);
  });

  it('closes a socket that sends more than 4 MB with 4002', async () => {
    const ann = await connect(ANN);
    await room.message(ann.socket, new Uint8Array(MAX_MESSAGE_BYTES + 1));
    assert.equal(ann.socket.closed.code, CLOSE.TOO_LARGE);
  });

  it('closes a socket whose update could pass the length cap with 4002', async () => {
    const ann = await connect(ANN);
    const big = new Y.Doc();
    big.getText('body').insert(0, 'x'.repeat(500_000));
    await room.message(ann.socket, encodeUpdate(Y.encodeStateAsUpdate(big)));
    assert.equal(ann.socket.closed.code, CLOSE.TOO_LARGE);
  });

  it('closes a socket that sends an unreadable update with 4009', async () => {
    const ann = await connect(ANN);
    await room.message(ann.socket, encodeUpdate(new Uint8Array([200, 200, 200])));
    assert.equal(ann.socket.closed.code, CLOSE.BAD_MESSAGE);
  });

  it(`closes a socket that sends more than ${RATE_LIMIT} messages in 10 s with 4003`, async () => {
    const ann = await connect(ANN);
    for (let i = 0; i <= RATE_LIMIT; i += 1) await room.message(ann.socket, new Uint8Array([9]));
    assert.equal(ann.socket.closed.code, CLOSE.TOO_FAST);
  });
});

describe('presence', () => {
  function presenceOf(name) {
    const awareness = new awarenessProtocol.Awareness(new Y.Doc());
    awareness.setLocalState({ user: { name, colour: 'red' }, cursor: 4 });
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
    awareness.destroy();
    return update;
  }

  it("relays presence stamped with the sender's own name and colour", async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    ann.sendPresence(presenceOf('Mallory'));
    await ann.sync();
    await bo.sync();
    const [entry] = decodePresence(bo.presence.at(-1));
    assert.deepEqual(entry.state.user, { name: 'Ann', colour: ANN.colour });
    assert.equal(entry.state.cursor, 4);
  });

  it('gives a newcomer the presence of everyone already there', async () => {
    const ann = await connect(ANN);
    ann.sendPresence(presenceOf('Ann'));
    await ann.sync();
    const bo = await connect(BO);
    assert.equal(decodePresence(bo.presence[0])[0].state.user.name, 'Ann');
  });
});

async function runAlarm(at) {
  host.clock = at;
  host.alarmAt = null;
  await room.alarm();
}

// Fires every alarm due by `until`, in order, as the platform would.
async function runDueAlarms(until) {
  for (let fired = 0; host.alarmAt !== null && host.alarmAt <= until; fired += 1) {
    if (fired > 20) throw new Error('alarms never settle');
    await runAlarm(host.alarmAt);
  }
}

function failD1Writes() {
  const prepare = db.prepare.bind(db);
  db.prepare = sql => (sql.includes('UPDATE lyrics')
    ? { bind: () => ({ first: async () => { throw new Error('D1 down'); } }) }
    : prepare(sql));
  return () => { db.prepare = prepare; };
}

describe('saving', () => {
  it('saves a snapshot after an edit and tells everyone it covers the edit', async () => {
    const ann = await connect(ANN);
    let edit = null;
    ann.doc.once('update', update => { edit = update; });
    ann.type(5, '!');
    await ann.sync();
    assert.equal(liveCore.isUpdateSaved(Y, edit, ann.persisted), false);
    assert.ok(host.alarmAt !== null && host.alarmAt <= host.clock + SNAPSHOT_MS);
    await runDueAlarms(host.clock + SNAPSHOT_MS);
    await ann.sync();
    assert.equal(liveCore.isUpdateSaved(Y, edit, ann.persisted), true);
  });

  it('writes the text and a live rename back to D1', async () => {
    const ann = await connect(ANN);
    ann.type(5, ' world');
    ann.doc.getMap('meta').set('title', 'Rain Song');
    await ann.sync();
    await runDueAlarms(host.clock + WRITE_BACK_MS);
    assert.deepEqual(await readStored(), { body: 'hello world', title: 'Rain Song', revision: 1 });
  });

  it('moves the one alarm only ever earlier', async () => {
    const ann = await connect(ANN);
    for (const letter of 'abcde') {
      ann.type(0, letter);
      await ann.sync();
    }
    assert.equal(host.alarmSets, 1);
  });

  it('merges a save made outside the room, keeping both sides', async () => {
    const ann = await connect(ANN);
    ann.type(0, 'oh ');
    await ann.sync();
    await exec("UPDATE lyrics SET body = 'hello there', revision = revision + 1 WHERE id = ?", PAGE);
    await runDueAlarms(host.clock + WRITE_BACK_MS);
    await ann.sync();
    assert.equal(ann.text, 'oh hello there');
    assert.equal((await readStored()).body, 'oh hello there');
  });

  it('takes a rename made outside the room when the room did not rename', async () => {
    const ann = await connect(ANN);
    ann.type(5, '!');
    await ann.sync();
    await exec("UPDATE lyrics SET title = 'Outside' WHERE id = ?", PAGE);
    await runDueAlarms(host.clock + WRITE_BACK_MS);
    await ann.sync();
    assert.equal(ann.title, 'Outside');
    assert.equal((await readStored()).title, 'Outside');
  });

  it("keeps the room's rename over an older one made outside", async () => {
    const ann = await connect(ANN);
    ann.doc.getMap('meta').set('title', 'Inside');
    await ann.sync();
    await exec("UPDATE lyrics SET title = 'Outside' WHERE id = ?", PAGE);
    await runDueAlarms(host.clock + WRITE_BACK_MS);
    assert.equal((await readStored()).title, 'Inside');
  });

  it('merges an outside save it finds when it loads', async () => {
    await connect(ANN);
    await exec("UPDATE lyrics SET body = 'hello again', revision = revision + 1 WHERE id = ?", PAGE);
    room = new RoomCore(host);
    const bo = await connect(BO);
    assert.equal(bo.text, 'hello again');
  });

  it('closes everyone with 4005 and clears its storage when the page is gone', async () => {
    const ann = await connect(ANN);
    ann.type(5, '!');
    await ann.sync();
    await exec('DELETE FROM lyric_shares WHERE lyric_id = ?', PAGE);
    await exec('DELETE FROM lyrics WHERE id = ?', PAGE);
    await runDueAlarms(host.clock + WRITE_BACK_MS);
    assert.equal(ann.socket.closed.code, CLOSE.PAGE_DELETED);
    assert.equal(host.storage.loadPageId(), null);
  });

  it('backs off and retries when D1 fails, keeping the edit', async () => {
    const ann = await connect(ANN);
    ann.type(5, '!');
    await ann.sync();
    const restore = failD1Writes();
    await runDueAlarms(host.clock + WRITE_BACK_MS);
    assert.equal((await readStored()).body, 'hello');
    assert.ok(host.alarmAt !== null, 'a retry is scheduled');
    restore();
    await runDueAlarms(host.clock + MAX_BACKOFF_MS);
    assert.equal((await readStored()).body, 'hello!');
  });
});

describe('leaving and emptying', () => {
  it('writes back at once when the last person leaves', async () => {
    const ann = await connect(ANN);
    ann.type(5, '!');
    await ann.sync();
    await room.leave(ann.socket);
    assert.equal((await readStored()).body, 'hello!');
    assert.equal(host.storage.loadState().meta.emptySince, host.clock);
  });

  it('tells the others when someone leaves, once, even if leaving runs twice', async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    const awareness = new awarenessProtocol.Awareness(new Y.Doc());
    awareness.setLocalState({ cursor: 1 });
    ann.sendPresence(awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]));
    awareness.destroy();
    await ann.sync();
    await room.leave(ann.socket);
    await room.leave(ann.socket);
    await bo.sync();
    const leaves = bo.presence.filter(update => decodePresence(update)[0].state === null);
    assert.equal(leaves.length, 1);
  });

  it("empties 10 minutes later, keeping only the epoch's final snapshot", async () => {
    const ann = await connect(ANN);
    await room.leave(ann.socket);
    await runAlarm(host.clock + EMPTY_AFTER_MS);
    assert.equal(host.storage.loadState().snapshot, null);
    assert.ok(host.storage.loadEpochSnapshot(ann.hello.epoch));
  });

  it('does not empty if someone came back within the 10 minutes', async () => {
    const ann = await connect(ANN);
    await room.leave(ann.socket);
    const emptyAt = host.alarmAt;
    await connect(BO);
    await runAlarm(emptyAt);
    assert.ok(host.storage.loadState().snapshot);
  });

  it('does not empty while D1 lacks the text', async () => {
    const ann = await connect(ANN);
    ann.type(5, '!');
    await ann.sync();
    const restore = failD1Writes();
    await room.leave(ann.socket);
    await runAlarm(host.clock + EMPTY_AFTER_MS);
    assert.ok(host.storage.loadState().snapshot);
    restore();
  });

  it("starts a new epoch after emptying, and hands back the old one's snapshot", async () => {
    const ann = await connect(ANN);
    const oldEpoch = ann.hello.epoch;
    await room.leave(ann.socket);
    await runAlarm(host.clock + EMPTY_AFTER_MS);
    const back = await connect(ANN, { epoch: oldEpoch });
    assert.notEqual(back.hello.epoch, oldEpoch);
    assert.deepEqual(back.hello.oldEpochSnapshot, host.storage.loadEpochSnapshot(oldEpoch));
  });
});

describe('access', () => {
  it('closes a signed-out socket with 4006 before applying its next message', async () => {
    const bo = await connect(BO);
    await exec('DELETE FROM sessions WHERE id = ?', SESSIONS.bo);
    host.clock += RECHECK_MS;
    bo.type(0, 'sneaky ');
    await bo.sync();
    assert.equal(bo.socket.closed.code, CLOSE.SIGNED_OUT);
    assert.equal(room.text(), 'hello');
  });

  it('closes a socket whose share was removed with 4004 on the re-check', async () => {
    const bo = await connect(BO);
    await exec('DELETE FROM lyric_shares WHERE lyric_id = ?', PAGE);
    host.clock += RECHECK_MS;
    bo.type(0, 'x');
    await bo.sync();
    assert.equal(bo.socket.closed.code, CLOSE.UNSHARED);
  });

  it("evicts one person's sockets with 4004 and leaves the rest", async () => {
    const ann = await connect(ANN);
    const bo = await connect(BO);
    await room.evict(BO.email);
    assert.equal(bo.socket.closed.code, CLOSE.UNSHARED);
    assert.equal(ann.socket.closed, null);
  });

  it('closes the room with 4005 and deletes its storage', async () => {
    const ann = await connect(ANN);
    await room.leave(ann.socket);
    await runAlarm(host.clock + EMPTY_AFTER_MS);
    const bo = await connect(BO);
    await room.closeRoom();
    assert.equal(bo.socket.closed.code, CLOSE.PAGE_DELETED);
    assert.equal(host.storage.loadEpochSnapshot(ann.hello.epoch), null);
    assert.equal(host.alarmAt, null);
  });

  it('evicts on an idle room without reading D1', async () => {
    db.prepare = () => { throw new Error('D1 should not be read'); };
    await room.evict(BO.email);
  });
});

describe('waking', () => {
  it('asks open sockets for what it lost since the last snapshot', async () => {
    const ann = await connect(ANN);
    ann.type(5, ' world');
    await ann.sync();
    room = new RoomCore(host);
    ann.room = room;
    await runAlarm(host.clock + 1);
    await ann.sync();
    assert.equal(room.text(), 'hello world');
  });
});
