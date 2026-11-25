// "Check your email" offers an "Open mail app" button on phones: Apple Mail on
// iPhone and iPad (site and app), the default mail app in Android browsers.
// Computers and the Android app (a webview that can't open intent: links)
// don't show it, and neither does any other view.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../auth-forms.js', import.meta.url), 'utf8');
const BUTTON_ID = 'auth-open-mail';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0';

class FakeElement {
  constructor() {
    this.hidden = true;
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.offsetParent = null;
    this.attributes = {};
    this.classList = { add() {}, remove() {}, contains: () => false };
  }

  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute() {}
  appendChild() {}
  focus() {}
  contains() { return false; }
  querySelectorAll() { return []; }
}

function fakeDocument() {
  const elements = new Map();
  return {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    querySelector: () => new FakeElement(),
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    addEventListener() {},
    head: new FakeElement(),
  };
}

async function openView({ view, platform = 'web', isNative = false, userAgent, touchPoints = 0 }) {
  const document = fakeDocument();
  const context = {
    document,
    fetch: async () => ({ ok: true, json: async () => ({ password: true }) }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    NativeShell: { platform, isNative },
    navigator: { userAgent, maxTouchPoints: touchPoints },
    trackEvent: () => {},
    showUser: () => {},
    startSignIn: () => {},
    startAppleSignIn: () => {},
    addEventListener() {},
  };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  await context.openAuthModal({ view });
  return document.getElementById(BUTTON_ID);
}

describe('the Open mail app button', () => {
  for (const view of ['check-email', 'forgot-sent']) {
    it(`opens Apple Mail on an iPhone (${view})`, async () => {
      const button = await openView({ view, userAgent: IPHONE });
      assert.equal(button.hidden, false);
      assert.equal(button.attributes.href, 'message://');
    });
  }

  it('opens Apple Mail in the iOS app', async () => {
    const button = await openView({ view: 'check-email', platform: 'ios', isNative: true, userAgent: IPHONE });
    assert.equal(button.hidden, false);
    assert.equal(button.attributes.href, 'message://');
  });

  it('opens Apple Mail on an iPad that calls itself a Mac', async () => {
    const button = await openView({ view: 'check-email', userAgent: MAC, touchPoints: 5 });
    assert.equal(button.attributes.href, 'message://');
  });

  it('asks Android for its mail app in the browser', async () => {
    const button = await openView({ view: 'check-email', userAgent: ANDROID });
    assert.equal(button.hidden, false);
    assert.match(button.attributes.href, /^intent:.*APP_EMAIL/);
  });

  it('is hidden in the Android app', async () => {
    const button = await openView({ view: 'check-email', platform: 'android', isNative: true, userAgent: ANDROID });
    assert.equal(button.hidden, true);
  });

  for (const [name, userAgent] of [['a Mac', MAC], ['Windows', WINDOWS]]) {
    it(`is hidden on ${name}`, async () => {
      const button = await openView({ view: 'check-email', userAgent });
      assert.equal(button.hidden, true);
    });
  }

  it('is hidden on the other views, even on a phone', async () => {
    const button = await openView({ view: 'sign-in', userAgent: IPHONE });
    assert.equal(button.hidden, true);
  });
});
