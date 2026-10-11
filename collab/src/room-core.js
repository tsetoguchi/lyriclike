// The room for one shared page (plans/live-co-editing.md §4). It relays edits
// between the people on the page, keeps the page as a Yjs snapshot, writes
// the plain text back to D1, and merges in saves made outside the room.
// Everything it touches comes in through `host`, so it runs under node --test
// with fakes; page-room.js plugs it into a Durable Object.
import liveCore from '../../live-core.js';
import { readPage, writePage } from './d1-page.js';
import { Y } from './deps.js';
import { stampPresence } from './presence.js';
import {
  CLOSE, encodeHello, encodePersisted, encodePresence, encodeSyncStep1, encodeSyncStep2,
  encodeUpdate, isProtocolAccepted, readIncoming,
} from './protocol.js';

export const TEXT_FIELD = 'body';
export const META_FIELD = 'meta';
export const TITLE_KEY = 'title';
export const MAX_SOCKETS = 20;
export const MAX_SOCKETS_PER_USER = 5;
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
export const MAX_BODY_LENGTH = 500_000;
// About 20 messages a second for 10 seconds; a working client sends at most 7.
export const RATE_WINDOW_MS = 10_000;
export const RATE_LIMIT = 200;
export const SNAPSHOT_MS = 5_000;
export const WRITE_BACK_MS = 10_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
export const EMPTY_AFTER_MS = 10 * 60_000;
// One retry after merging a save made outside the room.
const WRITE_ATTEMPTS = 2;
const OUTSIDE = 'outside';

function attachmentOf(socket) {
  return socket.deserializeAttachment() || {};
}

function updateAttachment(socket, changes) {
  socket.serializeAttachment({ ...attachmentOf(socket), ...changes });
}

function closeQuietly(socket, code, reason) {
  try {
    socket.close(code, reason);
  } catch {
    return;
  }
}

function seededDoc(page) {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getText(TEXT_FIELD).insert(0, page.body);
    doc.getMap(META_FIELD).set(TITLE_KEY, page.title);
  });
  return doc;
}

// The latest clock for each awareness client a socket has spoken for.
function mergeClients(known, fresh) {
  const clocks = new Map(known.map(({ clientID, clock }) => [clientID, clock]));
  for (const { clientID, clock } of fresh) clocks.set(clientID, Math.max(clock, clocks.get(clientID) ?? 0));
  return [...clocks].map(([clientID, clock]) => ({ clientID, clock }));
}

export class RoomCore {
  constructor(host) {
    this.host = host;
    this.loading = null;
    this.doc = null;
    this.isGone = false;
    this.rates = new Map();
    this.snapshotDirty = false;
    this.lastSnapshotAt = 0;
    this.writeFailures = 0;
    this.nextWriteBackAt = 0;
  }

  // ── Sockets ──

  openSockets() {
    return this.host.sockets().filter(socket => {
      const attachment = attachmentOf(socket);
      return attachment.socketId && !attachment.hasLeft;
    });
  }

  greetedSockets(exceptId) {
    return this.openSockets().filter(socket => {
      const attachment = attachmentOf(socket);
      return attachment.isGreeted && attachment.socketId !== exceptId;
    });
  }

  broadcast(message, exceptId) {
    for (const socket of this.greetedSockets(exceptId)) socket.send(message);
  }

  async closeSocket(socket, code, reason) {
    closeQuietly(socket, code, reason);
    this.host.log('close', { code });
  }

  capacityRefusal(userId) {
    const sockets = this.openSockets();
    if (sockets.length >= MAX_SOCKETS) {
      return { code: CLOSE.ROOM_FULL, reason: 'Too many people are on this page' };
    }
    const own = sockets.filter(socket => attachmentOf(socket).userId === userId);
    if (own.length >= MAX_SOCKETS_PER_USER) {
      return { code: CLOSE.TOO_MANY_TABS, reason: 'This page is open in too many tabs' };
    }
    return null;
  }

  // ── Joining ──

  async join(socket, { identity, sessionId, protocol, epoch }) {
    if (!isProtocolAccepted(protocol)) return socket.close(CLOSE.OLD_PROTOCOL, 'Reload for the new version');
    const refusal = this.capacityRefusal(identity.userId);
    if (refusal) return socket.close(refusal.code, refusal.reason);
    updateAttachment(socket, {
      ...identity, sessionId, socketId: crypto.randomUUID(), clients: [], presence: null,
    });
    await this.ensureLoaded();
    if (this.isGone) return;
    this.greet(socket, epoch);
    this.markOccupied();
    this.host.log('join', { userId: identity.userId });
  }

  greet(socket, clientEpoch) {
    const isOtherEpoch = clientEpoch && clientEpoch !== this.epoch;
    const oldSnapshot = isOtherEpoch ? this.host.storage.loadEpochSnapshot(clientEpoch) : null;
    socket.send(encodeHello(this.epoch, oldSnapshot));
    socket.send(encodeSyncStep1(this.doc));
    socket.send(encodePersisted(this.savedSnapshot));
    const { socketId } = attachmentOf(socket);
    for (const other of this.greetedSockets(socketId)) {
      const { presence } = attachmentOf(other);
      if (presence) socket.send(encodePresence(presence));
    }
    updateAttachment(socket, { isGreeted: true });
  }

  markOccupied() {
    if (this.emptySince === null) return;
    this.emptySince = null;
    this.saveMeta();
  }

  // ── Loading ──

  // One shared promise, so no message is handled half-loaded. Never in the
  // constructor: an /evict on an idle room must not read D1.
  ensureLoaded() {
    if (!this.loading) {
      this.loading = this.load().catch(err => {
        this.loading = null;
        throw err;
      });
    }
    return this.loading;
  }

  async load() {
    const page = await readPage(this.host.db, await this.host.lyricId());
    if (!page) return this.shutDown('page_gone');
    const { snapshot, meta } = this.host.storage.loadState();
    if (snapshot) this.restore(snapshot, meta);
    else this.seed(page);
    this.lastSnapshotAt = this.host.now();
    this.doc.on('update', (update, origin) => this.onDocUpdate(update, origin));
    // Saved before anyone is greeted: a room that hibernated unsaved would
    // seed again with a new history and duplicate the page on every screen.
    if (!snapshot) this.saveSnapshot();
    else if (this.isChangedOutside(page)) this.applyOutside(page);
  }

  restore(snapshot, meta) {
    this.doc = new Y.Doc();
    Y.applyUpdate(this.doc, snapshot);
    this.epoch = meta.epoch;
    this.written = meta.written;
    this.emptySince = meta.emptySince ?? null;
    this.savedSnapshot = Y.encodeSnapshot(Y.snapshot(this.doc));
  }

  seed(page) {
    this.doc = seededDoc(page);
    this.epoch = crypto.randomUUID();
    this.written = { revision: page.revision, text: page.body, title: page.title };
    this.emptySince = null;
  }

  async closeAll(code) {
    this.isGone = true;
    for (const socket of this.openSockets()) closeQuietly(socket, code, 'This page was deleted');
  }

  meta() {
    return { epoch: this.epoch, written: this.written, emptySince: this.emptySince };
  }

  saveMeta() {
    this.host.storage.saveMeta(this.meta());
  }

  text() {
    return this.doc.getText(TEXT_FIELD).toString();
  }

  title() {
    return this.doc.getMap(META_FIELD).get(TITLE_KEY) ?? '';
  }

  saveSnapshot() {
    this.savedSnapshot = Y.encodeSnapshot(Y.snapshot(this.doc));
    this.host.storage.saveSnapshot(Y.encodeStateAsUpdate(this.doc), this.meta());
    this.lastSnapshotAt = this.host.now();
    this.snapshotDirty = false;
    this.broadcast(encodePersisted(this.savedSnapshot));
  }

  onDocUpdate(update, origin) {
    this.snapshotDirty = true;
    this.broadcast(encodeUpdate(update), origin);
  }

  // ── Saving ──

  isD1Dirty() {
    return this.text() !== this.written.text || this.title() !== this.written.title;
  }

  isChangedOutside(page) {
    return page.revision !== this.written.revision || page.title !== this.written.title;
  }

  async alarm() {
    await this.ensureLoaded();
    if (this.isGone) return;
    const now = this.host.now();
    if (this.snapshotDirty && now - this.lastSnapshotAt >= SNAPSHOT_MS) this.saveSnapshot();
    if (this.isD1Dirty() && now >= this.nextWriteBackAt) await this.writeBack();
    if (this.isGone) return;
    await this.scheduleAlarm();
  }

  nextAlarmAt() {
    const times = [];
    if (this.snapshotDirty) times.push(this.lastSnapshotAt + SNAPSHOT_MS);
    if (this.isD1Dirty()) times.push(this.nextWriteBackAt);
    if (this.emptySince !== null && !this.openSockets().length) times.push(this.emptySince + EMPTY_AFTER_MS);
    return times.length ? Math.max(Math.min(...times), this.host.now()) : null;
  }

  // Every alarm set is a billed storage write, so it only moves earlier.
  async scheduleAlarm() {
    if (!this.doc) return;
    const next = this.nextAlarmAt();
    if (next === null) return;
    const current = await this.host.getAlarm();
    if (current === null || next < current) await this.host.setAlarm(next);
  }

  async writeBack() {
    try {
      const lyricId = await this.host.lyricId();
      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        if (await this.tryWrite(lyricId)) return;
        const page = await readPage(this.host.db, lyricId);
        if (!page) return this.shutDown('page_gone');
        this.applyOutside(page);
      }
      this.nextWriteBackAt = this.host.now() + WRITE_BACK_MS;
    } catch (err) {
      this.writeFailed(err);
    }
  }

  // The text is captured before the await, so edits made meanwhile simply
  // leave the room dirty for the next write.
  async tryWrite(lyricId) {
    const body = this.text();
    const title = this.title();
    const revision = await writePage(this.host.db, lyricId, {
      body, title, now: this.host.now(), baseRevision: this.written.revision, baseTitle: this.written.title,
    });
    if (revision === null) return false;
    this.written = { revision, text: body, title };
    this.writeFailures = 0;
    this.nextWriteBackAt = this.host.now() + WRITE_BACK_MS;
    this.saveMeta();
    return true;
  }

  writeFailed(err) {
    this.writeFailures += 1;
    const backoff = Math.min(WRITE_BACK_MS * 2 ** this.writeFailures, MAX_BACKOFF_MS);
    this.nextWriteBackAt = this.host.now() + backoff;
    this.host.log('write_back_failed', { failures: this.writeFailures, message: String(err) });
  }

  // A save or rename made outside the room (an old tab, a REST client while
  // the switch flips) is merged in, never written over.
  applyOutside(page) {
    const { dmp } = this.host;
    const roomText = this.text();
    const merged = liveCore.rebase(Y, dmp, this.written.text, page.body, roomText);
    const edits = liveCore.minimalEdits(dmp, roomText, merged);
    liveCore.applyEdits(this.doc.getText(TEXT_FIELD), edits, OUTSIDE);
    const title = liveCore.mergeTitle(this.written.title, this.title(), page.title);
    if (title !== this.title()) {
      this.doc.transact(() => this.doc.getMap(META_FIELD).set(TITLE_KEY, title), OUTSIDE);
    }
    this.written = { revision: page.revision, text: page.body, title: page.title };
    this.saveMeta();
    this.host.log('outside_merge', {});
  }

  async shutDown(event) {
    await this.closeAll(CLOSE.PAGE_DELETED);
    await this.host.storage.deleteAll();
    await this.host.deleteAlarm();
    this.host.log(event, {});
  }

  // ── Messages ──

  async message(socket, bytes) {
    if (bytes.byteLength > MAX_MESSAGE_BYTES) return this.closeSocket(socket, CLOSE.TOO_LARGE, 'Message too large');
    if (this.isTooFast(socket)) return this.closeSocket(socket, CLOSE.TOO_FAST, 'Too many messages');
    await this.ensureLoaded();
    if (this.isGone || attachmentOf(socket).hasLeft) return;
    await this.handle(socket, readIncoming(bytes));
    await this.scheduleAlarm();
  }

  async handle(socket, incoming) {
    if (incoming.kind === 'state-vector') socket.send(encodeSyncStep2(this.doc, incoming.stateVector));
    else if (incoming.kind === 'update') await this.receiveUpdate(socket, incoming.update);
    else if (incoming.kind === 'presence') this.receivePresence(socket, incoming.update);
  }

  // An update's byte length bounds the characters it can add, and a Yjs
  // update cannot be taken back once applied, so the cap is checked first.
  async receiveUpdate(socket, update) {
    const length = this.doc.getText(TEXT_FIELD).length;
    if (length + update.byteLength > MAX_BODY_LENGTH) {
      return this.closeSocket(socket, CLOSE.TOO_LARGE, 'The page would be too long');
    }
    try {
      Y.applyUpdate(this.doc, update, attachmentOf(socket).socketId);
    } catch {
      await this.closeSocket(socket, CLOSE.BAD_MESSAGE, 'Unreadable update');
    }
  }

  receivePresence(socket, update) {
    const attachment = attachmentOf(socket);
    let stamped;
    try {
      stamped = stampPresence(update, attachment);
    } catch {
      return;
    }
    const clients = mergeClients(attachment.clients, stamped.clients);
    updateAttachment(socket, { presence: stamped.update, clients });
    this.broadcast(encodePresence(stamped.update), attachment.socketId);
  }

  isTooFast(socket) {
    const { socketId } = attachmentOf(socket);
    const now = this.host.now();
    const rate = this.rates.get(socketId);
    if (!rate || now - rate.since >= RATE_WINDOW_MS) {
      this.rates.set(socketId, { since: now, count: 1 });
      return false;
    }
    rate.count += 1;
    return rate.count > RATE_LIMIT;
  }
}
