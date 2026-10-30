// Scripts move to type="module" from the end of index.html backwards. A module
// runs after every classic script, so one listed after them all runs in the
// same order as before. And since nothing can read a module's top-level names,
// a module that sets nothing on window can't be something another script
// waits for.
//
// The live, limits, invite and extension scripts are the exception: they set
// names that classic scripts read. A classic script reaches them only as
// window.X, so a read before the module runs gets undefined rather than a
// ReferenceError, and storage.js opens pages and coach-tour.js opens the tour
// only after DOMContentLoaded, which waits for the modules.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { APP_SCRIPTS, MODULE_SCRIPTS } from './support/app-scripts.mjs';

const CONVERTED = [
  'limits.js', 'friend-invite.js', 'slot-inputs.js', 'extensions.js',
  'in-app-browser.js', 'account-menu-views.js', 'sample-start.js', 'save-nudge.js',
  'whats-new.js', 'live-core.js', 'live-binding.js', 'live-store.js',
  'live-presence-view.js', 'live.js', 'feedback-box.js', 'back-button.js', 'rail-tips.js',
];
const IMPORT_LINE = /^import \{([^}]+)\} from '\.\/([^']+\.js)';\r?$/gm;
const RETIRED_WINDOW_NAMES = ['closeFeedbackBox'];
// Modules that still set names on window, and the names each one sets.
const WINDOW_SETTERS = {
  'limits.js': ['SiteLimits'],
  'friend-invite.js': ['isTourHeld', 'setInviteOffer'],
  'slot-inputs.js': ['SlotInputs'],
  'extensions.js': ['siteExtensions'],
  'live-core.js': ['LiveCore'],
  'live-binding.js': ['LiveBinding'],
  'live-store.js': ['LiveStore'],
  'live-presence-view.js': ['LivePresenceView'],
  'live.js': ['liveSession', 'Live'],
};
const WINDOW_SET = /\b(?:window|root)\.(\w+)\s*=[^=]/g;

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function namesSetOnWindow(source) {
  return [...source.matchAll(WINDOW_SET)].map(([, name]) => name);
}

// A use like `Live.TEXT` or `liveSession()` with no `window.` in front.
function bareUse(name) {
  return new RegExp(`(?<![.\\w$])${name}\\s*[.([]`);
}

function importsOf(source) {
  return [...source.matchAll(IMPORT_LINE)].map(([, names, file]) => ({
    file, names: names.split(',').map(name => name.trim()),
  }));
}

describe('module scripts', () => {
  it('loads the converted scripts as modules', () => {
    for (const script of CONVERTED) assert.ok(MODULE_SCRIPTS.includes(script), script);
  });

  it('lists every module after every classic script', () => {
    const firstModule = APP_SCRIPTS.findIndex(script => MODULE_SCRIPTS.includes(script));
    assert.deepEqual(APP_SCRIPTS.slice(firstModule), MODULE_SCRIPTS);
  });

  for (const script of MODULE_SCRIPTS) {
    it(`${script} sets only its listed names on window`, () => {
      assert.deepEqual(namesSetOnWindow(readScript(script)), WINDOW_SETTERS[script] || []);
    });

    it(`${script} imports only names another module exports`, () => {
      for (const { file, names } of importsOf(readScript(script))) {
        assert.ok(MODULE_SCRIPTS.includes(file), file);
        const exported = readScript(file);
        for (const name of names) {
          assert.match(exported, new RegExp(`^export (?:async )?(?:function|const) ${name}\\b`, 'm'), name);
        }
      }
    });
  }

  it('reaches retired window names only by import', () => {
    for (const script of APP_SCRIPTS) {
      for (const name of RETIRED_WINDOW_NAMES) {
        assert.doesNotMatch(readScript(script), new RegExp(`window\\.${name}\\b`), script);
      }
    }
  });

  it('classic scripts reach names a module sets only through window', () => {
    const classicScripts = APP_SCRIPTS.filter(script => !MODULE_SCRIPTS.includes(script));
    for (const script of classicScripts) {
      for (const name of Object.values(WINDOW_SETTERS).flat()) {
        assert.doesNotMatch(readScript(script), bareUse(name), `${script}: ${name}`);
      }
    }
  });

  it('storage.js opens pages only after the modules have run', () => {
    const source = readScript('storage.js');
    assert.match(source, /addEventListener\('DOMContentLoaded'/);
    assert.doesNotMatch(source, /document\.readyState/);
  });
});
