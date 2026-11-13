// The iOS app runs the security check in a frame from the website, because
// Turnstile needs an http(s) page and the app's pages are capacitor://.
// app-check/app-check.js is the page in the frame; turnstile-frame.js is the
// app side. auth-forms.js uses the frame on iOS only, and a failed check says
// so instead of blaming the connection.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const AppCheck = require('../app-check/app-check.js');
const TurnstileFrame = require('../turnstile-frame.js');

const AUTH_FORMS = readFileSync(new URL('../auth-forms.js', import.meta.url), 'utf8');
const FRAME_SOURCE = readFileSync(new URL('../turnstile-frame.js', import.meta.url), 'utf8');
const SITE_ORIGIN = 'https://lyriclike.com';
const SITE_KEY = '0x4AAAAAAFCbadlyB2I-_tMz';
const IOS_ORIGIN = 'capacitor://localhost';

describe('the check page', () => {
  it('reads a site key and a known action', () => {
    const request = AppCheck.readCheckRequest(`?sitekey=${SITE_KEY}&action=signup`);
    assert.deepEqual({ ...request }, { siteKey: SITE_KEY, action: 'signup' });
  });

  it('refuses an unknown action or a strange site key', () => {
    assert.equal(AppCheck.readCheckRequest(`?sitekey=${SITE_KEY}&action=pay`), null);
    assert.equal(AppCheck.readCheckRequest('?sitekey=<x>&action=signup'), null);
    assert.equal(AppCheck.readCheckRequest('?action=signup'), null);
  });

  it('sends the token only to the iOS app', () => {
    const sent = [];
    const send = AppCheck.makeSender({ postMessage: (data, origin) => sent.push({ data, origin }) });
    const options = AppCheck.widgetOptions({ siteKey: SITE_KEY, action: 'login' }, send);
    options.callback('tok');
    options['error-callback'](110200);
    assert.equal(options.action, 'login');
    assert.deepEqual(sent.map(item => item.origin), [IOS_ORIGIN, IOS_ORIGIN]);
    assert.equal(sent[0].data.token, 'tok');
    assert.equal(sent[1].data.code, '110200');
  });
});

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.textContent = '';
    this.hidden = true;
    this.value = '';
    this.dataset = {};
    this.contentWindow = {};
    this.isRemoved = false;
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    };
  }

  appendChild(child) { this.children.push(child); }
  remove() { this.isRemoved = true; }
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  focus() {}
  contains() { return false; }
  querySelectorAll() { return []; }
}

function fakeWindow() {
  const listeners = new Set();
  const created = [];
  return {
    created,
    listeners,
    document: {
      createElement: tag => {
        const element = new FakeElement(tag);
        created.push(element);
        return element;
      },
    },
    addEventListener: (type, listener) => listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
    send(event) { listeners.forEach(listener => listener(event)); },
  };
}

function mountFrame(window, handlers) {
  return TurnstileFrame.mount({
    window, container: new FakeElement('div'), siteOrigin: SITE_ORIGIN,
    siteKey: SITE_KEY, action: 'signup', ...handlers,
  });
}

describe('the app side of the frame', () => {
  it('points the frame at the check page with the key and action', () => {
    const url = new URL(TurnstileFrame.frameUrl(SITE_ORIGIN, SITE_KEY, 'signup'));
    assert.equal(url.origin + url.pathname, `${SITE_ORIGIN}/app-check/`);
    assert.equal(url.searchParams.get('action'), 'signup');
  });

  it('takes a token only from its own frame on the site', () => {
    const window = fakeWindow();
    const tokens = [];
    mountFrame(window, { onToken: token => tokens.push(token), onError() {}, onExpired() {} });
    const frame = window.created[0];
    const data = { source: 'lyriclike-app-check', type: 'token', token: 'good' };
    window.send({ origin: 'https://evil.example', source: frame.contentWindow, data });
    window.send({ origin: SITE_ORIGIN, source: {}, data });
    window.send({ origin: SITE_ORIGIN, source: frame.contentWindow, data });
    assert.deepEqual(tokens, ['good']);
  });

  it('grows when the challenge needs a tap and stops listening once removed', () => {
    const window = fakeWindow();
    const handle = mountFrame(window, { onToken() {}, onError() {}, onExpired() {} });
    const frame = window.created[0];
    const show = { source: 'lyriclike-app-check', type: 'show' };
    window.send({ origin: SITE_ORIGIN, source: frame.contentWindow, data: show });
    assert.equal(frame.classList.contains('is-shown'), true);
    handle.remove();
    assert.equal(frame.isRemoved, true);
    assert.equal(window.listeners.size, 0);
  });
});

function fakeDocument() {
  const elements = new Map();
  const created = [];
  return {
    created,
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new FakeElement('div'));
      return elements.get(id);
    },
    querySelector: () => new FakeElement('div'),
    querySelectorAll: () => [],
    createElement: tag => {
      const element = new FakeElement(tag);
      created.push(element);
      return element;
    },
    addEventListener() {},
    head: new FakeElement('head'),
  };
}

const METHODS = { password: true, apple: true, turnstileSiteKey: SITE_KEY };

async function answerMethods() {
  return { ok: true, json: async () => METHODS };
}

// Loads the modal on one platform and opens the sign-up view.
async function openSignUp(platform) {
  const document = fakeDocument();
  const context = {
    document, fetch: answerMethods, URL, URLSearchParams,
    setTimeout: () => 0, clearTimeout: () => {},
    NativeShell: { platform, isNative: platform !== 'web', siteOrigin: SITE_ORIGIN },
    trackEvent() {}, showUser() {}, startSignIn() {}, startAppleSignIn() {},
    addEventListener() {}, removeEventListener() {},
  };
  context.window = context;
  vm.runInNewContext(FRAME_SOURCE, context);
  vm.runInNewContext(AUTH_FORMS, context);
  await context.openAuthModal({ view: 'sign-up' });
  return document;
}

describe('the sign-in modal', () => {
  it('loads the check in a frame on iOS', async () => {
    const document = await openSignUp('ios');
    assert.equal(document.created.some(element => element.tag === 'iframe'), true);
  });

  it('keeps the plain widget on Android and the web', async () => {
    for (const platform of ['android', 'web']) {
      const document = await openSignUp(platform);
      assert.equal(document.created.some(element => element.tag === 'iframe'), false);
      assert.equal(document.created.some(element => element.tag === 'script'), true);
    }
  });
});
