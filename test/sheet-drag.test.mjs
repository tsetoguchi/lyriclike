// sheet-drag.js: on a phone, a drag down on a word's meaning sheet follows
// the finger and closes it when let go far enough down or flicked; a short
// drag springs back, and a sheet scrolled into its text keeps its scroll.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, mock } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../sheet-drag.js', import.meta.url), 'utf8');
const SHEET_HEIGHT = 300;
const SLOW_MS = 1000;
const SETTLE_MS = 250;

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

function makeElement() {
  return { style: new FakeStyle(), classList: new FakeClassList(), isConnected: true };
}

// options: { isPhone, scrollTop }
function load(options = {}) {
  const { isPhone = true, scrollTop = 0 } = options;
  mock.timers.enable({ apis: ['setTimeout'] });
  const handlers = {};
  const sheet = makeElement();
  sheet.offsetHeight = SHEET_HEIGHT;
  sheet.scrollTop = scrollTop;
  const scrim = makeElement();
  const inside = { closest: selector => (selector === '.def-popup' ? sheet : null) };
  const outside = { closest: () => null };
  const state = { closed: 0 };
  const window = {
    isMobileView: () => isPhone,
    closeDefinition: () => {
      state.closed += 1;
      sheet.isConnected = false;
    },
  };
  const document = {
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
    querySelector: selector => (selector === '.def-overlay' ? scrim : null),
  };
  vm.runInNewContext(SOURCE, { window, document, setTimeout, String, Math });

  // A drag from (0, 0) through moves to [dx, dy], let go at timeStamp `ms`.
  function drag(moves, ms = SLOW_MS, target = inside) {
    const touch = ([x, y]) => ({ clientX: x, clientY: y });
    handlers.touchstart({ touches: [touch([0, 0])], target, timeStamp: 0 });
    let prevented = 0;
    for (const move of moves) {
      handlers.touchmove({ touches: [touch(move)], preventDefault: () => { prevented += 1; } });
    }
    handlers.touchend({ timeStamp: ms });
    return prevented;
  }

  return { window, sheet, scrim, state, drag };
}

describe('isClosedAfterRelease', () => {
  it('closes past a third of the height', () => {
    const { window } = load();
    assert.equal(window.SheetDrag.isClosedAfterRelease({ dy: 101, elapsedMs: SLOW_MS, height: 300 }), true);
    assert.equal(window.SheetDrag.isClosedAfterRelease({ dy: 99, elapsedMs: SLOW_MS, height: 300 }), false);
    mock.timers.reset();
  });

  it('closes on a fast flick down however short', () => {
    const { window } = load();
    assert.equal(window.SheetDrag.isClosedAfterRelease({ dy: 40, elapsedMs: 60, height: 300 }), true);
    mock.timers.reset();
  });

  it('never closes on a drag up', () => {
    const { window } = load();
    assert.equal(window.SheetDrag.isClosedAfterRelease({ dy: -200, elapsedMs: 50, height: 300 }), false);
    mock.timers.reset();
  });
});

describe('dragging the sheet', () => {
  it('follows the finger down and fades the dim to match', () => {
    const { sheet, scrim, drag } = load();
    drag([[0, 20], [0, 150]]);
    // Let go at 150 of 300: past a third, so it slides away.
    assert.equal(sheet.style.transform, 'translateY(100%)');
    assert.equal(scrim.style.opacity, '0');
    mock.timers.reset();
  });

  it('closes the meaning once it has slid away', () => {
    const { state, drag } = load();
    drag([[0, 20], [0, 150]]);
    assert.equal(state.closed, 0);
    mock.timers.tick(SETTLE_MS);
    assert.equal(state.closed, 1);
    mock.timers.reset();
  });

  it('springs back from a short drag', () => {
    const { sheet, scrim, state, drag } = load();
    drag([[0, 20], [0, 60]]);
    mock.timers.tick(SETTLE_MS);
    assert.equal(state.closed, 0);
    assert.equal(sheet.style.transform, undefined);
    assert.equal(scrim.style.opacity, undefined);
    assert.equal(sheet.classList.contains('is-settling'), false);
    mock.timers.reset();
  });

  it('stops the page scrolling while it drags', () => {
    const { drag } = load();
    assert.equal(drag([[0, 20], [0, 60]]), 2);
    mock.timers.reset();
  });

  it('leaves a sheet scrolled into its text to scroll', () => {
    const { sheet, state, drag } = load({ scrollTop: 40 });
    assert.equal(drag([[0, 20], [0, 200]]), 0);
    mock.timers.tick(SETTLE_MS);
    assert.equal(state.closed, 0);
    assert.equal(sheet.style.transform, undefined);
    mock.timers.reset();
  });

  it('leaves a sideways swipe to the tabs and sidebar', () => {
    const { state, drag } = load();
    assert.equal(drag([[30, 5], [200, 10]]), 0);
    mock.timers.tick(SETTLE_MS);
    assert.equal(state.closed, 0);
    mock.timers.reset();
  });

  it('ignores touches off the sheet', () => {
    const { state, drag } = load();
    drag([[0, 20], [0, 200]], SLOW_MS, { closest: () => null });
    mock.timers.tick(SETTLE_MS);
    assert.equal(state.closed, 0);
    mock.timers.reset();
  });

  it('does nothing on a wide screen, where the meaning is a popup', () => {
    const { state, drag } = load({ isPhone: false });
    assert.equal(drag([[0, 20], [0, 200]]), 0);
    mock.timers.tick(SETTLE_MS);
    assert.equal(state.closed, 0);
    mock.timers.reset();
  });
});
