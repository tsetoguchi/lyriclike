// auth-forms.js shows Sign in with Apple in the iOS app whenever it shows
// Google (App Review rule 4.8). Only the server saying `apple: false` hides it;
// a methods call that fails still shows it. The web and Android never show it.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../auth-forms.js', import.meta.url), 'utf8');
const APPLE_BUTTON_ID = 'auth-apple';
const GOOGLE_BUTTON_ID = 'auth-google';
const PLATFORMS_WITHOUT_APPLE = ['web', 'android'];

// Just enough of an element for the modal to draw a view into.
class FakeElement {
  constructor() {
    this.hidden = true;
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.offsetParent = null;
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    };
  }

  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  appendChild() {}
  focus() {}
  contains() { return false; }
  querySelectorAll() { return []; }
}

function fakeDocument() {
  const elements = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  return {
    getElementById: byId,
    querySelector: () => new FakeElement(),
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    addEventListener() {},
    head: new FakeElement(),
  };
}

function methodsAnswer(body) {
  return async () => ({ ok: true, json: async () => body });
}

async function failedMethods() {
  throw new TypeError('Failed to fetch');
}

async function serverError() {
  return { ok: false, json: async () => null };
}

const APPLE_ON = methodsAnswer({ password: true, apple: true });
const APPLE_OFF = methodsAnswer({ password: true, apple: false });

// Loads the modal on one platform, opens it, and returns the page.
async function openModal({ platform, fetch }) {
  const document = fakeDocument();
  const context = {
    document,
    fetch,
    setTimeout: () => 0,
    clearTimeout: () => {},
    NativeShell: { platform, isNative: platform !== 'web' },
    trackEvent: () => {},
    showUser: () => {},
    startSignIn: () => {},
    startAppleSignIn: () => {},
    addEventListener() {},
  };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  await context.openAuthModal();
  return document;
}

function isShown(document, id) {
  return !document.getElementById(id).hidden;
}

const CASES = [
  ['the methods call fails', failedMethods, true],
  ['the server answers an error', serverError, true],
  ['the server answers apple: true', APPLE_ON, true],
  ['the server answers apple: false', APPLE_OFF, false],
];

describe('the Sign in with Apple button', () => {
  for (const [situation, fetch, isAppleExpected] of CASES) {
    const expected = isAppleExpected ? 'shown' : 'hidden';
    it(`is ${expected} on iOS when ${situation}`, async () => {
      const document = await openModal({ platform: 'ios', fetch });
      assert.equal(isShown(document, APPLE_BUTTON_ID), isAppleExpected);
      assert.equal(isShown(document, GOOGLE_BUTTON_ID), true);
    });

    for (const platform of PLATFORMS_WITHOUT_APPLE) {
      it(`is hidden on ${platform} when ${situation}`, async () => {
        const document = await openModal({ platform, fetch });
        assert.equal(isShown(document, APPLE_BUTTON_ID), false);
        assert.equal(isShown(document, GOOGLE_BUTTON_ID), true);
      });
    }
  }

  it('keeps the password form hidden when the methods call fails', async () => {
    const document = await openModal({ platform: 'ios', fetch: failedMethods });
    assert.equal(isShown(document, 'auth-form'), false);
  });
});
