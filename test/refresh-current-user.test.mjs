// auth.js's refreshCurrentUser asks /api/me again after something on the
// server changed the account (a purchase in the iOS app), and redraws only
// the page count. It keeps the same user object, and a failure or a
// different account by then changes nothing.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
const EMAIL = 'ann@example.com';

// Every element the file touches at load, with nothing behind it.
function fakeElement() {
  return {
    style: {}, textContent: '', parentElement: null,
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, setAttribute() {},
  };
}

// Waits out the sign-in check auth.js runs as it loads.
async function loadAuth(answers) {
  const calls = { pageCount: 0 };
  const context = {
    document: {
      getElementById: () => fakeElement(),
      addEventListener() {},
      dispatchEvent() {},
      body: fakeElement(),
      documentElement: fakeElement(),
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: async () => answers.shift(),
    Event: class {},
    NotebookList: { load() {}, refreshPageCount: () => { calls.pageCount += 1; } },
    setSignedInProperty() {},
    trackEventOnce() {},
  };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, calls };
}

function answer(body, ok = true) {
  return { ok, json: async () => body };
}

const NOT_SIGNED_IN = answer(null, false);
const NO_LIMIT_NOW = answer({ email: EMAIL, page_limit: null });
const OTHER_ACCOUNT = answer({ email: 'bo@example.com', page_limit: null });

describe('refreshCurrentUser', () => {
  it('takes the new limits into the same user and redraws the page count', async () => {
    const { context, calls } = await loadAuth([NOT_SIGNED_IN, NO_LIMIT_NOW]);
    const user = { email: EMAIL, page_limit: 5 };
    context.currentUser = user;
    await context.refreshCurrentUser();
    assert.equal(context.currentUser, user);
    assert.equal(user.page_limit, null);
    assert.equal(calls.pageCount, 1);
  });

  it('changes nothing when the server answers an error', async () => {
    const { context, calls } = await loadAuth([NOT_SIGNED_IN, answer(null, false)]);
    const user = { email: EMAIL, page_limit: 5 };
    context.currentUser = user;
    await context.refreshCurrentUser();
    assert.equal(user.page_limit, 5);
    assert.equal(calls.pageCount, 0);
  });

  it('changes nothing when the answer is another account', async () => {
    const { context } = await loadAuth([NOT_SIGNED_IN, OTHER_ACCOUNT]);
    const user = { email: EMAIL, page_limit: 5 };
    context.currentUser = user;
    await context.refreshCurrentUser();
    assert.equal(user.page_limit, 5);
  });

  it('does nothing while signed out', async () => {
    const { context, calls } = await loadAuth([NOT_SIGNED_IN]);
    context.currentUser = null;
    await context.refreshCurrentUser();
    assert.equal(calls.pageCount, 0);
  });
});
