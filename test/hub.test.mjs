// The phone start screen (hub.js) puts itself away when a way in is picked,
// and also when it should never have stayed: the sign-in answer said signed
// out, the splash lifted before any answer came, or the screen grew wider
// than a phone. hub.js needs a browser, so it runs here against a small fake.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const HUB_SOURCE = readFileSync(new URL('../hub.js', import.meta.url), 'utf8');
const SPLASH_SOURCE = readFileSync(new URL('../splash.js', import.meta.url), 'utf8');
const SIGNED_IN = { email: 'writer@example.com' };

function fakeClassList(names = []) {
  const set = new Set(names);
  return {
    add: (...added) => added.forEach(name => set.add(name)),
    remove: (...removed) => removed.forEach(name => set.delete(name)),
    contains: name => set.has(name),
  };
}

function fakeEventTarget() {
  const listeners = {};
  return {
    addEventListener(type, listener) {
      (listeners[type] ||= []).push(listener);
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] || []).filter(kept => kept !== listener);
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach(listener => listener(event));
    },
  };
}

function fakeElement() {
  const element = { ...fakeEventTarget(), parentElement: null, nextSibling: null };
  element.insertBefore = child => { child.parentElement = element; };
  return element;
}

class FakeEvent {
  constructor(type, fields = {}) {
    this.type = type;
    Object.assign(this, fields);
  }
  preventDefault() {}
}

function fakePage({ htmlClasses, currentUser }) {
  const elements = {
    hub: fakeElement(),
    'invite-btn': fakeElement(),
    'header-slot': fakeElement(),
    'hub-notebook-btn': fakeElement(),
    'hub-create-btn': fakeElement(),
  };
  elements['invite-btn'].parentElement = fakeElement();
  elements['header-slot'].parentElement = fakeElement();
  const wordmark = fakeElement();
  const phoneQuery = { ...fakeEventTarget(), matches: true };
  const tracked = [];
  const opened = [];
  const document = {
    ...fakeEventTarget(),
    documentElement: { classList: fakeClassList(htmlClasses) },
    body: { classList: fakeClassList(['signed-in']) },
    getElementById: id => elements[id],
    querySelector: () => wordmark,
  };
  const window = {
    document,
    currentUser,
    Event: FakeEvent,
    matchMedia: () => phoneQuery,
    placeAccountMenu: () => {},
    trackEvent: (name, params) => tracked.push({ name, params }),
    HubGate: { markTab: () => {} },
    NotebookList: { open: () => opened.push('notebook') },
    Sidebar: { close: () => {} },
    handleCreateClick: () => opened.push('create'),
  };
  window.window = window;
  return { window, document, elements, phoneQuery, tracked, opened };
}

function loadHub(options) {
  const page = fakePage(options);
  vm.runInNewContext(HUB_SOURCE, page.window);
  page.isHubShowing = () => page.document.documentElement.classList.contains('is-hub');
  page.isHubLeaving = () => page.document.documentElement.classList.contains('is-hub-leaving');
  return page;
}

function finishHubFade(page) {
  const hub = page.elements.hub;
  hub.dispatchEvent(new FakeEvent('transitionend', { target: hub, propertyName: 'opacity' }));
}

describe('hub.js', () => {
  it('hides the hub when the signed-out answer came before it loaded', () => {
    const page = loadHub({ htmlClasses: ['is-hub', 'is-splashing'], currentUser: null });
    assert.equal(page.isHubShowing(), false);
    assert.deepEqual(page.tracked, []);
  });

  it('hides the hub when the splash lifts before any sign-in answer', () => {
    const page = loadHub({ htmlClasses: ['is-hub', 'is-splashing'], currentUser: undefined });
    page.document.dispatchEvent(new FakeEvent('splash-lifted'));
    assert.equal(page.isHubShowing(), false);
    assert.deepEqual(page.tracked, []);
  });

  it('hides the hub when the splash lifted before it loaded, with no answer', () => {
    const page = loadHub({ htmlClasses: ['is-hub'], currentUser: undefined });
    assert.equal(page.isHubShowing(), false);
  });

  it('keeps the hub when the splash lifts after a signed-in answer', () => {
    const page = loadHub({ htmlClasses: ['is-hub', 'is-splashing'], currentUser: SIGNED_IN });
    page.document.dispatchEvent(new FakeEvent('splash-lifted'));
    assert.equal(page.isHubShowing(), true);
  });

  it('hides the hub when the screen grows wider than a phone', () => {
    const page = loadHub({ htmlClasses: ['is-hub', 'is-splashing'], currentUser: SIGNED_IN });
    page.phoneQuery.matches = false;
    page.phoneQuery.dispatchEvent(new FakeEvent('change'));
    assert.equal(page.isHubShowing(), false);
    assert.deepEqual(page.tracked, []);
  });

  it('opens Notebook at once and hides the hub once it has faded', () => {
    const page = loadHub({ htmlClasses: ['is-hub', 'is-splashing'], currentUser: SIGNED_IN });
    page.elements['hub-notebook-btn'].dispatchEvent(new FakeEvent('click'));
    assert.deepEqual(page.opened, ['notebook']);
    assert.equal(page.isHubShowing(), true);
    assert.equal(page.isHubLeaving(), true);
    finishHubFade(page);
    assert.equal(page.isHubShowing(), false);
    assert.equal(page.isHubLeaving(), false);
    // Plain copy: params was built inside the vm, so its prototype differs.
    const tracked = JSON.parse(JSON.stringify(page.tracked));
    assert.deepEqual(tracked, [{ name: 'hub_choice', params: { choice: 'notebook' } }]);
  });

  it('ignores a second pick while the hub fades', () => {
    const page = loadHub({ htmlClasses: ['is-hub', 'is-splashing'], currentUser: SIGNED_IN });
    page.elements['hub-create-btn'].dispatchEvent(new FakeEvent('click'));
    page.elements['hub-notebook-btn'].dispatchEvent(new FakeEvent('click'));
    finishHubFade(page);
    assert.deepEqual(page.opened, ['create']);
    assert.equal(page.tracked.length, 1);
  });
});

describe('splash.js', () => {
  it('announces splash-lifted once when the time cap lifts it', async () => {
    const document = {
      ...fakeEventTarget(),
      documentElement: { classList: fakeClassList() },
    };
    let liftedCount = 0;
    document.addEventListener('splash-lifted', () => { liftedCount += 1; });
    const window = {
      document,
      Event: FakeEvent,
      setTimeout,
      Promise,
      localStorage: { getItem: () => '1' },
      performance: { now: () => 10_000 },
    };
    vm.runInNewContext(SPLASH_SOURCE, window);
    await new Promise(done => setTimeout(done, 20));
    assert.equal(liftedCount, 1);
  });
});
