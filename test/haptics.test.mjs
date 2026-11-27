// haptics.js, and the gestures that play it: each moment maps to the right
// system feedback, a drag ticks once per crossing of its line, and the
// website never plays a thing.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, mock } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createHaptics } = require('../haptics.js');

const HAPTICS_SOURCE = readFileSync(new URL('../haptics.js', import.meta.url), 'utf8');
const SIDEBAR_SOURCE = readFileSync(new URL('../sidebar-swipe.js', import.meta.url), 'utf8');
const SHEET_SOURCE = readFileSync(new URL('../sheet-drag.js', import.meta.url), 'utf8');
const HOLD_SOURCE = readFileSync(new URL('../highlights-hold.js', import.meta.url), 'utf8');

const SIDEBAR_WIDTH = 300;
const SHEET_HEIGHT = 300;
const HOLD_MS = 350;
const SLOW_MS = 1000;

// Stands in for @capacitor/haptics and records each call by name.
function fakePlugin() {
  const calls = [];
  const record = name => options => {
    calls.push(options ? `${name}:${Object.values(options)[0]}` : name);
    return Promise.resolve();
  };
  return {
    calls,
    impact: record('impact'),
    notification: record('notification'),
    selectionStart: record('selectionStart'),
    selectionChanged: record('selectionChanged'),
    selectionEnd: record('selectionEnd'),
  };
}

// Counts the moments a gesture asks for, the way haptics.js would see them.
function countingHaptics() {
  const moments = [];
  const haptics = {};
  for (const name of ['tap', 'snap', 'tick', 'startTicks', 'endTicks', 'success', 'error']) {
    haptics[name] = () => moments.push(name);
  }
  const count = name => moments.filter(moment => moment === name).length;
  return { haptics, moments, count };
}

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

describe('createHaptics', () => {
  it('plays each moment as its system feedback', () => {
    const plugin = fakePlugin();
    const haptics = createHaptics({ plugin });
    haptics.tap();
    haptics.snap();
    haptics.success();
    haptics.error();
    assert.deepEqual(plugin.calls, [
      'impact:LIGHT', 'impact:MEDIUM', 'notification:SUCCESS', 'notification:ERROR',
    ]);
  });

  it('runs ticks inside one start and end', () => {
    const plugin = fakePlugin();
    const haptics = createHaptics({ plugin });
    haptics.startTicks();
    haptics.startTicks();
    haptics.tick();
    haptics.tick();
    haptics.endTicks();
    haptics.endTicks();
    assert.deepEqual(plugin.calls, [
      'selectionStart', 'selectionChanged', 'selectionChanged', 'selectionEnd',
    ]);
  });

  it('starts the ticks itself when a tick comes first', () => {
    const plugin = fakePlugin();
    const haptics = createHaptics({ plugin });
    haptics.tick();
    assert.deepEqual(plugin.calls, ['selectionStart', 'selectionChanged']);
  });

  it('never throws, whether the plugin throws, refuses or is missing', async () => {
    const throwing = {
      impact: () => { throw new Error('no engine'); },
      notification: () => Promise.reject(new Error('refused')),
    };
    const haptics = createHaptics({ plugin: throwing });
    haptics.tap();
    haptics.error();
    haptics.tick();
    const none = createHaptics({ plugin: null });
    none.tap();
    none.tick();
    assert.equal(none.isAvailable, false);
    // Lets a refused promise settle, so an unhandled one would fail the run.
    await new Promise(resolve => setImmediate(resolve));
  });
});

// Runs haptics.js as the page does, with `Capacitor` as given.
function runOnPage(Capacitor, elements = {}) {
  const document = {
    readyState: 'complete',
    getElementById: id => elements[id] || null,
    addEventListener: () => {},
  };
  const context = vm.createContext({ document, console, Promise });
  if (Capacitor) context.Capacitor = Capacitor;
  vm.runInContext('globalThis = this;', context);
  vm.runInContext(HAPTICS_SOURCE, context, { filename: 'haptics.js' });
  return context;
}

function playEverything(haptics) {
  haptics.tap();
  haptics.snap();
  haptics.startTicks();
  haptics.tick();
  haptics.endTicks();
  haptics.success();
  haptics.error();
}

describe('haptics.js on the page', () => {
  it('plays nothing on the website, where there is no Capacitor', () => {
    const context = runOnPage(null);
    assert.equal(context.AppHaptics.isAvailable, false);
    playEverything(context.AppHaptics);
  });

  it('plays nothing on the website even if the plugin is present', () => {
    const plugin = fakePlugin();
    const Capacitor = { isNativePlatform: () => false, Plugins: { Haptics: plugin } };
    const context = runOnPage(Capacitor);
    playEverything(context.AppHaptics);
    assert.deepEqual(plugin.calls, []);
  });

  it('plays through the plugin in the app', () => {
    const plugin = fakePlugin();
    const Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Haptics: plugin },
    };
    const context = runOnPage(Capacitor);
    context.AppHaptics.snap();
    assert.deepEqual(plugin.calls, ['impact:MEDIUM']);
  });

});

function makeSidebarElement(width = 0) {
  const element = { style: new FakeStyle(), classList: new FakeClassList(), offsetWidth: width };
  element.contains = node => node === element;
  return element;
}

// A shut sidebar on the screen's left edge, with haptics counted.
function loadSidebar({ isOpen = false, withHaptics = true } = {}) {
  const sidebarEl = makeSidebarElement(SIDEBAR_WIDTH);
  const scrimEl = makeSidebarElement();
  const handlers = {};
  const counter = countingHaptics();
  const window = {
    Sidebar: { isOpen: () => isOpen, isDocked: () => false, show: () => {}, hide: () => {} },
    isCoachTourOpen: () => false,
  };
  if (withHaptics) window.AppHaptics = counter.haptics;
  const document = {
    body: { classList: new FakeClassList() },
    getElementById: id => ({ sidebar: sidebarEl, 'sidebar-scrim': scrimEl })[id],
    addEventListener: (type, handler) => { handlers[type] = handler; },
  };
  vm.runInNewContext(SIDEBAR_SOURCE, { window, document });

  // Starts on the edge (or on the open sidebar) and moves through each x.
  function drag(xs, ms = SLOW_MS) {
    const target = isOpen ? sidebarEl : {};
    const startX = isOpen ? SIDEBAR_WIDTH : 5;
    handlers.touchstart({ touches: [{ clientX: startX, clientY: 100 }], target, timeStamp: 0 });
    for (const x of xs) {
      handlers.touchmove({ touches: [{ clientX: x, clientY: 100 }], preventDefault: () => {} });
    }
    handlers.touchend({ timeStamp: ms });
  }
  return { ...counter, drag };
}

describe('sidebar swipe haptics', () => {
  // The line is 40% of 300 = 120px of travel; the drag starts at x = 5.
  it('ticks once as an opening drag crosses the line', () => {
    const sidebar = loadSidebar();
    sidebar.drag([30, 80, 130, 200, 250]);
    assert.equal(sidebar.count('tick'), 1);
  });

  it('ticks again after backing over the line and crossing it once more', () => {
    const sidebar = loadSidebar();
    sidebar.drag([30, 200, 60, 40, 200, 220]);
    assert.equal(sidebar.count('tick'), 2);
  });

  it('stays silent when the drag never reaches the line', () => {
    const sidebar = loadSidebar();
    sidebar.drag([30, 80, 110]);
    assert.equal(sidebar.count('tick'), 0);
  });

  it('ticks as a closing drag crosses its line', () => {
    const sidebar = loadSidebar({ isOpen: true });
    sidebar.drag([280, 200, 150, 100]);
    assert.equal(sidebar.count('tick'), 1);
  });

  it('readies the ticks when the drag begins and ends them on letting go', () => {
    const sidebar = loadSidebar();
    sidebar.drag([30, 200]);
    assert.deepEqual(sidebar.moments, ['startTicks', 'tick', 'endTicks']);
  });

  it('plays nothing for a tap that never drags', () => {
    const sidebar = loadSidebar();
    sidebar.drag([]);
    assert.deepEqual(sidebar.moments, []);
  });

  it('still swipes when haptics.js is missing', () => {
    const sidebar = loadSidebar({ withHaptics: false });
    assert.doesNotThrow(() => sidebar.drag([30, 200]));
  });
});

// A word's meaning sheet with haptics counted.
function loadSheet() {
  // A test that failed may have left the fake clock on.
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  const handlers = {};
  const sheet = { style: new FakeStyle(), classList: new FakeClassList(), isConnected: true };
  sheet.offsetHeight = SHEET_HEIGHT;
  sheet.scrollTop = 0;
  const inside = { closest: selector => (selector === '.def-popup' ? sheet : null) };
  const counter = countingHaptics();
  const window = {
    isMobileView: () => true,
    closeDefinition: () => { sheet.isConnected = false; },
    AppHaptics: counter.haptics,
  };
  const document = {
    addEventListener: (type, handler) => { handlers[type] = handler; },
    querySelector: () => null,
  };
  vm.runInNewContext(SHEET_SOURCE, { window, document, setTimeout, String, Math });

  function drag(ys, ms = SLOW_MS) {
    handlers.touchstart({ touches: [{ clientX: 0, clientY: 0 }], target: inside, timeStamp: 0 });
    for (const y of ys) {
      handlers.touchmove({ touches: [{ clientX: 0, clientY: y }], preventDefault: () => {} });
    }
    handlers.touchend({ timeStamp: ms });
  }
  return { ...counter, drag };
}

describe('meaning sheet haptics', () => {
  // The line is a third of 300 = 100px down.
  it('ticks once as the drag crosses the closing line', () => {
    const sheet = loadSheet();
    sheet.drag([20, 60, 110, 180, 250]);
    assert.equal(sheet.count('tick'), 1);
    mock.timers.reset();
  });

  it('ticks again after going back up over the line and down once more', () => {
    const sheet = loadSheet();
    sheet.drag([20, 150, 170, 50, 30, 160, 200]);
    assert.equal(sheet.count('tick'), 2);
    mock.timers.reset();
  });

  it('stays silent on a short drag that springs back', () => {
    const sheet = loadSheet();
    sheet.drag([20, 60, 90]);
    assert.equal(sheet.count('tick'), 0);
    assert.deepEqual(sheet.moments, ['startTicks', 'endTicks']);
    mock.timers.reset();
  });
});

function makeHoldElement() {
  const handlers = {};
  const names = new Set();
  return {
    handlers,
    clicks: 0,
    classList: { add: n => names.add(n), remove: n => names.delete(n), contains: n => names.has(n) },
    addEventListener: (type, handler) => { handlers[type] = handler; },
  };
}

// The Highlights button with two overlays in its menu, haptics counted.
function loadHold() {
  // A test that failed may have left the fake clock on.
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  const buttonEl = makeHoldElement();
  const popoverEl = makeHoldElement();
  const items = [makeHoldElement(), makeHoldElement()];
  for (const item of items) {
    item.closest = () => item;
    item.click = () => { item.clicks += 1; };
  }
  popoverEl.contains = node => items.includes(node);
  const state = { isOpen: false, pointAt: null };
  const counter = countingHaptics();
  const window = {
    isRhymesMenuOpen: () => state.isOpen,
    setRhymesMenuOpen: isOpen => {
      // The snap must already have played when the menu shows.
      if (isOpen) state.snapsBeforeOpen = counter.count('snap');
      state.isOpen = isOpen;
    },
    AppHaptics: counter.haptics,
  };
  const document = {
    getElementById: id => ({ 'rhymes-menu-btn': buttonEl, 'rhymes-menu-popover': popoverEl })[id],
    elementFromPoint: () => state.pointAt,
  };
  vm.runInNewContext(HOLD_SOURCE, { window, document, setTimeout, clearTimeout, Math });
  const pointer = (x, y, timeStamp = 0) => ({
    clientX: x, clientY: y, timeStamp, pointerType: 'touch', stopImmediatePropagation: () => {},
  });
  return { ...counter, buttonEl, items, state, pointer };
}

describe('Highlights hold haptics', () => {
  it('snaps once, in the same turn the menu opens', () => {
    const hold = loadHold();
    hold.buttonEl.handlers.pointerdown(hold.pointer(100, 600));
    mock.timers.tick(HOLD_MS - 1);
    assert.equal(hold.count('snap'), 0);
    mock.timers.tick(1);
    assert.equal(hold.count('snap'), 1);
    assert.equal(hold.state.snapsBeforeOpen, 1);
    mock.timers.reset();
  });

  it('ticks each time the finger slides onto another overlay, not on every move', () => {
    const hold = loadHold();
    const { handlers } = hold.buttonEl;
    handlers.pointerdown(hold.pointer(100, 600));
    mock.timers.tick(HOLD_MS);
    hold.state.pointAt = hold.items[0];
    handlers.pointermove(hold.pointer(100, 500));
    handlers.pointermove(hold.pointer(101, 499));
    handlers.pointermove(hold.pointer(102, 498));
    hold.state.pointAt = null;
    handlers.pointermove(hold.pointer(100, 470));
    hold.state.pointAt = hold.items[1];
    handlers.pointermove(hold.pointer(100, 450));
    hold.state.pointAt = hold.items[0];
    handlers.pointermove(hold.pointer(100, 500));
    assert.equal(hold.count('tick'), 3);
    handlers.pointerup(hold.pointer(100, 500, 1000));
    assert.equal(hold.items[0].clicks, 1);
    assert.equal(hold.count('endTicks'), 1);
    mock.timers.reset();
  });

  it('plays only the readying for a quick tap', () => {
    const hold = loadHold();
    hold.buttonEl.handlers.pointerdown(hold.pointer(100, 600));
    mock.timers.tick(100);
    hold.buttonEl.handlers.pointerup(hold.pointer(100, 600, 100));
    assert.deepEqual(hold.moments, ['startTicks', 'endTicks']);
    mock.timers.reset();
  });

  it('plays nothing more once the finger wanders off before the hold', () => {
    const hold = loadHold();
    hold.buttonEl.handlers.pointerdown(hold.pointer(100, 600));
    hold.buttonEl.handlers.pointermove(hold.pointer(100, 640));
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(hold.moments, ['startTicks', 'endTicks']);
    mock.timers.reset();
  });
});
