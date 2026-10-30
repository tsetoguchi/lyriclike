// save-nudge.js decides when a signed-out writer is asked to keep their page:
// once while writing, once more on a later visit, never past that.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../save-nudge.js', import.meta.url), 'utf8');
const SHOWN_KEY = 'save_nudge_seen';
const TWO_LINES = 'first line here\nsecond line here';

class FakeTarget {
  constructor(props = {}) {
    Object.assign(this, props);
    this.listeners = {};
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  fire(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event);
  }
}

function fakeStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
  };
}

// One page load. localStorage carries over between visits; sessionStorage
// does not.
function loadPage({ local = fakeStorage(), text = '', isSample = false } = {}) {
  const elements = {
    lyrics: new FakeTarget({ value: text }),
    'page-notice': new FakeTarget({ hidden: true }),
    'save-keep': new FakeTarget({ hidden: true }),
  };
  const document = new FakeTarget({ getElementById: (id) => elements[id] });
  const events = [];
  const signIns = [];
  const context = {
    document,
    localStorage: local,
    sessionStorage: fakeStorage(),
    isSampleShowing: () => isSample,
    trackEvent: (name, params) => events.push({ name, ...params }),
    openSignIn: (entry) => signIns.push(entry),
  };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  const page = {
    local, events, signIns, document,
    button: elements['save-keep'],
    signOut: () => { context.currentUser = null; document.fire('auth-checked'); },
    signIn: () => { context.currentUser = { id: 'u' }; document.fire('auth-checked'); },
    type: (value) => {
      elements.lyrics.value = value;
      elements.lyrics.fire('input', { isTrusted: true });
    },
    load: (value) => {
      elements.lyrics.value = value;
      elements.lyrics.fire('input', { isTrusted: false });
    },
  };
  return page;
}

describe('save nudge', () => {
  it('asks a signed-out writer after two lines', () => {
    const page = loadPage();
    page.signOut();
    page.type('only one line');
    assert.equal(page.button.hidden, true);
    page.type(TWO_LINES);
    assert.equal(page.button.hidden, false);
    assert.deepEqual(page.events, [{ name: 'save_nudge_shown', trigger: 'lines' }]);
  });

  it('asks after one line once a rhyme is picked', () => {
    const page = loadPage();
    page.signOut();
    page.type('one line with a rhyme');
    page.document.fire('rhyme-inserted');
    assert.equal(page.button.hidden, false);
    assert.equal(page.events[0].trigger, 'rhyme');
  });

  it('waits for the sign-in check before asking', () => {
    const page = loadPage();
    page.type(TWO_LINES);
    assert.equal(page.button.hidden, true);
  });

  it('never asks a signed-in writer, and hides on sign-in', () => {
    const page = loadPage();
    page.signOut();
    page.type(TWO_LINES);
    page.signIn();
    assert.equal(page.button.hidden, true);
    page.type(TWO_LINES + '\nthird');
    assert.equal(page.button.hidden, true);
  });

  it('leaves the sample alone', () => {
    const page = loadPage({ isSample: true });
    page.signOut();
    page.type(TWO_LINES);
    assert.equal(page.button.hidden, true);
  });

  it('asks once per visit, even after it is dismissed', () => {
    const page = loadPage();
    page.signOut();
    page.type(TWO_LINES);
    page.load('another page\nwith lines');
    assert.equal(page.button.hidden, true);
    page.type(TWO_LINES + '\nthird');
    assert.equal(page.button.hidden, true);
    assert.equal(page.events.length, 1);
  });

  it('asks again when the writer comes back to their draft', () => {
    const local = fakeStorage();
    const first = loadPage({ local });
    first.signOut();
    first.type(TWO_LINES);
    const back = loadPage({ local, text: TWO_LINES });
    back.signOut();
    assert.equal(back.button.hidden, false);
    assert.equal(back.events[0].trigger, 'return');
    assert.equal(local.getItem(SHOWN_KEY), '2');
  });

  it('stops after two asks', () => {
    const page = loadPage({ local: fakeStorage({ [SHOWN_KEY]: '2' }), text: TWO_LINES });
    page.signOut();
    page.type(TWO_LINES + '\nthird');
    assert.equal(page.button.hidden, true);
  });

  it('gives devices asked before the count one more ask', () => {
    const local = fakeStorage({ [SHOWN_KEY]: '1' });
    const page = loadPage({ local, text: TWO_LINES });
    page.signOut();
    assert.equal(page.button.hidden, false);
  });

  it('opens sign-in from the button', () => {
    const page = loadPage();
    page.signOut();
    page.type(TWO_LINES);
    page.button.fire('click');
    assert.equal(page.button.hidden, true);
    assert.deepEqual(page.signIns, ['save_nudge']);
  });
});
