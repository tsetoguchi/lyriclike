// Sends the app's analytics through the site's own server. Google's tag sends
// nothing from inside the iPhone app, whose pages load from
// capacitor://localhost, so the app queues its events and posts them to
// /api/collect, which hands them to Google. On the website this does nothing:
// analytics.js only uses it when NativeShell says the page is in the app.
(function defineAnalyticsRelay(root) {
  'use strict';

  const COLLECT_PATH = '/api/collect';
  const CLIENT_ID_KEY = 'analytics_client_id';
  const SESSION_KEY = 'analytics_session';
  // Google's own rule: half an hour without an event starts a new session.
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  // Batches events, so a busy minute is a few requests, not dozens.
  const SEND_DELAY_MS = 10 * 1000;
  // The most events Google takes in one request.
  const MAX_EVENTS_PER_SEND = 25;
  // Time on the page between two events counts as engaged only up to this, so
  // an app left open in a pocket doesn't read as an hour of writing.
  const MAX_ENGAGEMENT_MS = 60 * 1000;
  const MIN_ENGAGEMENT_MS = 1;
  const MS_PER_SECOND = 1000;
  const RANDOM_ID_MAX = 2147483647;
  // The app has one page; this names it apart from the website's pages.
  const APP_PAGE_LOCATION = 'https://lyriclike.com/app';
  const PAGE_VIEW_EVENT = 'page_view';
  const INTERNAL_TRAFFIC = 'internal';

  // Storage that fails keeps working in memory for this launch.
  function createStore(storage) {
    const memory = new Map();
    return {
      get(key) {
        try {
          return storage.getItem(key);
        } catch {
          return memory.has(key) ? memory.get(key) : null;
        }
      },
      set(key, value) {
        try {
          storage.setItem(key, value);
        } catch {
          memory.set(key, value);
        }
      },
    };
  }

  function randomWholeNumber(cryptoApi) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0] % RANDOM_ID_MAX;
  }

  // Google's own client id shape: a random number, a dot, the first second.
  function readClientId(store, cryptoApi, now) {
    const saved = store.get(CLIENT_ID_KEY);
    if (saved) return saved;
    const clientId = `${randomWholeNumber(cryptoApi)}.${Math.floor(now / MS_PER_SECOND)}`;
    store.set(CLIENT_ID_KEY, clientId);
    return clientId;
  }

  function readSession(store) {
    try {
      const session = JSON.parse(store.get(SESSION_KEY));
      if (session && typeof session.id === 'number' && typeof session.lastAt === 'number') {
        return session;
      }
    } catch {}
    return null;
  }

  // The session this event belongs to, starting a new one after a long gap.
  function touchSession(store, now) {
    const saved = readSession(store);
    const isFresh = saved && now - saved.lastAt < SESSION_IDLE_MS;
    const session = { id: isFresh ? saved.id : Math.floor(now / MS_PER_SECOND), lastAt: now };
    store.set(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function engagementSince(lastEventAt, now) {
    const elapsed = now - lastEventAt;
    return Math.min(Math.max(elapsed, MIN_ENGAGEMENT_MS), MAX_ENGAGEMENT_MS);
  }

  function createRelay({ storage, cryptoApi, fetchApi, timers, platform, isInternal, now }) {
    const store = createStore(storage);
    const clientId = readClientId(store, cryptoApi, now());
    const queue = [];
    let signedIn = null;
    let lastEventAt = now();
    let sendTimer = null;

    function buildParams(params, at) {
      const extra = {
        session_id: touchSession(store, at).id,
        engagement_time_msec: engagementSince(lastEventAt, at),
      };
      if (isInternal) extra.traffic_type = INTERNAL_TRAFFIC;
      return { ...(params || {}), ...extra };
    }

    function buildBody(events) {
      const body = { client_id: clientId, platform, events };
      if (signedIn !== null) body.signed_in = signedIn;
      return body;
    }

    function sendBatch(events) {
      return fetchApi(COLLECT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(events)),
        keepalive: true,
      }).catch(error => console.warn('Analytics could not be sent:', error));
    }

    function sendQueued() {
      if (sendTimer !== null) timers.clearTimeout(sendTimer);
      sendTimer = null;
      while (queue.length > 0) sendBatch(queue.splice(0, MAX_EVENTS_PER_SEND));
    }

    function scheduleSend() {
      if (sendTimer === null) sendTimer = timers.setTimeout(sendQueued, SEND_DELAY_MS);
    }

    function track(name, params) {
      const at = now();
      queue.push({ name, params: buildParams(params, at) });
      lastEventAt = at;
      scheduleSend();
    }

    function setSignedIn(isSignedIn) {
      signedIn = isSignedIn ? 'yes' : 'no';
    }

    function trackPageView(title) {
      track(PAGE_VIEW_EVENT, { page_location: APP_PAGE_LOCATION, page_title: title });
    }

    return { track, setSignedIn, trackPageView, sendQueued, clientId };
  }

  // Wires the relay to the page: one page view now, and whatever is queued
  // goes out as the app leaves the screen.
  function start({ isInternal }) {
    const relay = createRelay({
      storage: root.localStorage,
      cryptoApi: root.crypto,
      fetchApi: (url, init) => root.fetch(url, init),
      timers: { setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root) },
      platform: root.NativeShell.platform,
      isInternal,
      now: () => Date.now(),
    });
    relay.trackPageView(root.document.title);
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState === 'hidden') relay.sendQueued();
    });
    return relay;
  }

  root.AnalyticsRelay = { createRelay, start };
})(typeof window !== 'undefined' ? window : globalThis);
