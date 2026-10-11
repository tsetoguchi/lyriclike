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
  const NORMAL_CLOSE = 1000;
  const PING = 'ping';
  const PONG = 'pong';
  // How long to wait before trying the bundle again when it failed to load.
  const DEPS_RETRY_MS = 5000;

  const TEXT = Object.freeze({
    saving: 'Saving...',
    offline: 'Offline — changes will sync',
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
      this.startKeepalive();
      this.clearTimer('offline');
      this.isOffline = false;
      this.updateIndicator();
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
      if (this.isSynced) {
        this.binding.queueRemote(message.payload);
        // A co-writer re-sends anything the room loses, so their words count
        // as confirmed now; a reload must not merge them in a second time.
        this.reportConfirmed();
        return;
      }
      Y.applyUpdate(this.working, message.payload, REMOTE_ORIGIN);
      if (message.syncType === protocol.SYNC.STEP2) this.finishSync();
    }

    // The editor stayed usable while connecting; whatever was typed since the
    // page loaded is rebased three ways onto the room's text.
    finishSync() {
      const { textarea } = this.env;
      const roomText = this.working.getText(TEXT_FIELD).toString();
      const local = textarea.value;
      const selection = { start: textarea.selectionStart, end: textarea.selectionEnd };
      // Matching the room already means everything typed reached it; a
      // rebase would only insert those words a second time.
      const merged = local === this.base || local === roomText
        ? roomText
        : this.env.liveCore.rebase(this.deps.Y, this.dmp, this.base, local, roomText);
      textarea.value = roomText;
      this.binding = this.createBinding();
      this.isSynced = true;
      this.attempts = 0;
      if (merged !== roomText) this.binding.applyLocalText(merged);
      else textarea.dispatchEvent(new Event('input'));
      this.keepSelection(selection, local, merged);
      this.applyRoomTitle();
      if (this.pendingTitle !== undefined) this.rename(this.pendingTitle);
      this.reportConfirmed();
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

    // The page keeps the room-confirmed text with its draft, so a reload can
    // rebase what is on screen onto the room without repeating saved words.
    reportConfirmed() {
      const { page } = this.env;
      if (page.onConfirmed) page.onConfirmed(this.confirmed.getText(TEXT_FIELD).toString());
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
      this.reportConfirmed();
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

    // Words typed before the first sync are not pending yet, but they are not
    // saved either, so leaving waits for the sync too.
    flush() {
      const hasUnsyncedTyping = !this.isSynced && this.env.textarea.value !== this.base;
      if (!this.pending.length && !hasUnsyncedTyping) return Promise.resolve(true);
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

    onClose(socket, code) {
      if (socket !== this.socket) return;
      this.socket = null;
      this.clearTimer('keepalive');
      this.clearTimer('pong');
      if (this.isClosed) return;
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
        [CLOSE.SIGNED_OUT]: () => page.onSessionExpired(),
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

    dropDeadSocket() {
      const dead = this.socket;
      this.socket = null;
      this.clearTimer('keepalive');
      try {
        dead.close(NORMAL_CLOSE);
      } catch {
        // Already gone; its close event is ignored, since it is no longer this.socket.
      }
      this.connect();
    }

    // Answered by the room's auto-response, which does not wake it.
    startKeepalive() {
      this.setTimer('keepalive', KEEPALIVE_MS, () => {
        if (this.isOpen()) this.socket.send(PING);
        this.startKeepalive();
      });
    }

    close() {
      this.isClosed = true;
      for (const name of Object.keys(this.timers)) this.clearTimer(name);
      this.resolveFlush(this.pending.length === 0);
      if (this.isReadOnly) this.env.page.setReadOnly(false);
      this.binding?.destroy();
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
    }

    follow(lyric) {
      if (lyric && lyric.live) return this.open(lyric);
      this.close();
      return Promise.resolve();
    }

    // Live from this moment, so REST saves stand aside even while the
    // bundle loads; anything typed meanwhile is rebased at the first sync.
    // Each open gets a token, so a slow load for an earlier open can never
    // attach a second connection to the editor.
    open({ id, body, title }) {
      if (this.isLiveFor(id)) return this.opening;
      this.close();
      const token = this.token;
      this.wanted = { id, body, title };
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
      this.connection = new PageConnection(this.env, deps, this.wanted);
      if (this.pendingTitle !== undefined) this.connection.rename(this.pendingTitle);
      this.pendingTitle = undefined;
      this.connection.connect();
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

    close() {
      this.token += 1;
      this.wanted = null;
      this.pendingTitle = undefined;
      if (this.retryTimer) this.env.clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.connection?.close();
      this.connection = null;
    }

    isLive() {
      return this.wanted !== null;
    }

    isLiveFor(id) {
      return this.wanted !== null && this.wanted.id === id;
    }

    // Before a connection exists, words typed since opening cannot be saved
    // yet, so leaving is refused rather than dropping them.
    flush() {
      if (this.connection) return this.connection.flush();
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

    reconnectNow() {
      this.connection?.reconnectNow();
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

  function browserEnv() {
    const textarea = document.getElementById('lyrics');
    const scroller = document.querySelector('.lyrics-area');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return {
      textarea, loadDeps, liveCore: root.LiveCore, createTextBinding: root.LiveBinding.createTextBinding,
      openSocket: path => new WebSocket(`${scheme}://${location.host}${path}`),
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: id => clearTimeout(id),
      random: () => Math.random(),
      schedule: frame => requestAnimationFrame(frame),
      isFocused: () => document.activeElement === textarea,
      adjustScroll: px => { if (scroller) scroller.scrollTop += px; },
      get page() { return root.livePage; },
    };
  }

  function startInBrowser() {
    const session = new LiveSession(browserEnv());
    root.liveSession = session;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) session.checkAlive();
    });
    window.addEventListener('online', () => session.reconnectNow());
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
