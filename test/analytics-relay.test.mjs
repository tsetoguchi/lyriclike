// Inside the app, Google's tag sends nothing, so analytics.js hands events to
// analytics-relay.js, which batches them to /api/collect. Both need a browser,
// so they run here against a small fake.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const RELAY_SOURCE = readFileSync(new URL('../analytics-relay.js', import.meta.url), 'utf8');
const ANALYTICS_SOURCE = readFileSync(new URL('../analytics.js', import.meta.url), 'utf8');
const SEND_DELAY_MS = 10 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;

function fakeStorage() {
  const values = new Map();
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

// A page with a clock and timers that only move when the test says so.
function fakePage({ isNative = true, url = 'capacitor://localhost/' } = {}) {
  const clock = { now: 1764000000000 };
  const timers = [];
  const posts = [];
  const listeners = {};
  const appended = [];
  const document = {
    title: 'LyricLike',
    visibilityState: 'visible',
    head: { appendChild: node => appended.push(node) },
    createElement: () => ({}),
    addEventListener: (type, handler) => { listeners[type] = handler; },
  };
  const window = {
    location: new URL(url),
    document,
    localStorage: fakeStorage(),
    crypto: webcrypto,
    NativeShell: { isNative, platform: isNative ? 'ios' : 'web' },
    addEventListener() {},
    fetch: async (path, init) => {
      posts.push({ path, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    },
    setTimeout: (callback, delay) => {
      timers.push({ callback, at: clock.now + delay });
      return timers.length;
    },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].callback = null; },
  };
  const context = {
    window, document, localStorage: window.localStorage, console, URLSearchParams,
    Date: class extends Date {
      static now() { return clock.now; }
    },
  };
  vm.createContext(context);
  vm.runInContext(RELAY_SOURCE, context);
  vm.runInContext(ANALYTICS_SOURCE, context);

  function advance(ms) {
    clock.now += ms;
    for (const timer of timers) {
      if (timer.callback && timer.at <= clock.now) {
        const run = timer.callback;
        timer.callback = null;
        run();
      }
    }
  }
  function hide() {
    document.visibilityState = 'hidden';
    listeners.visibilitychange();
  }
  return { window, posts, appended, advance, hide, clock };
}

function sentEvents(posts) {
  return posts.flatMap(post => post.body.events);
}

describe('analytics in the app', () => {
  it('never loads Google\'s tag', () => {
    const page = fakePage();
    assert.equal(page.appended.length, 0);
    assert.equal(page.window.gtag, undefined);
  });

  it('sends a page view and later events to /api/collect in one batch', () => {
    const page = fakePage();
    page.advance(2000);
    page.window.trackEvent('rhyme_lookup', { trigger: 'tap' });
    assert.equal(page.posts.length, 0, 'waits to batch');
    page.advance(SEND_DELAY_MS);
    assert.equal(page.posts.length, 1);
    const [post] = page.posts;
    assert.equal(post.path, '/api/collect');
    assert.equal(post.body.platform, 'ios');
    assert.match(post.body.client_id, /^\d+\.\d+$/);
    const [view, lookup] = post.body.events;
    assert.equal(view.name, 'page_view');
    assert.equal(view.params.page_location, 'https://lyriclike.com/app');
    assert.equal(lookup.name, 'rhyme_lookup');
    assert.equal(lookup.params.trigger, 'tap');
    assert.equal(lookup.params.engagement_time_msec, 2000);
    assert.equal(lookup.params.session_id, view.params.session_id);
  });

  it('sends what is queued as soon as the app leaves the screen', () => {
    const page = fakePage();
    page.hide();
    assert.equal(sentEvents(page.posts).length, 1);
  });

  it('starts a new session after half an hour without events', () => {
    const page = fakePage();
    page.window.trackEvent('first');
    page.advance(SESSION_IDLE_MS + 1);
    page.window.trackEvent('second');
    page.advance(SEND_DELAY_MS);
    const [, first, second] = sentEvents(page.posts);
    assert.notEqual(first.params.session_id, second.params.session_id);
    assert.equal(second.params.engagement_time_msec, 60000, 'idle time is capped');
  });

  it('carries the sign-in flag and the owner\'s internal mark', () => {
    const page = fakePage({ url: 'capacitor://localhost/?internal=1' });
    page.window.setSignedInProperty(true);
    page.hide();
    assert.equal(page.posts[0].body.signed_in, 'yes');
    assert.equal(page.posts[0].body.events[0].params.traffic_type, 'internal');
  });

  it('keeps one client id across launches', () => {
    const page = fakePage();
    const relay = page.window.AnalyticsRelay.createRelay({
      storage: page.window.localStorage, cryptoApi: webcrypto, fetchApi: page.window.fetch,
      timers: page.window, platform: 'ios', isInternal: false, now: () => page.clock.now,
    });
    page.hide();
    assert.equal(relay.clientId, page.posts[0].body.client_id);
  });

  it('splits more than 25 events into several sends', () => {
    const page = fakePage();
    for (let i = 0; i < 30; i += 1) page.window.trackEvent('e' + i);
    page.hide();
    assert.equal(page.posts.length, 2);
    assert.equal(page.posts[0].body.events.length, 25);
  });
});

describe('analytics on the website', () => {
  it('still uses Google\'s tag', () => {
    const page = fakePage({ isNative: false, url: 'https://lyriclike.com/' });
    assert.equal(page.appended.length, 1);
    assert.equal(typeof page.window.gtag, 'function');
    assert.equal(page.posts.length, 0);
  });
});
