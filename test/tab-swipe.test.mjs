// tab-swipe.js: on a phone, a swipe left on Lyrics opens Rhymes and a swipe
// right on Rhymes goes back. Edge swipes, the open sidebar, the tour,
// sideways scrollers and a text selection all keep their own swipes.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../tab-swipe.js', import.meta.url), 'utf8');

function makeElement(parent = null) {
  return { parentElement: parent, scrollWidth: 100, clientWidth: 100 };
}

// options: { tab, isPhone, isSidebarOpen, isTourOpen, hasSelection, isWideRow }
function startTabs(options = {}) {
  const {
    tab = 'lyrics', isPhone = true, isSidebarOpen = false, isTourOpen = false,
    hasSelection = false, isWideRow = false,
  } = options;
  const mainEl = makeElement();
  mainEl.classList = { contains: name => name === `show-${tab}` };
  const rowEl = makeElement(mainEl);
  if (isWideRow) rowEl.scrollWidth = 400;
  const targetEl = makeElement(rowEl);
  mainEl.contains = node => [mainEl, rowEl, targetEl].includes(node);
  const switched = [];
  const handlers = {};
  const window = {
    matchMedia: () => ({ matches: isPhone }),
    Sidebar: { isOpen: () => isSidebarOpen },
    isCoachTourOpen: () => isTourOpen,
    switchMobileTab: next => switched.push(next),
  };
  const document = {
    querySelector: () => mainEl,
    getElementById: () => ({ selectionStart: 0, selectionEnd: hasSelection ? 4 : 0 }),
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  const getComputedStyle = () => ({ overflowX: 'auto' });
  vm.runInNewContext(SOURCE, { window, document, getComputedStyle });
  return { window, handlers, switched, targetEl };
}

function swipe(tabs, { fromX = 300, toX, dy = 0 }) {
  const touch = (x, y) => ({ clientX: x, clientY: y });
  tabs.handlers.touchstart({ touches: [touch(fromX, 400)], target: tabs.targetEl });
  tabs.handlers.touchend({ changedTouches: [touch(toX, 400 + dy)] });
}

describe('tabAfterSwipe', () => {
  const next = options => startTabs().window.TabSwipe.tabAfterSwipe(options);

  it('opens Rhymes from a swipe left on Lyrics, and goes back from a swipe right', () => {
    assert.equal(next({ tab: 'lyrics', dx: -120, dy: 10 }), 'rhymes');
    assert.equal(next({ tab: 'rhymes', dx: 120, dy: 10 }), 'lyrics');
  });

  it('does nothing the other way, for a short swipe, or a mostly vertical one', () => {
    assert.equal(next({ tab: 'lyrics', dx: 120, dy: 0 }), null);
    assert.equal(next({ tab: 'rhymes', dx: -120, dy: 0 }), null);
    assert.equal(next({ tab: 'lyrics', dx: -40, dy: 0 }), null);
    assert.equal(next({ tab: 'lyrics', dx: -100, dy: 90 }), null);
  });
});

describe('swiping between the tabs', () => {
  it('switches to Rhymes on a swipe left over the words', () => {
    const tabs = startTabs();
    swipe(tabs, { toX: 150 });
    assert.deepEqual(tabs.switched, ['rhymes']);
  });

  it('switches back to Lyrics on a swipe right over the rhymes', () => {
    const tabs = startTabs({ tab: 'rhymes' });
    swipe(tabs, { fromX: 100, toX: 260 });
    assert.deepEqual(tabs.switched, ['lyrics']);
  });

  it('leaves a swipe from the left edge to the sidebar', () => {
    const tabs = startTabs({ tab: 'rhymes' });
    swipe(tabs, { fromX: 10, toX: 200 });
    assert.deepEqual(tabs.switched, []);
  });

  it('does nothing off phones, with the sidebar or tour open, or text selected', () => {
    const cases = [
      { isPhone: false }, { isSidebarOpen: true }, { isTourOpen: true }, { hasSelection: true },
    ];
    for (const options of cases) {
      const tabs = startTabs(options);
      swipe(tabs, { toX: 150 });
      assert.deepEqual(tabs.switched, [], JSON.stringify(options));
    }
  });

  it('leaves a swipe inside a row that scrolls sideways to that row', () => {
    const tabs = startTabs({ isWideRow: true });
    swipe(tabs, { toX: 150 });
    assert.deepEqual(tabs.switched, []);
  });
});
