// hub-gate.js decides, before the page is drawn, whether a phone visit opens
// on the start screen: only a fresh open, after the splash, once the tour is
// done, and never when a link names somewhere to go.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const {
  FRESH_OPEN_GAP_MS,
  TAB_MARK_KEY,
  LAST_ACTIVE_KEY,
  hasLinkDestination,
  shouldShowHub,
} = require('../hub-gate.js');

const SOURCE = readFileSync(new URL('../hub-gate.js', import.meta.url), 'utf8');
const HEAD = readFileSync(new URL('../index.html', import.meta.url), 'utf8').split('</head>')[0];
const HEAD_SCRIPTS = [...HEAD.matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(match => match[1]);
const HUB_CLASS = 'is-hub';
const NOW_MS = 1e12;
const MINUTE_MS = 60 * 1000;

const BASE = {
  isPhone: true,
  isSplashing: true,
  isTourSeen: true,
  hasDestination: false,
  hasTabMark: false,
  lastActiveMs: null,
  nowMs: NOW_MS,
};

const NO_PENDING = { pendingShared: null, pendingInvite: null };

function makeStorage(entries = {}) {
  const items = new Map(Object.entries(entries));
  return {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    items,
  };
}

function throwingStorage() {
  const refuse = () => { throw new Error('storage blocked'); };
  return { getItem: refuse, setItem: refuse };
}

// Just enough of a page for the gate: the root element's classes, the phone
// query, the two storages and the address.
function runGate({ localStorage, sessionStorage, href = 'https://lyriclike.com/' }) {
  const classes = new Set(['is-splashing']);
  const classList = {
    add: name => classes.add(name),
    contains: name => classes.has(name),
  };
  const context = vm.createContext({
    document: { documentElement: { classList }, visibilityState: 'visible', addEventListener() {} },
    location: { href },
    matchMedia: () => ({ matches: true }),
    addEventListener() {},
    localStorage,
    sessionStorage,
    Date,
    URL,
    URLSearchParams,
  });
  context.globalThis = context;
  vm.runInContext(SOURCE, context);
  return classes;
}

describe('shouldShowHub', () => {
  it('shows on a fresh tab', () => {
    assert.equal(shouldShowHub(BASE), true);
  });

  it('skips a reload in the same tab', () => {
    const reload = { ...BASE, hasTabMark: true, lastActiveMs: NOW_MS - MINUTE_MS };
    assert.equal(shouldShowHub(reload), false);
  });

  it('shows after 6 hours away in the same tab', () => {
    assert.equal(FRESH_OPEN_GAP_MS, 6 * 60 * MINUTE_MS);
    const overnight = { ...BASE, hasTabMark: true, lastActiveMs: NOW_MS - FRESH_OPEN_GAP_MS };
    assert.equal(shouldShowHub(overnight), true);
  });

  it('skips a same-tab load with no last-active time', () => {
    assert.equal(shouldShowHub({ ...BASE, hasTabMark: true, lastActiveMs: null }), false);
  });

  for (const key of ['isPhone', 'isSplashing', 'isTourSeen']) {
    it(`skips without ${key}`, () => {
      assert.equal(shouldShowHub({ ...BASE, [key]: false }), false);
    });
  }

  it('skips with a destination', () => {
    assert.equal(shouldShowHub({ ...BASE, hasDestination: true }), false);
  });
});

describe('hasLinkDestination', () => {
  const LINKS = [
    'https://lyriclike.com/#shared=abc',
    'https://lyriclike.com/?word=love',
    'https://lyriclike.com/?invite=K2',
    'https://lyriclike.com/#signup_token=t',
    'https://lyriclike.com/#reset_token=t',
  ];

  for (const href of LINKS) {
    it(`finds a destination in ${href}`, () => {
      assert.equal(hasLinkDestination(href, NO_PENDING), true);
    });
  }

  it('finds a pending share', () => {
    const pending = { ...NO_PENDING, pendingShared: '{}' };
    assert.equal(hasLinkDestination('https://lyriclike.com/', pending), true);
  });

  it('finds a pending invite', () => {
    const pending = { ...NO_PENDING, pendingInvite: '{}' };
    assert.equal(hasLinkDestination('https://lyriclike.com/', pending), true);
  });

  it('finds none on the bare app', () => {
    assert.equal(hasLinkDestination('https://lyriclike.com/', NO_PENDING), false);
  });
});

describe('hub-gate.js on the page', () => {
  it('loads in the head between splash.js and auth-link.js', () => {
    const gate = HEAD_SCRIPTS.indexOf('hub-gate.js');
    assert.ok(gate > HEAD_SCRIPTS.indexOf('splash.js'), 'after splash.js');
    assert.ok(gate < HEAD_SCRIPTS.indexOf('auth-link.js'), 'before auth-link.js');
  });

  it('opens on the hub in a fresh tab and marks the tab', () => {
    const sessionStorage = makeStorage();
    const classes = runGate({ localStorage: makeStorage({ tour_seen: '1' }), sessionStorage });
    assert.equal(classes.has(HUB_CLASS), true);
    assert.notEqual(sessionStorage.items.get(TAB_MARK_KEY), undefined);
  });

  it('skips when storage throws', () => {
    const classes = runGate({ localStorage: throwingStorage(), sessionStorage: throwingStorage() });
    assert.equal(classes.has(HUB_CLASS), false);
  });

  it('names its own storage keys', () => {
    assert.equal(TAB_MARK_KEY, 'hub_tab_seen');
    assert.equal(LAST_ACTIVE_KEY, 'hub_last_active');
  });
});
