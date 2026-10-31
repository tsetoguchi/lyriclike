// coach-tour.js walks a first-time visitor through the sample. Its rhyme step
// asks them to click a word and moves on once the editor reports the pick.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const TOUR_SOURCE = readFileSync(new URL('../coach-tour.js', import.meta.url), 'utf8');
const VERSE_SOURCE = readFileSync(new URL('../sample-verse.js', import.meta.url), 'utf8');
const START_DELAY_MS = 600;
const VISIBLE_RECT = { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
const RHYMES_PICKED = 'rhymes-picked';

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, isOn) {
    if (isOn) this.names.add(name);
    else this.names.delete(name);
  }
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.style = {};
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.hidden = false;
    this.offsetWidth = 200;
    this.offsetHeight = 100;
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || []).filter((each) => each !== listener);
  }

  fire(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  focus() {}

  querySelectorAll() {
    return [];
  }
}

// A page whose every selector is on screen except those in `hiddenSelectors`.
function loadTour({ isTouch = false } = {}) {
  const els = {};
  const named = ['coach-tour', 'coach-title', 'coach-text', 'coach-back', 'coach-next', 'coach-skip'];
  named.forEach((id) => { els[id] = new FakeElement(); });
  els['coach-tour'].hidden = true;
  const parts = {
    '.coach-spot': new FakeElement(),
    '.coach-steps': new FakeElement(),
    '.coach-card': new FakeElement(),
    '.coach-count': new FakeElement(),
  };
  els['coach-tour'].querySelector = (selector) => parts[selector];
  els['coach-tour'].querySelectorAll = () => [0, 1, 2, 3].map(() => new FakeElement());

  const events = [];
  const timers = [];
  const document = new FakeElement();
  document.getElementById = (id) => els[id];
  document.createElement = () => new FakeElement();
  document.querySelector = (selector) => (selector === '.modal-overlay.open' ? null : new FakeElement());
  document.querySelectorAll = () => [{ getBoundingClientRect: () => VISIBLE_RECT }];
  const sandbox = {
    document,
    window: new FakeElement(),
    localStorage: { getItem: () => null, setItem() {} },
    trackEvent: (name, params) => events.push({ name, params }),
    setTimeout: (callback) => timers.push(callback),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    innerWidth: 1440,
    innerHeight: 900,
    Element: FakeElement,
    HTMLTextAreaElement: class {},
  };
  sandbox.window.matchMedia = () => ({ matches: isTouch });
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(VERSE_SOURCE, sandbox);
  vm.runInContext(TOUR_SOURCE, sandbox);
  return { sandbox, els, parts, events, timers, document };
}

// The tour's timer starts once the modules have run, which DOMContentLoaded
// marks; the await lets that promise's callback land.
async function finishLoading(page) {
  page.document.fire('DOMContentLoaded');
  await Promise.resolve();
  page.timers.forEach((callback) => callback());
}

async function openSampleTour(page) {
  page.sandbox.window.startCoachTour('sample');
  await finishLoading(page);
}

function pressNextUntilTitle(page, title) {
  for (let guard = 0; guard < 12 && page.els['coach-title'].textContent !== title; guard++) {
    page.els['coach-next'].fire('click');
  }
}

describe('the tour start', () => {
  it('waits for the modules before it opens', () => {
    const page = loadTour();
    page.sandbox.window.startCoachTour('sample');
    assert.deepEqual(page.timers, []);
  });

  it('stays shut when an invite link, read by a later module, holds it', async () => {
    const page = loadTour();
    page.sandbox.window.startCoachTour('sample');
    page.sandbox.window.isTourHeld = true;
    await finishLoading(page);
    assert.equal(page.els['coach-tour'].hidden, true);
  });
});

describe('the sample tour rhyme step', () => {
  it('asks for a click and hides Next until it is done', async () => {
    const page = loadTour();
    await openSampleTour(page);
    pressNextUntilTitle(page, 'Try a rhyme');
    assert.equal(page.els['coach-title'].textContent, 'Try a rhyme');
    assert.match(page.els['coach-text'].textContent, /^Click "door" to see what rhymes/);
    assert.equal(page.els['coach-next'].hidden, true);
  });

  it('says tap on a touch screen', async () => {
    const page = loadTour({ isTouch: true });
    await openSampleTour(page);
    pressNextUntilTitle(page, 'Try a rhyme');
    assert.match(page.els['coach-text'].textContent, /^Tap "door"/);
  });

  it('moves on when the editor reports a rhyme pick', async () => {
    const page = loadTour();
    await openSampleTour(page);
    pressNextUntilTitle(page, 'Try a rhyme');
    page.document.fire(RHYMES_PICKED);
    assert.equal(page.els['coach-title'].textContent, 'Rhymes');
    assert.equal(page.els['coach-next'].hidden, false);
  });

  it('ignores a rhyme pick on any other step', async () => {
    const page = loadTour();
    await openSampleTour(page);
    const firstTitle = page.els['coach-title'].textContent;
    page.document.fire(RHYMES_PICKED);
    assert.equal(page.els['coach-title'].textContent, firstTitle);
  });

  it('is not skipped by the right arrow key', async () => {
    const page = loadTour();
    await openSampleTour(page);
    pressNextUntilTitle(page, 'Try a rhyme');
    page.document.fire('keydown', { key: 'ArrowRight', target: {} });
    assert.equal(page.els['coach-title'].textContent, 'Try a rhyme');
  });

  it('takes one step for the numbers and letters, not three', async () => {
    const page = loadTour();
    await openSampleTour(page);
    const stepCount = page.events.find((each) => each.name === 'tour_started').params.steps;
    assert.equal(stepCount, 6);
  });
});

describe('leaving the page mid-tour', () => {
  function tourEnds(page) {
    return page.events.filter((each) => each.name === 'tour_ended');
  }

  it('reports the step the visitor left on', async () => {
    const page = loadTour();
    await openSampleTour(page);
    page.els['coach-next'].fire('click');
    page.sandbox.window.fire('pagehide');
    const ends = tourEnds(page);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].params.trigger, 'left');
    assert.equal(ends[0].params.step, 2);
  });

  it('sends nothing when the tour never opened', () => {
    const page = loadTour();
    page.sandbox.window.fire('pagehide');
    assert.deepEqual(tourEnds(page), []);
  });

  it('sends nothing more after the tour was skipped', async () => {
    const page = loadTour();
    await openSampleTour(page);
    page.els['coach-skip'].fire('click');
    page.sandbox.window.fire('pagehide');
    assert.deepEqual(tourEnds(page).map((each) => each.params.trigger), ['skipped']);
  });
});
