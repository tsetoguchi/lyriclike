// The account menu and the header letter. An Apple account that hides its
// address shows "Signed in with Apple" and the person's name, never the
// relay address Apple made up.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
const RELAY_EMAIL = '57z6wh72p5@privaterelay.appleid.com';

function fakeElement() {
  return {
    style: {}, textContent: '', parentElement: null, children: [],
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {},
    appendChild(child) { this.children.push(child); },
  };
}

function loadAuth({ logo = { cloneNode: () => ({ isLogo: true }) } } = {}) {
  const elements = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  };
  const context = {
    document: {
      getElementById: byId,
      querySelector: () => logo,
      addEventListener() {},
      dispatchEvent() {},
      body: fakeElement(),
      documentElement: fakeElement(),
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: async () => ({ ok: false, json: async () => null }),
    Event: class {},
    NotebookList: { load() {} },
    setSignedInProperty() {},
    trackEventOnce() {},
  };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  return { context, byId };
}

describe('what the account menu says', () => {
  const { context } = loadAuth();

  it('shows an ordinary address as it is', () => {
    const who = context.accountWho({ email: 'ann@example.com', name: 'Ann' });
    assert.equal(who.caption, 'Signed in as');
    assert.equal(who.line, 'ann@example.com');
    assert.equal(context.accountInitial({ email: 'ann@example.com', name: 'Zed' }), 'A');
  });

  it('shows Apple and the name in place of a hidden address', () => {
    const who = context.accountWho({ email: RELAY_EMAIL, name: 'Tao Setoguchi' });
    assert.equal(who.caption, 'Signed in with Apple');
    assert.equal(who.line, 'Tao Setoguchi');
    assert.equal(context.accountInitial({ email: RELAY_EMAIL, name: 'Tao Setoguchi' }), 'T');
  });

  it('shows no line and no letter when Apple shared no name', () => {
    const user = { email: RELAY_EMAIL, name: null };
    assert.equal(context.accountWho(user).line, '');
    assert.equal(context.accountInitial(user), '');
  });

  it('reads the relay domain in any case', () => {
    assert.equal(context.accountWho({ email: 'X@PrivateRelay.AppleID.com' }).caption,
      'Signed in with Apple');
  });

  it('keeps an Apple account with a real address as an address', () => {
    assert.equal(context.accountWho({ email: 'ann@icloud.com', name: 'Ann' }).line, 'ann@icloud.com');
  });
});

describe('the header letter', () => {
  it('puts the Apple logo in when there is no letter', () => {
    const { context, byId } = loadAuth();
    context.drawAccountInitial({ email: RELAY_EMAIL, name: null });
    assert.equal(byId('account-initial').textContent, '');
    assert.deepEqual(byId('account-initial').children, [{ isLogo: true }]);
  });

  it('uses the letter, with no logo, when there is a name', () => {
    const { context, byId } = loadAuth();
    context.drawAccountInitial({ email: RELAY_EMAIL, name: 'Tao' });
    assert.equal(byId('account-initial').textContent, 'T');
    assert.equal(byId('account-initial').children.length, 0);
  });

  it('leaves the slot empty when the page has no logo to borrow', () => {
    const { context, byId } = loadAuth({ logo: null });
    context.drawAccountInitial({ email: RELAY_EMAIL, name: null });
    assert.equal(byId('account-initial').children.length, 0);
  });
});
