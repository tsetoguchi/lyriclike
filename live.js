// Live editing in the browser (plans/live-co-editing.md §5.2): one session
// for the shared page on screen. It connects to the page's room, keeps a
// working Y.Doc bound to the editor and a confirmed one holding only what
// the room has saved, reconnects when the connection drops, and tells the
// page what to show. Everything outside comes in through `env`, so the same
// code runs in Node tests against an in-process room.
(function exposeLive(root) {
  'use strict';

  const LIVE_DEPS_SRC = '/vendor/live-deps-yjs13.6.33-p1.js';
  const TEXT_FIELD = 'body';
  const META_FIELD = 'meta';
  const TITLE_KEY = 'title';
  const REMOTE_ORIGIN = 'remote';
  const SEND_EVERY_MS = 200;
  const FLUSH_WAIT_MS = 5000;
  const SOCKET_OPEN = 1;
  const KEEPALIVE_MS = 30000;
  const PONG_WAIT_MS = 2000;
  const OFFLINE_NOTICE_MS = 5000;
  const RECONNECT_FIRST_MS = 1000;
  const RECONNECT_MAX_MS = 30000;
  // A refused upgrade looks like any dropped socket (1006). After this many
  // failed tries in a row, the page asks the server whether it is still live:
  // live editing may have been switched off, or the page unshared.
  const LIVE_CHECK_EVERY_ATTEMPTS = 3;
  const NORMAL_CLOSE = 1000;
  const PING = 'ping';
  const PONG = 'pong';
  // How long to wait before trying the bundle again when it failed to load.
  const DEPS_RETRY_MS = 5000;
  // The local copy is written at most this often while words change: a
  // long page on every keystroke would be the costliest thing typing does.
  const PERSIST_EVERY_MS = 500;
  // Anything that can move the caret. selectionchange fires on the textarea
  // in current browsers; the others cover older ones.
  const SELECTION_EVENTS = ['input', 'select', 'selectionchange', 'keyup', 'pointerup', 'focus'];

  // Without the presence script (a test that does not need it, or a tab
  // where it failed to load) the page edits as before and shows nobody.
  const NO_PRESENCE = Object.freeze({
    attach() {}, receive() {}, refresh() {}, selectionMoved() {}, announce() {}, restart() {}, destroy() {},
  });

  const TEXT = Object.freeze({
    saving: 'Saving...',
    offline: 'Offline, changes will sync',
    tooLong: 'This page is at its length limit.',
    roomFull: 'Too many people are on this page right now. It is read-only for you.',
    tooManyTabs: 'This page is open in too many of your tabs. It is read-only here.',
  });

  // Where a caret at `position` in the old text sits after minimal edits.
  // Edits come in text order, each against the text the earlier ones left.
  function mapThroughEdits(position, edits) {
    let mapped = position;
    for (const { index, deleteCount, insert } of edits) {
      if (index >= mapped) break;
      mapped += insert.length - Math.min(deleteCount, mapped - index);
    }
    return mapped;
  }

  // A copy is used only if it has the shape this version writes; anything
  // else (an older format, a damaged store) is set aside.
  function isUsableCopy(record) {
    return Boolean(record)
      && typeof record.epoch === 'string' && typeof record.savedAt === 'number'
      && record.working instanceof Uint8Array && record.confirmed instanceof Uint8Array
      && Array.isArray(record.pending) && record.pending.every(update => update instanceof Uint8Array);
  }

  // The draft is text, so a Yjs update rides in it as base64.
  function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function base64ToBytes(text) {
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
  }

  function textOfUpdate(Y, update) {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, update);
      return doc.getText(TEXT_FIELD).toString();
    } finally {
      doc.destroy();
    }
  }

  class PageConnection {
    constructor(env, deps, { id, body, title, restore = null }, record = null) {
      this.env = env;
      this.deps = deps;
      this.dmp = new deps.DiffMatchPatch();
      this.id = id;
      this.base = body;
      this.title = title;
      this.pending = [];
      this.outbox = [];
      this.timers = {};
      this.flushWaiters = [];
      this.lastSentAt = 0;
      this.attempts = 0;
      this.epoch = null;
      this.isSynced = false;
      this.isClosed = false;
      this.wasSaving = false;
      this.lastStamp = 0;
      this.isCopyFailing = false;
      // What the last copy that landed holds, so leaving can add what came after.
      this.committedVector = null;
      this.hasConfirmedText = false;
      this.isCopyAhead = false;
      this.makeDocs();
      if (record) this.restoreOrSetAside(record, restore || {});
      this.presence = this.makePresence();
      this.watchSelection();
    }

    makeDocs() {
      const { Y } = this.deps;
      this.working = new Y.Doc();
      this.confirmed = new Y.Doc();
      this.working.on('update', (update, origin) => this.onWorkingUpdate(update, origin));
      this.working.getMap(META_FIELD).observe(event => this.onMetaChange(event));
    }

    // ── Resuming from the local copy ──

    // An unreadable copy is set aside: the page opens as if there were none.
    restoreOrSetAside(record, draft) {
      try {
        this.restore(record, draft);
      } catch {
        this.working.destroy();
        this.confirmed.destroy();
        this.makeDocs();
      }
    }

    // A reload resumes from the copy: the same docs, epoch and unsaved
    // updates, so the room's normal sync re-sends exactly what it lacks,
    // and only words typed since loading are rebased.
    restore(record, { copyAt, shown, delta }) {
      const { Y } = this.deps;
      Y.applyUpdate(this.working, record.working, REMOTE_ORIGIN);
      Y.applyUpdate(this.confirmed, record.confirmed, REMOTE_ORIGIN);
      const pending = record.pending.slice();
      // What the page had on its way out, past this copy: unsent typing and a
      // co-writer's words. Yjs ignores what the copy already holds.
      if (typeof delta === 'string') {
        const update = base64ToBytes(delta);
        Y.applyUpdate(this.working, update, REMOTE_ORIGIN);
        pending.push(update);
      }
      this.copyText = this.working.getText(TEXT_FIELD).toString();
      this.pending = pending;
      this.epoch = record.epoch;
      this.lastStamp = record.savedAt;
      this.base = this.copyText;
      this.hasConfirmedText = true;
      // The copy was written after the draft on screen: the page went
      // before its draft caught up, so the copy's words are the real start.
      this.isCopyAhead = typeof copyAt === 'number' && record.savedAt > copyAt;
      this.shown = shown;
    }

    // What this tab adds to the room: the screen, or, when the copy is ahead
    // of the draft that was shown, the copy plus whatever was typed since.
    localText(onScreen) {
      if (!this.isCopyAhead) return onScreen;
      if (onScreen === this.shown) return this.copyText;
      return this.env.liveCore.rebase(this.deps.Y, this.dmp, this.shown, onScreen, this.copyText);
    }

    // ── Presence ──

    makePresence() {
      const { env, deps } = this;
      if (!env.livePresence) return NO_PRESENCE;
      return new env.livePresence.PresenceChannel({
        deps, clock: env, me: env.me ? env.me() : null,
        show: view => env.showPresence(view),
        send: bytes => this.sendIfOpen(bytes),
        readSelection: () => this.ownSelection(),
      });
    }

    // Only a focused editor has a caret worth showing; a page just opened
    // has its caret at the end, where nobody put it.
    ownSelection() {
      const { textarea } = this.env;
      if (!this.isSynced || !this.env.isFocused()) return null;
      return { start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection };
    }

    watchSelection() {
      this.onSelection = () => this.presence.selectionMoved();
      for (const type of SELECTION_EVENTS) this.env.textarea.addEventListener(type, this.onSelection);
    }

    unwatchSelection() {
      for (const type of SELECTION_EVENTS) this.env.textarea.removeEventListener(type, this.onSelection);
    }

    presenceHidden() {
      if (this.isSynced) this.presence.hide();
    }

    presenceShown() {
      if (this.isSynced) this.presence.announce();
    }

    sendIfOpen(bytes) {
      if (!this.isOpen()) return false;
      this.socket.send(bytes);
      return true;
    }

    // ── Timers ──

    setTimer(name, ms, fn) {
      this.clearTimer(name);
      this.timers[name] = this.env.setTimeout(() => {
        delete this.timers[name];
        fn();
      }, ms);
    }

    clearTimer(name) {
      if (this.timers[name] === undefined) return;
      this.env.clearTimeout(this.timers[name]);
      delete this.timers[name];
    }

    // ── Connecting ──

    isOpen() {
      return Boolean(this.socket) && this.socket.readyState === SOCKET_OPEN;
    }

    connect() {
      if (this.isClosed) return;
      const { protocol } = this.deps;
      const epoch = this.epoch ? `&epoch=${encodeURIComponent(this.epoch)}` : '';
      const path = `/api/lyrics/${encodeURIComponent(this.id)}/live?protocol=${protocol.PROTOCOL_VERSION}${epoch}`;
      const socket = this.env.openSocket(path);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => this.onOpen(socket);
      socket.onmessage = event => this.onMessage(socket, event.data);
      socket.onclose = event => this.onClose(socket, event.code);
      this.socket = socket;
    }

    // The sync step 1 asks for everything this tab lacks; the room's own
    // step 1, answered below, collects everything it lacks, which covers any
    // updates that never went out.
    onOpen(socket) {
      if (socket !== this.socket) return;
      this.outbox = [];
      socket.send(this.deps.protocol.encodeSyncStep1(this.working));
      this.startKeepalive();
      this.clearTimer('offline');
      this.isOffline = false;
      this.updateIndicator();
      // A reconnect: the room forgot this tab's presence with the old socket.
      if (this.isSynced) this.presence.announce();
    }

    onMessage(socket, data) {
      if (socket !== this.socket) return;
      if (typeof data === 'string') {
        if (data === PONG) this.clearTimer('pong');
        return;
      }
      const message = this.deps.protocol.readRoomMessage(new Uint8Array(data));
      if (message.kind === 'hello') this.onHello(message);
      else if (message.kind === 'persisted') this.onPersisted(message.snapshot);
      else if (message.kind === 'presence') this.presence.receive(message.update);
      else if (message.kind === 'sync') this.onSync(socket, message);
    }

    // A new epoch means the room emptied and re-seeded from D1 while this tab
    // was away: its doc shares no history with ours. The copy is brought up
    // to date first (until the next sync, drafts are plain text written on
    // top of it). The old epoch's final snapshot says which pending updates
    // reached the room before it emptied; those reached D1 and the new seed
    // too, so they count as confirmed. Then the tab starts over from the
    // room, rebasing what is on screen.
    onHello(hello) {
      if (this.epoch && hello.epoch !== this.epoch) {
        this.persistNow();
        this.confirmFrom(hello.oldEpochSnapshot);
        this.restartFromRoom();
      }
      this.epoch = hello.epoch;
    }

    // Without a snapshot (the room keeps the last 20 epochs), the base is the
    // confirmed text as it is, which can repeat a few seconds of typing.
    confirmFrom(snapshot) {
      if (!snapshot) return;
      const { Y } = this.deps;
      this.pending = this.pending.filter(update => {
        if (!this.env.liveCore.isUpdateSaved(Y, update, snapshot)) return true;
        Y.applyUpdate(this.confirmed, update, REMOTE_ORIGIN);
        return false;
      });
    }

    restartFromRoom() {
      this.presence.attach(null);
      if (this.isSynced || this.hasConfirmedText) this.base = this.confirmed.getText(TEXT_FIELD).toString();
      this.binding?.destroy();
      this.binding = null;
      this.working.destroy();
      this.confirmed.destroy();
      this.pending = [];
      this.isSynced = false;
      this.hasConfirmedText = false;
      this.makeDocs();
    }

    onSync(socket, message) {
      const { protocol, Y } = this.deps;
      if (message.syncType === protocol.SYNC.STEP1) {
        socket.send(protocol.encodeSyncStep2(this.working, message.payload));
        return;
      }
      // Once synced, a co-writer's words reach both docs through the
      // binding, on the frame that shows them (onWorkingUpdate).
      if (this.isSynced) return this.binding.queueRemote(message.payload);
      Y.applyUpdate(this.confirmed, message.payload, REMOTE_ORIGIN);
      Y.applyUpdate(this.working, message.payload, REMOTE_ORIGIN);
      if (message.syncType === protocol.SYNC.STEP2) this.finishSync();
    }

    // The editor stayed usable while connecting; whatever was typed since the
    // page loaded is rebased three ways onto the room's text.
    finishSync() {
      const { textarea } = this.env;
      const roomText = this.working.getText(TEXT_FIELD).toString();
      const onScreen = textarea.value;
      const local = this.localText(onScreen);
      const selection = { start: textarea.selectionStart, end: textarea.selectionEnd };
      // Matching the room already means everything typed reached it; a
      // rebase would only insert those words a second time.
      const merged = local === this.base || local === roomText
        ? roomText
        : this.env.liveCore.rebase(this.deps.Y, this.dmp, this.base, local, roomText);
      textarea.value = roomText;
      this.binding = this.createBinding();
      this.isSynced = true;
      this.isCopyAhead = false;
      this.attempts = 0;
      if (merged !== roomText) this.binding.applyLocalText(merged);
      else textarea.dispatchEvent(new Event('input'));
      this.keepSelection(selection, onScreen, merged);
      this.applyRoomTitle();
      if (this.pendingTitle !== undefined) this.rename(this.pendingTitle);
      this.presence.attach(this.working);
      this.presence.announce();
      this.persistNow();
      this.updateIndicator();
      if (!this.pending.length) this.resolveFlush(true);
    }

    // Setting the value moves a browser's caret to the end; put it back on
    // the same words.
    keepSelection(selection, local, merged) {
      if (!this.env.isFocused()) return;
      const edits = this.env.liveCore.minimalEdits(this.dmp, local, merged);
      this.env.textarea.setSelectionRange(
        mapThroughEdits(selection.start, edits), mapThroughEdits(selection.end, edits));
    }

    createBinding() {
      const { env } = this;
      return env.createTextBinding({
        textarea: env.textarea, doc: this.working, Y: this.deps.Y, liveCore: env.liveCore, dmp: this.dmp,
        schedule: env.schedule, isFocused: env.isFocused, adjustScroll: env.adjustScroll,
        onTooLong: () => env.page.notice(TEXT.tooLong),
      });
    }

    // ── Sending and saving ──

    // A co-writer's words join the confirmed doc on the frame that shows
    // them, so the confirmed doc never holds words the screen lacks.
    onWorkingUpdate(update, origin) {
      if (!this.isSynced) return;
      // Carets are positions in the text, so they move with it.
      this.presence.refresh();
      this.schedulePersist();
      if (origin === REMOTE_ORIGIN) return this.deps.Y.applyUpdate(this.confirmed, update, REMOTE_ORIGIN);
      this.pending.push(update);
      this.outbox.push(update);
      this.scheduleSend();
      this.updateIndicator();
    }

    scheduleSend() {
      if (this.timers.send !== undefined) return;
      const wait = Math.max(0, this.lastSentAt + SEND_EVERY_MS - this.env.now());
      this.setTimer('send', wait, () => this.sendOutbox());
    }

    sendOutbox() {
      if (!this.outbox.length || !this.isOpen()) return;
      const { protocol, Y } = this.deps;
      this.socket.send(protocol.encodeUpdate(Y.mergeUpdates(this.outbox.splice(0))));
      this.lastSentAt = this.env.now();
    }

    // An update counts as saved once the room's saved snapshot holds it;
    // then it joins the confirmed doc, the base for any later rebase.
    onPersisted(snapshot) {
      const { Y } = this.deps;
      const unsaved = [];
      for (const update of this.pending) {
        if (this.env.liveCore.isUpdateSaved(Y, update, snapshot)) Y.applyUpdate(this.confirmed, update, REMOTE_ORIGIN);
        else unsaved.push(update);
      }
      this.pending = unsaved;
      this.schedulePersist();
      this.updateIndicator();
      // The room greets with its saved snapshot before the first sync ends;
      // words typed while connecting are not pending yet, so that is no "saved".
      if (!unsaved.length && this.isSynced) this.resolveFlush(true);
    }

    updateIndicator() {
      const { page } = this.env;
      if (this.isOffline) return page.setIndicator(TEXT.offline);
      if (this.pending.length) {
        this.wasSaving = true;
        return page.setIndicator(TEXT.saving);
      }
      if (this.wasSaving) page.showSaved();
      this.wasSaving = false;
    }

    // Words typed before the first sync are not pending yet, but they are not
    // saved either, so leaving waits for the sync too.
    flush(waitMs = FLUSH_WAIT_MS) {
      const hasUnsyncedTyping = !this.isSynced && this.env.textarea.value !== this.base;
      if (!this.pending.length && !hasUnsyncedTyping) return Promise.resolve(true);
      this.sendOutbox();
      return new Promise(resolve => {
        this.flushWaiters.push(resolve);
        this.setTimer('flush', waitMs, () => this.resolveFlush(false));
      });
    }

    resolveFlush(isSaved) {
      this.clearTimer('flush');
      for (const resolve of this.flushWaiters.splice(0)) resolve(isSaved);
    }

    // ── The local copy ──

    schedulePersist() {
      if (this.timers.persist !== undefined) return;
      this.setTimer('persist', PERSIST_EVERY_MS, () => this.persistNow());
    }

    // The page writes its draft only once the copy is on disk, stamped with
    // the copy it matches, so a reload never finds a draft ahead of its copy.
    persistNow() {
      if (!this.isSynced || this.isClosed) return;
      this.clearTimer('persist');
      const record = this.copyRecord();
      const vector = this.deps.Y.encodeStateVector(this.working);
      const saved = {
        id: this.id, stamp: record.savedAt,
        text: this.working.getText(TEXT_FIELD).toString(),
        confirmed: this.confirmed.getText(TEXT_FIELD).toString(),
      };
      // While writes fail, the page goes back to writing its draft on input
      // (hasLocalCopy), so typing is never in neither place.
      this.env.store.save(record).then(() => {
        this.isCopyFailing = false;
        this.committedVector = vector;
        this.env.page.onLocalCopySaved(saved);
      }, () => {
        this.isCopyFailing = true;
      });
      return saved;
    }

    // Leaving (pagehide, hidden): the IndexedDB write may not finish before
    // the page goes. So the draft, written at once, also carries everything
    // since the last copy that landed, as a Yjs update; on top of that copy
    // or a newer one, applying it twice changes nothing.
    saveOnLeaving() {
      if (!this.isSynced || this.isClosed) return;
      const delta = this.deps.Y.encodeStateAsUpdate(this.working, this.committedVector || undefined);
      const saved = this.persistNow();
      this.env.page.onLeaving({ ...saved, delta: bytesToBase64(delta) });
    }

    // savedAt only grows within a tab, so two copies are never mistaken
    // for each other even within one millisecond.
    copyRecord() {
      const { Y } = this.deps;
      this.lastStamp = Math.max(this.env.now(), this.lastStamp + 1);
      return {
        id: this.id,
        epoch: this.epoch,
        savedAt: this.lastStamp,
        working: Y.encodeStateAsUpdate(this.working),
        confirmed: Y.encodeStateAsUpdate(this.confirmed),
        pending: this.pending.slice(),
      };
    }

    // ── Titles ──

    rename(title) {
      if (!this.isSynced) {
        this.pendingTitle = title;
        return;
      }
      this.pendingTitle = undefined;
      this.working.getMap(META_FIELD).set(TITLE_KEY, title);
    }

    applyRoomTitle() {
      const title = this.working.getMap(META_FIELD).get(TITLE_KEY);
      if (title !== undefined && title !== this.title && !this.env.page.isTitleFocused()) this.env.page.onTitle(title);
    }

    onMetaChange(event) {
      if (!this.isSynced || event.transaction.origin !== REMOTE_ORIGIN) return;
      const title = this.working.getMap(META_FIELD).get(TITLE_KEY);
      this.title = title;
      if (!this.env.page.isTitleFocused()) this.env.page.onTitle(title);
    }

    // ── Closing ──

    onClose(socket, code) {
      if (socket !== this.socket) return;
      this.socket = null;
      this.clearTimer('keepalive');
      this.clearTimer('pong');
      if (this.isClosed) return;
      this.presence.restart();
      const stop = this.stopFor(code);
      if (stop) return stop();
      this.setTimer('offline', OFFLINE_NOTICE_MS, () => {
        this.isOffline = true;
        this.updateIndicator();
      });
      this.scheduleReconnect();
    }

    // Codes after which reconnecting would not help.
    stopFor(code) {
      const { CLOSE } = this.deps.protocol;
      const { page } = this.env;
      const stops = {
        [CLOSE.OLD_PROTOCOL]: () => page.reload(),
        [CLOSE.UNSHARED]: () => page.onUnavailable({ hasUnsaved: this.pending.length > 0 }),
        [CLOSE.PAGE_DELETED]: () => page.onUnavailable({ hasUnsaved: this.pending.length > 0 }),
        [CLOSE.SIGNED_OUT]: () => {
          this.persistNow();
          page.onSessionExpired();
        },
        [CLOSE.ROOM_FULL]: () => this.goReadOnly(TEXT.roomFull),
        [CLOSE.TOO_MANY_TABS]: () => this.goReadOnly(TEXT.tooManyTabs),
      };
      return stops[code] || null;
    }

    goReadOnly(text) {
      this.isReadOnly = true;
      this.env.page.setReadOnly(true);
      this.env.page.notice(text);
    }

    // Jitter, so a deploy restart does not bring every client back at once.
    scheduleReconnect() {
      const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_FIRST_MS * 2 ** this.attempts);
      this.attempts += 1;
      // A page script cached from before this check has no such call.
      if (this.attempts % LIVE_CHECK_EVERY_ATTEMPTS === 0) this.env.page.checkStillLive?.();
      const delay = ceiling / 2 + (this.env.random() * ceiling) / 2;
      this.setTimer('reconnect', delay, () => this.connect());
    }

    reconnectNow() {
      if (this.isClosed || this.socket) return;
      this.clearTimer('reconnect');
      this.connect();
    }

    // iOS reports a socket it killed while the tab slept as still open, so
    // on becoming visible a ping must come back within 2 s (spec §3.2).
    checkAlive() {
      if (this.isClosed) return;
      if (!this.socket) return this.reconnectNow();
      if (!this.isOpen()) return;
      this.socket.send(PING);
      this.setTimer('pong', PONG_WAIT_MS, () => this.dropDeadSocket());
    }

    // A new socket may hang without opening or closing (iOS in airplane
    // mode), so the offline notice is timed from here too.
    dropDeadSocket() {
      this.closeSocketQuietly();
      this.connect();
      this.setTimer('offline', OFFLINE_NOTICE_MS, () => {
        this.isOffline = true;
        this.updateIndicator();
      });
    }

    closeSocketQuietly() {
      const dead = this.socket;
      this.socket = null;
      this.clearTimer('keepalive');
      this.clearTimer('pong');
      if (!dead) return;
      this.presence.restart();
      try {
        dead.close(NORMAL_CLOSE);
      } catch {
        // Already gone; its close event is ignored, since it is no longer this.socket.
      }
    }

    // The browser says the network is gone. The socket may not notice for a
    // long while, so it is dropped now; 'online' reconnects, and the backoff
    // keeps trying meanwhile.
    noteOffline() {
      if (this.isClosed) return;
      this.isOffline = true;
      this.updateIndicator();
      this.closeSocketQuietly();
      this.scheduleReconnect();
    }

    // Answered by the room's auto-response, which does not wake it. No
    // answer means the socket died without a close event.
    startKeepalive() {
      this.setTimer('keepalive', KEEPALIVE_MS, () => {
        if (this.isOpen()) {
          this.socket.send(PING);
          this.setTimer('pong', PONG_WAIT_MS, () => this.dropDeadSocket());
        }
        this.startKeepalive();
      });
    }

    close() {
      this.isClosed = true;
      for (const name of Object.keys(this.timers)) this.clearTimer(name);
      this.resolveFlush(this.pending.length === 0);
      if (this.isReadOnly) this.env.page.setReadOnly(false);
      this.binding?.destroy();
      this.unwatchSelection();
      this.presence.destroy();
      if (this.socket) this.socket.close(NORMAL_CLOSE);
      this.socket = null;
      this.working.destroy();
      this.confirmed.destroy();
    }
  }

  class LiveSession {
    constructor(env) {
      this.env = env;
      this.connection = null;
      this.wanted = null;
      this.token = 0;
      this.opening = Promise.resolve();
      this.keptCopyId = null;
    }

    follow(lyric) {
      if (lyric && lyric.live) return this.open(lyric);
      this.close();
      return Promise.resolve();
    }

    // Live from this moment, so REST saves stand aside even while the
    // bundle loads; anything typed meanwhile is rebased at the first sync.
    // Each open gets a token, so a slow load for an earlier open can never
    // attach a second connection to the editor. A reload passes `restore`
    // and resumes from the page's copy.
    open({ id, body, title, restore = null }) {
      if (this.isLiveFor(id)) return this.opening;
      this.close({ keepCopy: Boolean(restore) });
      const token = this.token;
      this.wanted = { id, body, title, restore };
      this.opening = this.start(token);
      return this.opening;
    }

    async start(token) {
      let deps;
      try {
        deps = await this.env.loadDeps();
      } catch {
        return this.retryStart(token);
      }
      if (token !== this.token) return;
      const record = await this.takeCopy(this.wanted);
      if (token !== this.token) return;
      this.connection = new PageConnection(this.env, deps, this.wanted, isUsableCopy(record) ? record : null);
      if (this.pendingTitle !== undefined) this.connection.rename(this.pendingTitle);
      this.pendingTitle = undefined;
      this.connection.connect();
    }

    // A reload resumes from the page's copy. Any other open starts clean, so
    // a copy left from an earlier visit can never be mistaken for this one's.
    async takeCopy({ id, restore }) {
      try {
        if (restore) return await this.env.store.load(id);
        await this.env.store.remove(id);
      } catch {
        // Storage that fails leaves the page to open without a copy.
      }
      return null;
    }

    // The bundle did not load (offline, most likely). The page stays live,
    // so REST saves stand aside, and what is typed is rebased once it loads.
    retryStart(token) {
      if (token !== this.token) return;
      this.env.page.setIndicator(TEXT.offline);
      this.retryTimer = this.env.setTimeout(() => {
        this.retryTimer = null;
        if (token === this.token) this.opening = this.start(token);
      }, DEPS_RETRY_MS);
    }

    // Closing a page removes its copy. A signed-out close keeps it, so
    // signing back in (or a reload) picks the words up again; the next
    // ordinary close removes it.
    close({ keepCopy = false } = {}) {
      const id = this.wanted ? this.wanted.id : this.keptCopyId;
      this.token += 1;
      this.wanted = null;
      this.pendingTitle = undefined;
      if (this.retryTimer) this.env.clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.connection?.close();
      this.connection = null;
      this.keptCopyId = keepCopy ? id : null;
      if (id && !keepCopy) this.forgetCopy(id);
    }

    forgetCopy(id) {
      this.env.store.remove(id).catch(() => {
        // A copy that stays is cleared at sign-out, and a fresh open drops it.
      });
    }

    isLive() {
      return this.wanted !== null;
    }

    isLiveFor(id) {
      return this.wanted !== null && this.wanted.id === id;
    }

    // While synced, the page's draft is written with the copy, not on input.
    hasLocalCopy() {
      const { connection } = this;
      return Boolean(connection && connection.isSynced && !connection.isClosed && !connection.isCopyFailing);
    }

    saveLocalCopy() {
      this.connection?.persistNow();
    }

    saveOnLeaving() {
      this.connection?.saveOnLeaving();
    }

    // Signing out and deleting the account leave no words on the device.
    async forgetAllCopies() {
      this.keptCopyId = null;
      try {
        await this.env.store.clear();
      } catch {
        // Nothing more can be done; the draft is removed all the same.
      }
    }

    // Whether a page's copy holds words its room never saved: updates still
    // pending, or a screen that differs from the copy. Not knowing counts as
    // yes, so words are never dropped.
    async hasUnsavedWords(id, screenText) {
      try {
        const [deps, record] = await Promise.all([this.env.loadDeps(), this.env.store.load(id)]);
        if (!isUsableCopy(record)) return true;
        return record.pending.length > 0 || textOfUpdate(deps.Y, record.working) !== screenText;
      } catch {
        return true;
      }
    }

    // Before a connection exists, words typed since opening cannot be saved
    // yet, so leaving is refused rather than dropping them.
    flush(waitMs) {
      if (this.connection) return this.connection.flush(waitMs);
      if (!this.wanted) return Promise.resolve(true);
      return Promise.resolve(this.env.textarea.value === this.wanted.body);
    }

    // A rename while the bundle still loads waits for the connection.
    rename(title) {
      if (this.connection) this.connection.rename(title);
      else if (this.wanted !== null) this.pendingTitle = title;
    }

    checkAlive() {
      this.connection?.checkAlive();
    }

    presenceHidden() {
      this.connection?.presenceHidden();
    }

    presenceShown() {
      this.connection?.presenceShown();
    }

    reconnectNow() {
      this.connection?.reconnectNow();
    }

    noteOffline() {
      this.connection?.noteOffline();
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  // Loaded only when a live page opens, so solo writers download nothing more.
  function loadDeps() {
    if (root.LiveDeps) return Promise.resolve(root.LiveDeps);
    return loadScript(LIVE_DEPS_SRC).then(() => root.LiveDeps);
  }

  // Made once per page. A tab whose view script did not load draws nothing
  // and still edits.
  function presencePainter() {
    const painter = root.LivePresenceView ? root.LivePresenceView.createPainter(document) : null;
    return view => {
      if (painter) painter.show(view);
    };
  }

  function browserEnv() {
    const textarea = document.getElementById('lyrics');
    const scroller = document.querySelector('.lyrics-area');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return {
      textarea, loadDeps, liveCore: root.LiveCore, createTextBinding: root.LiveBinding.createTextBinding,
      store: root.LiveStore.createLiveStore(root),
      openSocket: path => new WebSocket(`${scheme}://${location.host}${path}`),
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: id => clearTimeout(id),
      random: () => Math.random(),
      schedule: frame => requestAnimationFrame(frame),
      isFocused: () => document.activeElement === textarea,
      adjustScroll: px => { if (scroller) scroller.scrollTop += px; },
      get page() { return root.livePage; },
      livePresence: root.LivePresence,
      me: () => root.currentUser || null,
      showPresence: presencePainter(),
    };
  }

  function startInBrowser() {
    const session = new LiveSession(browserEnv());
    root.liveSession = session;
    document.addEventListener('visibilitychange', () => {
      // A phone can drop a hidden tab without a pagehide, so the copy is
      // written on the way out too.
      if (document.hidden) {
        session.saveOnLeaving();
        session.presenceHidden();
      } else {
        session.checkAlive();
        session.presenceShown();
      }
    });
    window.addEventListener('pagehide', () => session.saveOnLeaving());
    window.addEventListener('online', () => session.reconnectNow());
    window.addEventListener('offline', () => session.noteOffline());
  }

  const isBrowser = typeof document !== 'undefined' && Boolean(document.getElementById('lyrics'));
  if (isBrowser) startInBrowser();

  const Live = { LIVE_DEPS_SRC, TEXT, LiveSession, PageConnection };

  if (typeof module === 'object' && module.exports) {
    module.exports = Live;
  } else {
    root.Live = Live;
  }
})(this);
