// highlights-hold.js: holding Highlights opens its menu, sliding onto an
// overlay and letting go switches it and shuts the menu, and a quick tap is
// left to app.js.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, mock } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../highlights-hold.js', import.meta.url), 'utf8');
const HOLD_MS = 350;

function makeElement() {
  const handlers = {};
  const names = new Set();
  return {
    handlers,
    clicks: 0,
    classList: {
      add: name => names.add(name),
      remove: name => names.delete(name),
      contains: name => names.has(name),
    },
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
}

function startHold() {
  mock.timers.enable({ apis: ['setTimeout'] });
  const buttonEl = makeElement();
  const popoverEl = makeElement();
  const itemEl = makeElement();
  itemEl.closest = () => itemEl;
  itemEl.click = () => {
    itemEl.clicks += 1;
  };
  popoverEl.contains = node => node === itemEl;
  const state = { isOpen: false, pointAt: null };
  const window = {
    isRhymesMenuOpen: () => state.isOpen,
    setRhymesMenuOpen: isOpen => {
      state.isOpen = isOpen;
    },
  };
  const document = {
    getElementById: id => ({ 'rhymes-menu-btn': buttonEl, 'rhymes-menu-popover': popoverEl })[id],
    elementFromPoint: () => state.pointAt,
  };
  vm.runInNewContext(SOURCE, { window, document, setTimeout, clearTimeout, Math });
  return { buttonEl, itemEl, state };
}

function pointer(x, y, timeStamp = 0, pointerType = 'touch') {
  let isStopped = false;
  return {
    clientX: x, clientY: y, timeStamp, pointerType,
    stopImmediatePropagation: () => {
      isStopped = true;
    },
    get isStopped() {
      return isStopped;
    },
  };
}

describe('holding Highlights', () => {
  it('opens the menu once held', () => {
    const hold = startHold();
    hold.buttonEl.handlers.pointerdown(pointer(100, 600));
    mock.timers.tick(HOLD_MS - 50);
    assert.equal(hold.state.isOpen, false);
    mock.timers.tick(50);
    assert.equal(hold.state.isOpen, true);
    mock.timers.reset();
  });

  it('switches the overlay let go on, and shuts the menu', () => {
    const hold = startHold();
    hold.buttonEl.handlers.pointerdown(pointer(100, 600));
    mock.timers.tick(HOLD_MS);
    hold.state.pointAt = hold.itemEl;
    hold.buttonEl.handlers.pointermove(pointer(100, 500));
    assert.equal(hold.itemEl.classList.contains('is-picking'), true);
    hold.buttonEl.handlers.pointerup(pointer(100, 500, 1000));
    assert.equal(hold.itemEl.clicks, 1);
    assert.equal(hold.itemEl.classList.contains('is-picking'), false);
    assert.equal(hold.state.isOpen, false);
    mock.timers.reset();
  });

  it('keeps the menu open when let go off the overlays, and eats the click', () => {
    const hold = startHold();
    hold.buttonEl.handlers.pointerdown(pointer(100, 600));
    mock.timers.tick(HOLD_MS);
    hold.buttonEl.handlers.pointerup(pointer(100, 600, 1000));
    const click = pointer(100, 600, 1010);
    hold.buttonEl.handlers.click(click);
    assert.equal(click.isStopped, true);
    assert.equal(hold.state.isOpen, true);
    assert.equal(hold.itemEl.clicks, 0);
    mock.timers.reset();
  });

  it('leaves a quick tap to the button', () => {
    const hold = startHold();
    hold.buttonEl.handlers.pointerdown(pointer(100, 600));
    mock.timers.tick(100);
    hold.buttonEl.handlers.pointerup(pointer(100, 600, 100));
    const click = pointer(100, 600, 110);
    hold.buttonEl.handlers.click(click);
    assert.equal(click.isStopped, false);
    mock.timers.tick(HOLD_MS);
    assert.equal(hold.state.isOpen, false);
    mock.timers.reset();
  });

  it('drops a press that moves before the menu opens, and mouse presses', () => {
    for (const [down, move] of [[pointer(100, 600), pointer(100, 560)],
      [pointer(100, 600, 0, 'mouse'), pointer(100, 600)]]) {
      const hold = startHold();
      hold.buttonEl.handlers.pointerdown(down);
      hold.buttonEl.handlers.pointermove(move);
      mock.timers.tick(HOLD_MS);
      assert.equal(hold.state.isOpen, false);
      mock.timers.reset();
    }
  });
});
