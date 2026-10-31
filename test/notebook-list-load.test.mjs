// auth.js asks /api/me before storage.js runs. If the signed-out answer lands
// while storage.js is still downloading, the notebook must wait for OpenPage
// rather than throw and leave the list empty.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const LIST_SOURCE = readFileSync(new URL('../notebook-list.js', import.meta.url), 'utf8');
const LOCAL_TITLE = 'Nobody Home';

function fakeElement() {
  const listeners = {};
  return {
    hidden: false,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    disabled: false,
    textContent: '',
    innerHTML: '',
    listeners,
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    focus() {},
  };
}

function loadNotebookList({ readyState }) {
  const els = {};
  const document = fakeElement();
  document.readyState = readyState;
  document.getElementById = (id) => (els[id] ||= fakeElement());
  // The vm's global stands in for window, as a browser's does.
  const window = {
    document,
    localStorage: { getItem: () => null, setItem() {} },
    escapeHtml: (text) => text,
    currentUser: null,
    promptForPendingShare() { window.isShareAsked = true; },
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(LIST_SOURCE, window);
  return { window, document, els };
}

function finishParsing(page) {
  page.document.readyState = 'interactive';
  page.window.OpenPage = { shownTitle: LOCAL_TITLE };
  for (const listener of page.document.listeners.DOMContentLoaded || []) listener();
}

describe('NotebookList.load before storage.js has run', () => {
  it('waits for the page to finish parsing instead of throwing', async () => {
    const page = loadNotebookList({ readyState: 'loading' });
    const loading = page.window.NotebookList.load();
    finishParsing(page);
    await loading;
    assert.match(page.els['lyrics-list-items'].innerHTML, new RegExp(LOCAL_TITLE));
    assert.equal(page.window.isShareAsked, true);
  });

  it('shows the local page at once when OpenPage is already there', async () => {
    const page = loadNotebookList({ readyState: 'interactive' });
    page.window.OpenPage = { shownTitle: LOCAL_TITLE };
    await page.window.NotebookList.load();
    assert.match(page.els['lyrics-list-items'].innerHTML, new RegExp(LOCAL_TITLE));
  });
});
