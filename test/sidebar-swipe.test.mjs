// sidebar-swipe.js: a drag from the left edge pulls the sliding sidebar out,
// and a drag left on it pushes it back, settling by distance or a flick.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../sidebar-swipe.js', import.meta.url), 'utf8');
const SIDEBAR_WIDTH = 300;
const SLOW_MS = 1000;

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  add(name) {
    this.names.add(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeStyle {
  removeProperty(name) {
    delete this[name];
  }
}

function makeElement(width = 0) {
  const element = { style: new FakeStyle(), classList: new FakeClassList(), offsetWidth: width };
  element.children = [];
  element.contains = node => node === element || element.children.includes(node);
  return element;
}

// options: { isOpen, isDocked, isTourOpen }
function startSwipe({ isOpen = false, isDocked = false, isTourOpen = false } = {}) {
  const sidebarEl = makeElement(SIDEBAR_WIDTH);
  const rowEl = makeElement();
  sidebarEl.children.push(rowEl);
  const scrimEl = makeElement();
  const pageEl = makeElement();
  const handlers = {};
  const calls = [];
  const state = { isOpen };
  const window = {
    Sidebar: {
      isOpen: () => state.isOpen,
      isDocked: () => isDocked,
      show: () => calls.push('show'),
      hide: () => calls.push('hide'),
    },
    isCoachTourOpen: () => isTourOpen,
  };
  const document = {
    body: { classList: new FakeClassList() },
    getElementById: id => ({ sidebar: sidebarEl, 'sidebar-scrim': scrimEl })[id],
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  vm.runInNewContext(SOURCE, { window, document });
  return { window, document, handlers, calls, sidebarEl, rowEl, scrimEl, pageEl };
}

function touchEvent(x, y, timeStamp, target) {
  let isPrevented = false;
  return {
    touches: [{ clientX: x, clientY: y }],
    timeStamp,
    target,
    preventDefault: () => {
      isPrevented = true;
    },
    get isPrevented() {
      return isPrevented;
    },
  };
}

// Drags from (fromX, y) through each x in path, then lets go at endMs.
function drag(swipe, { fromX, path, target, endMs = SLOW_MS, y = 200, dy = 0 }) {
  swipe.handlers.touchstart(touchEvent(fromX, y, 0, target));
  const moves = path.map((x, index) => {
    const move = touchEvent(x, y + dy * (index + 1), (index + 1) * 10, target);
    swipe.handlers.touchmove(move);
    return move;
  });
  swipe.handlers.touchend({ timeStamp: endMs });
  return moves;
}

describe('isOpenAfterRelease', () => {
  const settle = options => startSwipe().window.SidebarSwipe.isOpenAfterRelease(
    { width: SIDEBAR_WIDTH, elapsedMs: SLOW_MS, ...options },
  );

  it('opens past 40% of the width, and not short of it', () => {
    assert.equal(settle({ wasOpen: false, dx: 130 }), true);
    assert.equal(settle({ wasOpen: false, dx: 110 }), false);
  });

  it('closes past 40% back, and stays open short of it', () => {
    assert.equal(settle({ wasOpen: true, dx: -130 }), false);
    assert.equal(settle({ wasOpen: true, dx: -110 }), true);
  });

  it('a fast flick settles its way however short', () => {
    assert.equal(settle({ wasOpen: false, dx: 40, elapsedMs: 50 }), true);
    assert.equal(settle({ wasOpen: true, dx: -40, elapsedMs: 50 }), false);
  });
});

describe('swiping the sidebar', () => {
  it('opens from a drag that starts at the left edge, following the finger', () => {
    const swipe = startSwipe();
    const moves = drag(swipe, { fromX: 5, path: [30, 100, 200], target: swipe.pageEl });
    assert.equal(moves.at(-1).isPrevented, true);
    assert.deepEqual(swipe.calls, ['show']);
    assert.equal(swipe.sidebarEl.style.transform, undefined);
    assert.equal(swipe.document.body.classList.contains('sidebar-dragging'), false);
  });

  it('moves the sidebar with the finger while dragging', () => {
    const swipe = startSwipe();
    swipe.handlers.touchstart(touchEvent(5, 200, 0, swipe.pageEl));
    swipe.handlers.touchmove(touchEvent(105, 200, 10, swipe.pageEl));
    assert.equal(swipe.sidebarEl.style.transform, 'translateX(-200px)');
    assert.equal(swipe.document.body.classList.contains('sidebar-dragging'), true);
  });

  it('ignores a drag that starts away from the edge', () => {
    const swipe = startSwipe();
    const moves = drag(swipe, { fromX: 100, path: [150, 250, 350], target: swipe.pageEl });
    assert.equal(moves.some(move => move.isPrevented), false);
    assert.deepEqual(swipe.calls, []);
  });

  it('leaves a mostly vertical drag to scroll the page', () => {
    const swipe = startSwipe();
    const moves = drag(swipe, { fromX: 5, path: [10, 15, 20], dy: 40, target: swipe.pageEl });
    assert.equal(moves.some(move => move.isPrevented), false);
    assert.deepEqual(swipe.calls, []);
  });

  it('closes from a drag left on the open sidebar', () => {
    const swipe = startSwipe({ isOpen: true });
    drag(swipe, { fromX: 250, path: [200, 100, 50], target: swipe.rowEl });
    assert.deepEqual(swipe.calls, ['hide']);
  });

  it('closes from a drag left on the scrim', () => {
    const swipe = startSwipe({ isOpen: true });
    drag(swipe, { fromX: 350, path: [300, 200, 150], target: swipe.scrimEl });
    assert.deepEqual(swipe.calls, ['hide']);
  });

  it('stays open after a short drag left', () => {
    const swipe = startSwipe({ isOpen: true });
    drag(swipe, { fromX: 250, path: [230, 210], target: swipe.rowEl });
    assert.deepEqual(swipe.calls, ['show']);
  });

  it('takes no swipes while docked or during the tour', () => {
    for (const options of [{ isDocked: true }, { isTourOpen: true }]) {
      const swipe = startSwipe(options);
      drag(swipe, { fromX: 5, path: [100, 200], target: swipe.pageEl });
      assert.deepEqual(swipe.calls, []);
    }
  });
});
