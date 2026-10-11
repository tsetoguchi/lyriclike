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

  const TEXT = Object.freeze({
    saving: 'Saving...',
    offline: 'Offline — changes will sync',
    tooLong: 'This page is at its length limit.',
    roomFull: 'Too many people are on this page right now. It is read-only for you.',
    tooManyTabs: 'This page is open in too many of your tabs. It is read-only here.',
  });

  class PageConnection {
    constructor(env, deps, { id, body, title }) {
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
      this.makeDocs();
    }

    makeDocs() {
      const { Y } = this.deps;
      this.working = new Y.Doc();
      this.confirmed = new Y.Doc();
      this.working.on('update', (update, origin) => this.onWorkingUpdate(update, origin));
      this.working.getMap(META_FIELD).observe(event => this.onMetaChange(event));
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
      this.clearTimer('offline');
      this.isOffline = false;
      this.updateIndicator();
    }

    onMessage(socket, data) {
      if (socket !== this.socket || typeof data === 'string') return;
      const message = this.deps.protocol.readRoomMessage(new Uint8Array(data));
      if (message.kind === 'hello') this.onHello(message);
      else if (message.kind === 'persisted') this.onPersisted(message.snapshot);
      else if (message.kind === 'sync') this.onSync(socket, message);
    }

    // A new epoch means the room emptied and re-seeded from D1 while this tab
    // was away: its doc shares no history with ours, so start over from what
    // the room confirmed and rebase what is on screen onto the room's text.
    onHello(hello) {
      if (this.epoch && hello.epoch !== this.epoch) this.restartFromRoom();
      this.epoch = hello.epoch;
    }

    restartFromRoom() {
      if (this.isSynced) this.base = this.confirmed.getText(TEXT_FIELD).toString();
      this.binding?.destroy();
      this.binding = null;
      this.working.destroy();
      this.confirmed.destroy();
      this.pending = [];
      this.isSynced = false;
      this.makeDocs();
    }

    onSync(socket, message) {
      const { protocol, Y } = this.deps;
      if (message.syncType === protocol.SYNC.STEP1) {
        socket.send(protocol.encodeSyncStep2(this.working, message.payload));
        return;
      }
      Y.applyUpdate(this.confirmed, message.payload, REMOTE_ORIGIN);
      if (this.isSynced) return this.binding.queueRemote(message.payload);
      Y.applyUpdate(this.working, message.payload, REMOTE_ORIGIN);
      if (message.syncType === protocol.SYNC.STEP2) this.finishSync();
    }

    // The editor stayed usable while connecting; whatever was typed since the
    // page loaded is rebased three ways onto the room's text.
    finishSync() {
      const { textarea } = this.env;
      const roomText = this.working.getText(TEXT_FIELD).toString();
      const local = textarea.value;
      const merged = local === this.base
        ? roomText
        : this.env.liveCore.rebase(this.deps.Y, this.dmp, this.base, local, roomText);
      textarea.value = roomText;
      this.binding = this.createBinding();
      this.isSynced = true;
      this.attempts = 0;
      if (merged !== roomText) this.binding.applyLocalText(merged);
      else textarea.dispatchEvent(new Event('input'));
      this.applyRoomTitle();
      if (this.pendingTitle !== undefined) this.rename(this.pendingTitle);
      this.updateIndicator();
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

    onWorkingUpdate(update, origin) {
      if (origin === REMOTE_ORIGIN || !this.isSynced) return;
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
      this.updateIndicator();
      if (!unsaved.length) this.resolveFlush(true);
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

    flush() {
      if (!this.pending.length) return Promise.resolve(true);
      this.sendOutbox();
      return new Promise(resolve => {
        this.flushWaiters.push(resolve);
        this.setTimer('flush', FLUSH_WAIT_MS, () => this.resolveFlush(false));
      });
    }

    resolveFlush(isSaved) {
      this.clearTimer('flush');
      for (const resolve of this.flushWaiters.splice(0)) resolve(isSaved);
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

    onClose(socket) {
      if (socket !== this.socket) return;
      this.socket = null;
    }

    close() {
      this.isClosed = true;
      for (const name of Object.keys(this.timers)) this.clearTimer(name);
      this.resolveFlush(this.pending.length === 0);
      this.binding?.destroy();
      if (this.socket) this.socket.close(1000);
      this.socket = null;
      this.working.destroy();
      this.confirmed.destroy();
    }
  }

  class LiveSession {
    constructor(env) {
      this.env = env;
      this.connection = null;
      this.wantedId = null;
    }

    follow(lyric) {
      if (lyric && lyric.live) return this.open(lyric);
      this.close();
      return Promise.resolve();
    }

    // Live from this moment, so REST saves stand aside even while the
    // bundle loads; anything typed meanwhile is rebased at the first sync.
    async open({ id, body, title }) {
      if (this.wantedId === id) return;
      this.close();
      this.wantedId = id;
      const deps = await this.env.loadDeps();
      if (this.wantedId !== id) return;
      this.connection = new PageConnection(this.env, deps, { id, body, title });
      if (this.pendingTitle !== undefined) this.connection.rename(this.pendingTitle);
      this.pendingTitle = undefined;
      this.connection.connect();
    }

    close() {
      this.wantedId = null;
      this.pendingTitle = undefined;
      this.connection?.close();
      this.connection = null;
    }

    isLive() {
      return this.wantedId !== null;
    }

    flush() {
      return this.connection ? this.connection.flush() : Promise.resolve(true);
    }

    // A rename while the bundle still loads waits for the connection.
    rename(title) {
      if (this.connection) this.connection.rename(title);
      else if (this.wantedId !== null) this.pendingTitle = title;
    }

    checkAlive() {
      this.connection?.checkAlive();
    }

    reconnectNow() {
      this.connection?.reconnectNow();
    }
  }

  const Live = { LIVE_DEPS_SRC, TEXT, LiveSession, PageConnection };

  if (typeof module === 'object' && module.exports) {
    module.exports = Live;
  } else {
    root.Live = Live;
  }
})(this);
