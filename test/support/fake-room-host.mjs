// Stand-ins for what a Durable Object gives RoomCore: sockets with
// attachments, storage, a clock and one alarm. TestClient syncs a Y.Doc with
// the room the way the browser client will.
import { writeEvent } from '../../collab/src/d1-page.js';
import { DiffMatchPatch, Y } from '../../collab/src/deps.js';
import {
  SYNC, encodePresence, encodeSyncStep1, encodeSyncStep2, encodeUpdate, readRoomMessage,
} from '../../collab/src/protocol.js';
import { RoomStorage } from '../../collab/src/room-storage.js';
import { createFakeDurableStorage } from './fake-durable-storage.mjs';

export class FakeSocket {
  constructor() {
    this.sent = [];
    this.closed = null;
    this.attachment = null;
  }

  send(bytes) {
    if (this.closed) throw new Error('send after close');
    this.sent.push(bytes);
  }

  close(code, reason) {
    this.closed = { code, reason };
  }

  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return this.attachment;
  }

  messages() {
    return this.sent.map(readRoomMessage);
  }
}

export function createRoomHost({ db, lyricId, startAt = 1_000_000 }) {
  const durable = createFakeDurableStorage();
  const storage = new RoomStorage(durable);
  storage.savePageId(lyricId);
  const host = {
    db, storage, durable, dmp: new DiffMatchPatch(), clock: startAt, alarmAt: null, alarmSets: 0,
    logs: [], open: [],
    lyricId: async () => storage.loadPageId(),
    sockets: () => host.open.filter(socket => !socket.closed),
    now: () => host.clock,
    getAlarm: async () => host.alarmAt,
    setAlarm: async at => {
      host.alarmAt = at;
      host.alarmSets += 1;
    },
    deleteAlarm: async () => {
      host.alarmAt = null;
    },
    recordEvent: (userId, event) => writeEvent(db, userId, event, host.clock),
    log: (event, fields) => host.logs.push({ event, ...fields }),
  };
  return host;
}

// A browser stand-in: its own Y.Doc, synced with the room over one socket.
export class TestClient {
  constructor(room, socket) {
    this.room = room;
    this.socket = socket;
    this.doc = new Y.Doc();
    this.read = 0;
    this.hello = null;
    this.persisted = null;
    this.presence = [];
    this.pending = [];
    this.doc.on('update', (update, origin) => {
      if (origin !== 'room') this.pending.push(this.room.message(this.socket, encodeUpdate(update)));
    });
  }

  get text() {
    return this.doc.getText('body').toString();
  }

  get title() {
    return this.doc.getMap('meta').get('title');
  }

  send(bytes) {
    this.pending.push(this.room.message(this.socket, bytes));
  }

  // Reads what the room sent since last time and answers sync step 1, then
  // waits for every message this client has sent.
  async sync() {
    for (; this.read < this.socket.sent.length; this.read += 1) {
      this.receive(readRoomMessage(this.socket.sent[this.read]));
    }
    await Promise.all(this.pending.splice(0));
    if (this.read < this.socket.sent.length) await this.sync();
  }

  receive(message) {
    if (message.kind === 'hello') this.hello = message;
    if (message.kind === 'persisted') this.persisted = message.snapshot;
    if (message.kind === 'presence') this.presence.push(message.update);
    if (message.kind !== 'sync') return;
    if (message.syncType === SYNC.STEP1) this.send(encodeSyncStep2(this.doc, message.payload));
    else Y.applyUpdate(this.doc, message.payload, 'room');
  }

  askForEverything() {
    this.send(encodeSyncStep1(this.doc));
  }

  type(index, text) {
    this.doc.getText('body').insert(index, text);
  }

  sendPresence(update) {
    this.send(encodePresence(update));
  }
}
