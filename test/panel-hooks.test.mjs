// The extension hooks for the word panel: a tab added beside the rhymes, and
// a word placed in the lyrics. These run the real slot-inputs.js,
// panel-tabs.js and extensions.js against a small fake page.
//
//   node --test test/panel-hooks.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SCRIPTS = ['slot-inputs.js', 'panel-tabs.js', 'extensions.js'];
const PANEL_ID = 'rhymes-panel';
const STRIP_ID = 'panel-tabs';
const BODY_ID = 'panel-tab-body';
const OPEN_CLASS = 'shows-added-tab';
const TAB_CLASS = 'panel-tab';
const LONGEST_WORD = 64;

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

class FakeElement {
  constructor() {
    this.hidden = false;
    this.textContent = '';
    this.className = '';
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  closest(selector) {
    return selector === `.${this.className}` ? this : null;
  }
}

// A page with the word panel, and the app's own word placer stood in.
function loadPage({ hasPlacer = true, placerAnswer = true } = {}) {
  const ids = [PANEL_ID, STRIP_ID, BODY_ID];
  const elements = new Map(ids.map(id => [id, new FakeElement()]));
  const document = new FakeElement();
  document.getElementById = (id) => elements.get(id) || null;
  document.createElement = () => new FakeElement();
  document.head = new FakeElement();
  elements.get(STRIP_ID).hidden = true;
  elements.get(BODY_ID).hidden = true;
  const page = { warnings: [], placed: [] };
  const warn = (...args) => page.warnings.push(args);
  const context = { document, console: { warn } };
  if (hasPlacer) {
    context.placePanelWord = (word, inPlaceOf) => {
      page.placed.push([word, inPlaceOf]);
      return placerAnswer;
    };
  }
  context.window = context;
  vm.createContext(context);
  for (const script of SCRIPTS) vm.runInContext(readScript(script), context);
  page.hooks = context.siteExtensions;
  page.panel = elements.get(PANEL_ID);
  page.strip = elements.get(STRIP_ID);
  page.body = elements.get(BODY_ID);
  page.labels = () => page.strip.children.map(button => button.textContent);
  page.click = (label) => {
    const target = page.strip.children.find(button => button.textContent === label);
    for (const listener of page.strip.listeners.click) listener({ target });
  };
  return page;
}

// A tab that records what the panel asked of it.
function recordingTab(label = 'More') {
  const calls = [];
  return {
    calls,
    tab: {
      label,
      onOpen: (body) => calls.push(['open', body]),
      onClose: () => calls.push(['close']),
    },
  };
}

describe('the word panel tab hook', () => {
  it('hooks report version 11', () => {
    assert.equal(loadPage().hooks.version, 11);
  });

  it('keeps the strip hidden until a tab is added', () => {
    const page = loadPage();
    assert.equal(page.strip.hidden, true);
    page.hooks.addWordPanelTab(recordingTab().tab);
    assert.equal(page.strip.hidden, false);
    assert.deepEqual(page.labels(), ['Rhymes', 'More']);
    assert.equal(page.strip.children[1].className, TAB_CLASS);
  });

  it('opens an added tab into the panel body when it is clicked', () => {
    const page = loadPage();
    const { tab, calls } = recordingTab();
    page.hooks.addWordPanelTab(tab);
    page.click('More');
    assert.deepEqual(calls, [['open', page.body]]);
    assert.equal(page.body.hidden, false);
    assert.equal(page.panel.classList.contains(OPEN_CLASS), true);
    assert.equal(page.strip.children[1].attributes['aria-selected'], 'true');
  });

  it('closes it and shows the rhymes again when Rhymes is clicked', () => {
    const page = loadPage();
    const { tab, calls } = recordingTab();
    page.hooks.addWordPanelTab(tab);
    page.click('More');
    page.click('Rhymes');
    assert.deepEqual(calls.map(call => call[0]), ['open', 'close']);
    assert.equal(page.body.hidden, true);
    assert.equal(page.panel.classList.contains(OPEN_CLASS), false);
  });

  it('opens once when the showing tab is clicked again', () => {
    const page = loadPage();
    const { tab, calls } = recordingTab();
    page.hooks.addWordPanelTab(tab);
    page.click('More');
    page.click('More');
    assert.equal(calls.length, 1);
  });

  it('goes back to the rhymes when the showing tab is removed', () => {
    const page = loadPage();
    const { tab, calls } = recordingTab();
    const remove = page.hooks.addWordPanelTab(tab);
    page.click('More');
    remove();
    remove();
    assert.deepEqual(calls.map(call => call[0]), ['open', 'close']);
    assert.equal(page.strip.hidden, true);
    assert.equal(page.panel.classList.contains(OPEN_CLASS), false);
  });

  it('only warns when a tab throws, and the strip still works', () => {
    const page = loadPage();
    const onOpen = () => { throw new Error('broken tab'); };
    const onClose = () => { throw new Error('broken close'); };
    page.hooks.addWordPanelTab({ label: 'Bad', onOpen, onClose });
    page.click('Bad');
    page.click('Rhymes');
    assert.equal(page.warnings.length, 2);
    assert.equal(page.panel.classList.contains(OPEN_CLASS), false);
  });

  it('refuses a tab it cannot use, with a warning and no strip', () => {
    const page = loadPage();
    assert.equal(page.hooks.addWordPanelTab({ label: 'More' }), null);
    assert.equal(page.warnings.length, 1);
    assert.equal(page.strip.hidden, true);
  });
});

describe('the placed word hook', () => {
  it('passes a trimmed word on, with no word to stand in for', () => {
    const page = loadPage();
    assert.equal(page.hooks.placeWord(' gloomy '), true);
    assert.deepEqual(page.placed, [['gloomy', null]]);
  });

  it('passes on the word it stands in for', () => {
    const page = loadPage();
    page.hooks.placeWord('gloomy', { inPlaceOf: 'Sad' });
    assert.deepEqual(page.placed, [['gloomy', 'Sad']]);
  });

  it('answers false when the page took nothing', () => {
    const page = loadPage({ placerAnswer: false });
    assert.equal(page.hooks.placeWord('gloomy'), false);
  });

  it('refuses what is not one short word, and places nothing', () => {
    const page = loadPage();
    for (const bad of [null, 7, '', 'two\nlines', 'x'.repeat(LONGEST_WORD + 1)]) {
      assert.equal(page.hooks.placeWord(bad), false, String(bad));
    }
    assert.equal(page.hooks.placeWord('gloomy', { inPlaceOf: 'a\nb' }), false);
    assert.deepEqual(page.placed, []);
    assert.equal(page.warnings.length, 6);
  });

  it('answers false on a page with no word placer', () => {
    const page = loadPage({ hasPlacer: false });
    assert.equal(page.hooks.placeWord('gloomy'), false);
  });
});
