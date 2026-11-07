// The iOS privacy manifest says the app does no tracking. That has to hold
// whatever the GA property's settings are, so analytics.js turns Google
// Signals and ad personalisation off itself. analytics.js needs a browser, so
// it runs here against a small fake.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const ANALYTICS_SOURCE = readFileSync(new URL('../analytics.js', import.meta.url), 'utf8');
const PAGE_URL = 'https://lyriclike.com/';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function runAnalytics() {
  const window = {
    location: new URL(PAGE_URL),
    addEventListener() {},
  };
  const document = {
    createElement: () => ({}),
    head: { appendChild() {} },
  };
  const context = { window, document, localStorage: fakeStorage(), console, URLSearchParams };
  vm.runInNewContext(ANALYTICS_SOURCE, context);
  return window;
}

function findConfigCall(window) {
  const call = window.dataLayer.find(entry => entry[0] === 'config');
  assert.ok(call, 'analytics.js sends a config call');
  return call[2];
}

describe('analytics.js config', () => {
  it('turns Google Signals off', () => {
    const config = findConfigCall(runAnalytics());
    assert.equal(config.allow_google_signals, false);
  });

  it('turns ad personalisation signals off', () => {
    const config = findConfigCall(runAnalytics());
    assert.equal(config.allow_ad_personalization_signals, false);
  });
});
