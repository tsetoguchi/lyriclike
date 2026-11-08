// The extension hook's delete notice: a line an extension script sets that
// the account delete dialog shows above its confirm field. These run the real
// dialog.js, account-security.js and extensions.js against a small fake page.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SCRIPTS = ['dialog.js', 'account-security.js', 'slot-inputs.js', 'extensions.js'];
const NOTICE = 'Stop the renewal in Settings first, or it keeps going.';
const PASSWORD = 'correct horse battery';
const DELETE_BUTTON_ID = 'settings-delete-account-btn';
const OK_STATUS = 200;

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

class FakeElement {
  constructor() {
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, isOn) => (isOn ? classes.add(name) : classes.delete(name)),
    };
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  fire(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener({ target: this, ...event });
  }

  focus() {}
  select() {}
  reset() {}
  setAttribute() {}
  removeAttribute() {}
  appendChild() {}
}

function fakeDocument() {
  const elements = new Map();
  const document = new FakeElement();
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  document.createElement = () => new FakeElement();
  document.head = new FakeElement();
  return document;
}

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

// One page, signed in to an account with a password.
function loadPage() {
  const document = fakeDocument();
  const requests = [];
  const page = { document, requests, warnings: [], hasEnded: false };
  const context = {
    document,
    setTimeout: () => 0,
    console: { warn: (...args) => page.warnings.push(args) },
    currentUser: { email: 'ann@example.com', has_password: true },
    endSession: () => { page.hasEnded = true; },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { status: OK_STATUS, json: async () => ({}) };
    },
  };
  context.window = context;
  vm.createContext(context);
  for (const script of SCRIPTS) vm.runInContext(readScript(script), context);
  page.hooks = context.siteExtensions;
  page.dialog = context.Dialog;
  page.notice = () => document.getElementById('dialog-notice');
  page.openDelete = () => document.getElementById(DELETE_BUTTON_ID).fire('click');
  return page;
}

describe('the delete notice extension hook', () => {
  it('hooks report version 9', () => {
    assert.equal(loadPage().hooks.version, 9);
  });

  it('the delete dialog shows the notice an extension set', () => {
    const page = loadPage();
    page.hooks.setDeleteNotice(NOTICE);
    page.openDelete();
    assert.equal(page.notice().textContent, NOTICE);
    assert.equal(page.notice().hidden, false);
  });

  it('the delete dialog shows no notice by default', () => {
    const page = loadPage();
    page.openDelete();
    assert.equal(page.notice().textContent, '');
    assert.equal(page.notice().hidden, true);
  });

  it('setDeleteNotice(null) clears it', () => {
    const page = loadPage();
    page.hooks.setDeleteNotice(NOTICE);
    page.hooks.setDeleteNotice(null);
    page.openDelete();
    assert.equal(page.notice().hidden, true);
  });

  it('refuses a notice that is not text, and keeps the one set before', () => {
    const page = loadPage();
    page.hooks.setDeleteNotice(NOTICE);
    page.hooks.setDeleteNotice({ html: '<b>no</b>' });
    page.openDelete();
    assert.equal(page.notice().textContent, NOTICE);
    assert.equal(page.warnings.length, 1);
  });

  it('other dialogs never show the notice', async () => {
    const page = loadPage();
    page.hooks.setDeleteNotice(NOTICE);
    page.openDelete();
    page.document.getElementById('dialog-cancel').fire('click');
    await flush();
    page.dialog.open({ heading: 'Rename page', confirmLabel: 'OK' });
    assert.equal(page.notice().hidden, true);
  });

  it('deleting still works with a notice shown', async () => {
    const page = loadPage();
    page.hooks.setDeleteNotice(NOTICE);
    page.openDelete();
    page.document.getElementById('dialog-input').value = PASSWORD;
    page.document.getElementById('dialog-confirm').fire('click');
    await flush();
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].url, '/api/account');
    assert.equal(page.requests[0].init.method, 'DELETE');
    assert.deepEqual(JSON.parse(page.requests[0].init.body), { password: PASSWORD });
    assert.equal(page.hasEnded, true);
  });
});
