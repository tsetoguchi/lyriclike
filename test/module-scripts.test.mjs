// Scripts move to type="module" from the end of index.html backwards. A module
// runs after every classic script, so one listed after them all runs in the
// same order as before. And since nothing can read a module's top-level names,
// a module that sets nothing on window can't be something another script
// waits for.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { APP_SCRIPTS, MODULE_SCRIPTS } from './support/app-scripts.mjs';

const CONVERTED = ['feedback-box.js', 'back-button.js', 'rail-tips.js'];
const IMPORT_LINE = /^import \{([^}]+)\} from '\.\/([^']+\.js)';\r?$/gm;
const RETIRED_WINDOW_NAMES = ['closeFeedbackBox'];

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
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
    it(`${script} sets nothing on window`, () => {
      assert.doesNotMatch(readScript(script), /\bwindow\.\w+\s*=[^=]/);
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
});
