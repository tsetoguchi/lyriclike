// "Check your email" offers an "Open mail app" button on phones. iOS has no
// link to "the default mail app", so the address picks one: Gmail and
// Outlook addresses get their own app in the iOS app (when it is installed)
// and their web inbox in Safari; everyone else gets Apple Mail. Android
// browsers ask for the default mail app. Computers and the Android app
// (a webview that can't open intent: links) don't show it, and neither does
// any other view.
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
const OTHER_EMAIL = 'pat@example.org';

class FakeElement {
  constructor() {
    this.hidden = true;
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.offsetParent = null;
    this.attributes = {};
    this.listeners = {};
    this.classList = { add() {}, remove() {}, contains: () => false };
  }

  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
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

const settle = () => new Promise(resolve => setImmediate(resolve));

// `launcher` stands in for the iOS app's AppLauncher plugin: the apps it
// says are installed, or 'throws'.
async function openView({ view = 'check-email', email = OTHER_EMAIL, platform = 'web', isNative = false,
  userAgent, touchPoints = 0, launcher }) {
  const document = fakeDocument();
  const opened = [];
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
  if (launcher) {
    context.Capacitor = { Plugins: { AppLauncher: {
      canOpenUrl: async ({ url }) => {
        if (launcher === 'throws') throw new Error('no');
        return { value: launcher.includes(url) };
      },
      openUrl: async ({ url }) => { opened.push(url); return { completed: true }; },
    } } };
  }
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  await context.openAuthModal({ view, email });
  await settle();
  await settle();
  const button = document.getElementById(BUTTON_ID);
  return { button, href: button.attributes.href, target: button.attributes.target, opened };
}

describe('the Open mail app button on the website', () => {
  for (const view of ['check-email', 'forgot-sent']) {
    it(`opens Apple Mail on an iPhone for other addresses (${view})`, async () => {
      const { button, href, target } = await openView({ view, userAgent: IPHONE });
      assert.equal(button.hidden, false);
      assert.equal(href, 'message://');
      assert.equal(target, undefined);
    });
  }

  for (const email of ['tao@gmail.com', 'Tao@GoogleMail.com']) {
    it(`opens the Gmail inbox in a new tab for ${email} on an iPhone`, async () => {
      const { href, target } = await openView({ email, userAgent: IPHONE });
      assert.equal(href, 'https://mail.google.com/mail/');
      assert.equal(target, '_blank');
    });
  }

  for (const email of ['sam@outlook.com', 'sam@hotmail.co.uk', 'sam@live.com']) {
    it(`opens the Outlook inbox for ${email} on an iPhone`, async () => {
      const { href } = await openView({ email, userAgent: IPHONE });
      assert.equal(href, 'https://outlook.live.com/mail/');
    });
  }

  it('does not mistake a lookalike domain for Gmail', async () => {
    const { href } = await openView({ email: 'sam@notgmail.com', userAgent: IPHONE });
    assert.equal(href, 'message://');
  });

  it('opens Apple Mail on an iPad that calls itself a Mac', async () => {
    const { href } = await openView({ userAgent: MAC, touchPoints: 5 });
    assert.equal(href, 'message://');
  });

  it('asks Android for its default mail app, Gmail address or not', async () => {
    const { button, href } = await openView({ email: 'tao@gmail.com', userAgent: ANDROID });
    assert.equal(button.hidden, false);
    assert.match(href, /^intent:.*APP_EMAIL/);
  });

  for (const [name, userAgent] of [['a Mac', MAC], ['Windows', WINDOWS]]) {
    it(`is hidden on ${name}`, async () => {
      const { button } = await openView({ userAgent });
      assert.equal(button.hidden, true);
    });
  }

  it('is hidden on the other views, even on a phone', async () => {
    const { button } = await openView({ view: 'sign-in', userAgent: IPHONE });
    assert.equal(button.hidden, true);
  });
});

describe('the Open mail app button in the iOS app', () => {
  const ios = { platform: 'ios', isNative: true, userAgent: IPHONE };

  it('opens the Gmail app for a Gmail address when it is installed', async () => {
    const { href, target } = await openView({ ...ios, email: 'tao@gmail.com', launcher: ['googlegmail://'] });
    assert.equal(href, 'googlegmail://');
    assert.equal(target, undefined);
  });

  it('opens the Outlook app for an Outlook address when it is installed', async () => {
    const { href } = await openView({ ...ios, email: 'sam@hotmail.com', launcher: ['ms-outlook://'] });
    assert.equal(href, 'ms-outlook://');
  });

  it('falls back to Apple Mail when the Gmail app is not installed', async () => {
    const { href } = await openView({ ...ios, email: 'tao@gmail.com', launcher: [] });
    assert.equal(href, 'message://');
  });

  it('falls back to Apple Mail when the check fails', async () => {
    const { href } = await openView({ ...ios, email: 'tao@gmail.com', launcher: 'throws' });
    assert.equal(href, 'message://');
  });

  it('uses Apple Mail in an older build without the plugin', async () => {
    const { button, href } = await openView({ ...ios, email: 'tao@gmail.com' });
    assert.equal(button.hidden, false);
    assert.equal(href, 'message://');
  });

  it('opens the link through the plugin when tapped', async () => {
    const { button, opened } = await openView({ ...ios, email: 'tao@gmail.com', launcher: ['googlegmail://'] });
    let prevented = false;
    button.listeners.click({ preventDefault: () => { prevented = true; }, currentTarget: button });
    await settle();
    assert.equal(prevented, true);
    assert.deepEqual(opened, ['googlegmail://']);
  });

  it('is hidden in the Android app', async () => {
    const { button } = await openView({ platform: 'android', isNative: true, userAgent: ANDROID, launcher: [] });
    assert.equal(button.hidden, true);
  });
});
