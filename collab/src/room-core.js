// The room for one shared page (plans/live-co-editing.md §4). It relays edits
// between the people on the page, keeps the page as a Yjs snapshot, writes
// the plain text back to D1, and merges in saves made outside the room.
// Everything it touches comes in through `host`, so it runs under node --test
// with fakes; page-room.js plugs it into a Durable Object.
import liveCore from '../../live-core.js';
import { readAccess, readPage, writePage } from './d1-page.js';
import { Y } from './deps.js';
import { leavePresence, stampPresence } from './presence.js';
import {
  CLOSE, encodeHello, encodePersisted, encodePresence, encodeSyncStep1, encodeSyncStep2,
  encodeUpdate, isProtocolAccepted, readIncoming,
} from './protocol.js';
import { pageSavedEvent, roomEmptiedEvent, writtenSnapshot } from './room-events.js';

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
export const RECHECK_MS = 5 * 60_000;
// One retry after merging a save made outside the room.
const WRITE_ATTEMPTS = 2;
const OUTSIDE = 'outside';
const REPLACE = 'replace';
const LIVE_SESSION_EVENT = 'live_session';
const EDIT_REASON = 'edit';
const REPLACE_REASON = 'replace';

function attachmentOf(socket) {
  return socket.deserializeAttachment() || {};
}

function updateAttachment(socket, changes) {
  socket.serializeAttachment({ ...attachmentOf(socket), ...changes });
}

// A socket the client just closed can still be listed for a moment; failing
// to reach it must not stop anyone else getting the message.
function sendQuietly(socket, message) {
  try {
    socket.send(message);
  } catch {
    return;
  }
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
    this.writing = null;
    this.rechecking = null;
    // Who sent updates since the last write landed, and who sent any since
    // the write under way took its copy of that list.
    this.writers = new Set();
    this.typedSinceCapture = new Set();
    this.applyingFrom = null;
    // Event hook messages wait here until the write lock is free.
    this.outbox = [];
    // A fresh instance, new or just woken, checks access on its first message.
    this.lastRecheckAt = 0;
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
    for (const socket of this.greetedSockets(exceptId)) sendQuietly(socket, message);
  }

  async closeSocket(socket, code, reason) {
    closeQuietly(socket, code, reason);
    this.host.log('close', { code });
    await this.leave(socket);
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
    try {
      await this.ensureLoaded();
    } catch (err) {
      return this.refuseAfterFailedLoad(socket, err);
    }
    if (this.isGone) return closeQuietly(socket, CLOSE.PAGE_DELETED, 'This page was deleted');
    this.greet(socket, epoch);
    this.markOccupied();
    this.host.log('join', { userId: identity.userId });
    await this.recordLiveSession(identity.userId);
  }

  // The person who joins second is the one logged, so a page opened by its
  // owner alone, or by one person in two tabs, never counts as live editing.
  async recordLiveSession(userId) {
    const isSomeoneElseHere = this.openSockets().some(socket => attachmentOf(socket).userId !== userId);
    if (!isSomeoneElseHere) return;
    try {
      await this.host.recordEvent(userId, LIVE_SESSION_EVENT);
    } catch (err) {
      this.host.log('record_failed', { message: String(err) });
    }
  }

  // A failed load leaves nobody half-joined: the socket would otherwise count
  // toward the limits and keep the room from ever emptying.
  refuseAfterFailedLoad(socket, err) {
    updateAttachment(socket, { hasLeft: true });
    closeQuietly(socket, CLOSE.TRY_AGAIN, 'Could not open the page, try again');
    this.host.log('join_failed', { message: String(err) });
  }

  greet(socket, clientEpoch) {
    const isOtherEpoch = clientEpoch && clientEpoch !== this.epoch;
    const oldSnapshot = isOtherEpoch ? this.host.storage.loadEpochSnapshot(clientEpoch) : null;
    sendQuietly(socket, encodeHello(this.epoch, oldSnapshot));
    sendQuietly(socket, encodeSyncStep1(this.doc));
    sendQuietly(socket, encodePersisted(this.savedSnapshot));
    const { socketId } = attachmentOf(socket);
    for (const other of this.greetedSockets(socketId)) {
      const { presence } = attachmentOf(other);
      if (presence) sendQuietly(socket, encodePresence(presence));
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
    this.ownerId = page.user_id;
    const { snapshot, meta } = this.host.storage.loadState();
    if (snapshot) this.restore(snapshot, meta);
    else this.seed(page);
    this.fillWrittenTime(page);
    this.lastSnapshotAt = this.host.now();
    this.doc.on('update', (update, origin) => this.onDocUpdate(update, origin));
    // Saved before anyone is greeted: a room that hibernated unsaved would
    // seed again with a new history and duplicate the page on every screen.
    if (!snapshot) this.saveSnapshot();
    else if (this.isChangedOutside(page)) this.applyOutside(page);
    this.resyncSockets();
  }

  restore(snapshot, meta) {
    this.doc = new Y.Doc();
    Y.applyUpdate(this.doc, snapshot);
    this.epoch = meta.epoch;
    this.written = meta.written;
    this.emptySince = meta.emptySince ?? null;
    this.writers = new Set(meta.writers ?? []);
    this.savedSnapshot = Y.encodeSnapshot(Y.snapshot(this.doc));
  }

  seed(page) {
    this.doc = seededDoc(page);
    this.epoch = crypto.randomUUID();
    this.written = { revision: page.revision, text: page.body, title: page.title, updatedAt: page.updated_at };
    this.emptySince = null;
    this.writers = new Set();
  }

  // Meta saved before the room kept the time of its last write lacks it; D1
  // still on the room's revision holds that time. Otherwise the outside
  // merge that follows sets it.
  fillWrittenTime(page) {
    if (this.written.updatedAt === undefined && page.revision === this.written.revision) {
      this.written.updatedAt = page.updated_at;
    }
  }

  async closeAll(code) {
    this.isGone = true;
    for (const socket of this.openSockets()) closeQuietly(socket, code, 'This page was deleted');
  }

  meta() {
    return { epoch: this.epoch, written: this.written, emptySince: this.emptySince, writers: [...this.writers] };
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
    if (this.applyingFrom) this.noteWriter(this.applyingFrom);
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
    if (this.openSockets().length && now - this.lastRecheckAt >= RECHECK_MS) await this.recheck();
    if (this.isReadyToEmpty(now)) return this.emptyWorkingCopy();
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

  // One at a time: two overlapping writes would each see the other's as a
  // save from outside and merge the same words in twice.
  writeBack() {
    if (!this.writing) {
      // Clears only its own lock: a replace may have queued and taken it.
      const held = this.writeBackOnce().finally(() => {
        if (this.writing === held) this.writing = null;
        this.releaseEvents();
      });
      this.writing = held;
    }
    return this.writing;
  }

  async writeBackOnce() {
    try {
      const lyricId = await this.host.lyricId();
      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        const sent = await this.tryWrite(lyricId);
        if (sent.revision !== null) return;
        const page = await readPage(this.host.db, lyricId);
        if (!page) return this.shutDown('page_gone');
        if (this.isOwnWrite(page, sent)) return this.takeOwnWrite(lyricId, page, sent);
        this.applyOutside(page);
      }
      this.nextWriteBackAt = this.host.now() + WRITE_BACK_MS;
    } catch (err) {
      this.writeFailed(err);
    }
  }

  // The snapshot is saved first, so D1 never holds text the snapshot lacks: a
  // restart would otherwise take D1 as written and put the older text back.
  // The text is captured before the await, so edits made meanwhile simply
  // leave the room dirty for the next write.
  async tryWrite(lyricId) {
    if (this.snapshotDirty) this.saveSnapshot();
    const sent = this.captureWrite();
    const revision = await writePage(this.host.db, lyricId, {
      body: sent.body, title: sent.title, now: sent.now,
      baseRevision: this.written.revision, baseTitle: this.written.title,
    });
    if (revision !== null) {
      this.queueWritten(lyricId, sent, revision, sent.now);
      this.adoptWrite(revision, sent, sent.now);
    }
    return { ...sent, revision };
  }

  // What a write sends, and what the page was before it, taken together.
  captureWrite() {
    this.typedSinceCapture = new Set();
    return {
      body: this.text(), title: this.title(), now: this.host.now(),
      before: writtenSnapshot(this.written), writerIds: [...this.writers],
    };
  }

  takeOwnWrite(lyricId, page, sent) {
    this.queueWritten(lyricId, sent, page.revision, page.updated_at);
    this.adoptWrite(page.revision, sent, page.updated_at);
  }

  // Before adoptWrite saves the meta, so the names just sent are not kept.
  queueWritten(lyricId, sent, revision, updatedAt) {
    this.queueEvent(pageSavedEvent({
      pageId: lyricId, ownerId: this.ownerId, writerIds: sent.writerIds, reason: EDIT_REASON,
      before: sent.before, after: { title: sent.title, body: sent.body, revision, updated_at: updatedAt },
    }));
    for (const userId of sent.writerIds) {
      if (!this.typedSinceCapture.has(userId)) this.writers.delete(userId);
    }
  }

  // D1 holding exactly what the room sent means the write landed and only its
  // answer was lost; merging it as an outside save would double the words.
  isOwnWrite(page, sent) {
    return page.body === sent.body && page.title === sent.title;
  }

  adoptWrite(revision, { body, title }, updatedAt) {
    this.written = { revision, text: body, title, updatedAt };
    this.writeFailures = 0;
    this.nextWriteBackAt = this.host.now() + WRITE_BACK_MS;
    this.saveMeta();
  }

  // ── Replacing the whole page ──

  // Holds the write lock like a write-back, after any one in flight, so no
  // write-back lands between its D1 write and the change to everyone's text.
  replace(words) {
    const held = Promise.resolve(this.writing).then(() => this.replaceOnce(words)).finally(() => {
      if (this.writing === held) this.writing = null;
      this.releaseEvents();
    });
    this.writing = held;
    return held;
  }

  // A D1 failure leaves the page and everyone's text as they were.
  async replaceOnce(words) {
    try {
      return await this.replaceInD1(words);
    } catch (err) {
      this.host.log('replace_failed', { message: String(err) });
      return { error: 'busy' };
    }
  }

  // Typed words are written back first, so the page D1 replaces holds them.
  async replaceInD1({ title, body, tag = null, userId = null }) {
    await this.ensureLoaded();
    if (this.isGone) return { error: 'not_found' };
    if (this.isD1Dirty()) await this.writeBackOnce();
    if (this.isGone) return { error: 'not_found' };
    if (this.isD1Dirty()) return { error: 'busy' };
    const lyricId = await this.host.lyricId();
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = this.host.now();
      const before = writtenSnapshot(this.written);
      const revision = await writePage(this.host.db, lyricId, {
        body, title, now, baseRevision: this.written.revision, baseTitle: this.written.title,
      });
      if (revision !== null) {
        this.queueEvent(pageSavedEvent({
          pageId: lyricId, ownerId: this.ownerId, writerIds: userId ? [userId] : [],
          reason: REPLACE_REASON, tag, before, after: { title, body, revision, updated_at: now },
        }));
        return this.takeReplaced(revision, { body, title }, now);
      }
      const page = await readPage(this.host.db, lyricId);
      if (!page) {
        await this.shutDown('page_gone');
        return { error: 'not_found' };
      }
      this.applyOutside(page);
    }
    return { error: 'busy' };
  }

  // D1 already holds the words; now every screen gets them at once.
  async takeReplaced(revision, { body, title }, now) {
    const { dmp } = this.host;
    liveCore.applyEdits(this.doc.getText(TEXT_FIELD), liveCore.minimalEdits(dmp, this.text(), body), REPLACE);
    if (title !== this.title()) {
      this.doc.transact(() => this.doc.getMap(META_FIELD).set(TITLE_KEY, title), REPLACE);
    }
    this.adoptWrite(revision, { body, title }, now);
    this.saveSnapshot();
    await this.scheduleAlarm();
    return { revision, updatedAt: now };
  }

  // ── Event hook messages ──

  queueEvent(event) {
    this.outbox.push(event);
  }

  // Sent only once the write lock is free, so a slow hook never holds up
  // the next write.
  releaseEvents() {
    for (const event of this.outbox.splice(0)) {
      try {
        this.host.sendEvent(event);
      } catch (err) {
        this.host.log('send_failed', { message: String(err) });
      }
    }
  }

  noteWriter(userId) {
    this.writers.add(userId);
    this.typedSinceCapture.add(userId);
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
    this.written = { revision: page.revision, text: page.body, title: page.title, updatedAt: page.updated_at };
    this.saveMeta();
    this.host.log('outside_merge', {});
  }

  async shutDown(event) {
    await this.closeAll(CLOSE.PAGE_DELETED);
    await this.host.storage.deleteAll();
    await this.host.deleteAlarm();
    this.host.log(event, {});
  }

  // ── Leaving and emptying ──

  // Runs once per socket, whether the server closed it or the client went.
  async leave(socket) {
    const attachment = attachmentOf(socket);
    if (!attachment.socketId || attachment.hasLeft) return;
    updateAttachment(socket, { hasLeft: true });
    this.rates.delete(attachment.socketId);
    if (attachment.clients?.length) this.broadcast(encodePresence(leavePresence(attachment.clients)));
    if (this.isGone || this.openSockets().length) return;
    await this.ensureLoaded();
    if (!this.isGone) await this.settleEmptyRoom();
  }

  // The last person left: save now, and empty in 10 minutes unless someone
  // comes back. The 10 minutes cover quick reloads and deploy restarts.
  async settleEmptyRoom() {
    if (this.snapshotDirty) this.saveSnapshot();
    if (this.isD1Dirty()) await this.writeBack();
    if (this.isGone) return;
    this.emptySince = this.host.now();
    this.saveMeta();
    await this.scheduleAlarm();
  }

  // Never while D1 lacks the text: the snapshot is then the only copy. Nor
  // while a write is under way: a replace still needs the doc.
  isReadyToEmpty(now) {
    return this.emptySince !== null && !this.openSockets().length && !this.writing
      && now - this.emptySince >= EMPTY_AFTER_MS && !this.snapshotDirty && !this.isD1Dirty();
  }

  async emptyWorkingCopy() {
    this.host.storage.clearWorkingCopy(this.epoch, this.savedSnapshot, this.host.now());
    this.doc.destroy();
    this.doc = null;
    this.loading = null;
    this.host.log('emptied', {});
    this.queueEvent(roomEmptiedEvent(await this.host.lyricId()));
    this.releaseEvents();
  }

  // A doc rebuilt after hibernation may lack the last few seconds before
  // the snapshot; asking every open socket for what the room is missing
  // brings those edits back.
  resyncSockets() {
    if (!this.doc) return;
    for (const socket of this.greetedSockets()) sendQuietly(socket, encodeSyncStep1(this.doc));
  }

  // ── Access ──

  // One at a time, and every message waits for one in flight: otherwise a
  // signed-out person's other tab gets edits in while D1 answers.
  recheck() {
    if (!this.rechecking) {
      this.rechecking = this.recheckOnce().finally(() => {
        this.rechecking = null;
      });
    }
    return this.rechecking;
  }

  async recheckOnce() {
    this.lastRecheckAt = this.host.now();
    const sockets = this.openSockets();
    if (!sockets.length) return;
    const sessionIds = sockets.map(socket => attachmentOf(socket).sessionId);
    const access = await readAccess(this.host.db, await this.host.lyricId(), sessionIds, this.host.now());
    for (const socket of sockets) {
      const { sessionId, email } = attachmentOf(socket);
      if (!access.validSessions.has(sessionId)) await this.closeSocket(socket, CLOSE.SIGNED_OUT, 'Signed out');
      else if (!access.allowedEmails.has(email)) await this.closeSocket(socket, CLOSE.UNSHARED, 'No longer shared with you');
    }
  }

  // A room with no alarm runs no timers, so a signed-out tab is caught by its
  // next message once 5 minutes have passed since the last check.
  async isRefusedOnRecheck(socket) {
    const isDue = this.host.now() - this.lastRecheckAt >= RECHECK_MS;
    if (!isDue && !this.rechecking) return false;
    await this.recheck();
    return Boolean(attachmentOf(socket).hasLeft);
  }

  async evict(email) {
    for (const socket of this.openSockets()) {
      if (attachmentOf(socket).email === email) await this.closeSocket(socket, CLOSE.UNSHARED, 'No longer shared with you');
    }
  }

  async closeRoom() {
    await this.shutDown('closed');
  }

  // ── Messages ──

  async message(socket, bytes) {
    // A refused socket still delivers what its client sent before the close.
    const { socketId, hasLeft } = attachmentOf(socket);
    if (!socketId || hasLeft) return;
    if (bytes.byteLength > MAX_MESSAGE_BYTES) return this.closeSocket(socket, CLOSE.TOO_LARGE, 'Message too large');
    if (this.isTooFast(socket)) return this.closeSocket(socket, CLOSE.TOO_FAST, 'Too many messages');
    await this.ensureLoaded();
    if (this.isGone || attachmentOf(socket).hasLeft) return;
    if (await this.isRefusedOnRecheck(socket)) return;
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
    const { socketId, userId } = attachmentOf(socket);
    // Named only if the update changed the page: every join and wake-up
    // sends a sync reply that may hold nothing new.
    let isUnreadable = false;
    this.applyingFrom = userId;
    try {
      Y.applyUpdate(this.doc, update, socketId);
    } catch {
      isUnreadable = true;
    } finally {
      this.applyingFrom = null;
    }
    if (isUnreadable) await this.closeSocket(socket, CLOSE.BAD_MESSAGE, 'Unreadable update');
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
