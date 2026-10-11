// Seeded fuzz: three writers and a room, random concurrent edits, dropped
// connections and a room restart. Every copy must end with the same text.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import liveCore from '../live-core.js';
import { Y } from './support/live-deps.mjs';

const { applyEdit, diffTextEdit } = liveCore;

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const STEPS = 400;
const CLIENT_COUNT = 3;
const PIECES = ['a', 'b', ' ', '\n', 'la', '😀', '😁', '鈴'];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LOCAL = 'local';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function safeIndex(value, index) {
  return liveCore.isMidPair(value, index) ? index - 1 : index;
}

// A random typing-like change: insert a piece, delete a stretch, or both.
// Positions avoid cutting an emoji, as a real textarea caret does.
function randomChange(random, value) {
  const at = safeIndex(value, Math.floor(random() * (value.length + 1)));
  const end = safeIndex(value, Math.min(value.length, at + Math.floor(random() * 4)));
  const insert = random() < 0.7 ? pick(random, PIECES) : '';
  const next = value.slice(0, at) + insert + value.slice(end);
  return { next, caret: at + insert.length };
}

function makeClient(id) {
  const doc = new Y.Doc();
  return { id, doc, text: doc.getText('body'), online: true, outbox: [], inbox: [] };
}

function wire(room, clients) {
  for (const client of clients) {
    client.doc.on('update', (update, origin) => {
      if (origin === LOCAL) client.outbox.push(update);
    });
  }
  room.onUpdate = (update, fromId) => {
    for (const other of clients) if (other.id !== fromId) other.inbox.push(update);
  };
}

function deliverOne(random, room, clients) {
  const client = pick(random, clients.filter(c => c.online));
  if (!client) return;
  if (client.outbox.length && random() < 0.5) {
    const update = client.outbox.shift();
    Y.applyUpdate(room.doc, update);
    room.onUpdate(update, client.id);
  } else if (client.inbox.length) {
    Y.applyUpdate(client.doc, client.inbox.shift(), 'remote');
  }
}

// What the y-protocols sync does on reconnect: each side sends what the
// other's state vector lacks.
function resync(room, client) {
  const toRoom = Y.encodeStateAsUpdate(client.doc, Y.encodeStateVector(room.doc));
  const toClient = Y.encodeStateAsUpdate(room.doc, Y.encodeStateVector(client.doc));
  Y.applyUpdate(room.doc, toRoom);
  Y.applyUpdate(client.doc, toClient, 'remote');
  client.outbox = [];
  client.inbox = [];
}

function restartRoom(room) {
  const restored = new Y.Doc();
  Y.applyUpdate(restored, room.snapshot);
  room.doc = restored;
}

function editRandomly(random, clients) {
  const client = pick(random, clients);
  const { next, caret } = randomChange(random, client.text.toString());
  const edit = diffTextEdit(client.text.toString(), next, caret);
  if (edit) applyEdit(client.text, edit, LOCAL);
}

function toggleConnection(random, room, clients) {
  const client = pick(random, clients);
  client.online = !client.online;
  if (client.online) resync(room, client);
}

function step(random, room, clients) {
  const roll = random();
  if (roll < 0.45) {
    editRandomly(random, clients);
  } else if (roll < 0.9) {
    deliverOne(random, room, clients);
  } else if (roll < 0.95) {
    toggleConnection(random, room, clients);
  } else if (roll < 0.98) {
    room.snapshot = Y.encodeStateAsUpdate(room.doc);
  } else {
    restartRoom(room);
    for (const client of clients) if (client.online) resync(room, client);
  }
}

function runSeed(seed) {
  const random = seededRandom(seed);
  // [0, 0] is an empty update, so a restart before any snapshot empties the
  // room and the clients' resync must bring everything back.
  const room = { doc: new Y.Doc(), snapshot: new Uint8Array([0, 0]) };
  const clients = Array.from({ length: CLIENT_COUNT }, (_, i) => makeClient(i));
  wire(room, clients);
  for (let i = 0; i < STEPS; i += 1) step(random, room, clients);
  for (const client of clients) {
    client.online = true;
    resync(room, client);
  }
  for (const client of clients) resync(room, client);
  return { room: room.doc.getText('body').toString(), clients: clients.map(c => c.text.toString()) };
}

describe('convergence', () => {
  for (const seed of SEEDS) {
    it(`every copy ends with the same text (seed ${seed})`, () => {
      const { room, clients } = runSeed(seed);
      for (const text of clients) assert.equal(text, room);
      assert.equal(LONE_SURROGATE.test(room), false);
      assert.ok(room.length > 0, 'the run should leave some text to compare');
    });
  }
});
