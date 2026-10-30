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

const CONVERTED = ['back-button.js', 'rail-tips.js'];

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
      const source = readFileSync(new URL(`../${script}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /\bwindow\.\w+\s*=[^=]/);
    });
  }
});
