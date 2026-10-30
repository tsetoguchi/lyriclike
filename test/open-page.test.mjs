// The open page's state lives in storage.js and other scripts reach it only
// through window.OpenPage. These checks read the sources, since storage.js
// needs a browser to run.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const STORAGE_STATE_NAMES = [
  'currentLyricId', 'currentTitle', 'currentRevision', 'currentPageInfo', 'lastSavedBody',
  'saveInFlight', 'pendingConflict', 'isLiveDraft',
];
const CALLERS = ['sharing.js', 'extensions.js', 'auth.js', 'save-nudge.js'];

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function openPageKeys() {
  const source = readScript('storage.js');
  const start = source.indexOf('window.OpenPage = {');
  const body = source.slice(start, source.indexOf('\n};', start));
  return new Set([...body.matchAll(/^ {2}(?:get )?(\w+)/gm)].map(match => match[1]));
}

function namesUsed(source) {
  const members = [...source.matchAll(/\b(?:openPage|OpenPage)\.(\w+)/g)].map(match => match[1]);
  const hooks = [...source.matchAll(/pageFunction\('(\w+)', root\.OpenPage\)/g)]
    .map(match => match[1]);
  return [...members, ...hooks];
}

describe('OpenPage', () => {
  const keys = openPageKeys();

  it('is found in storage.js', () => {
    assert.ok(keys.has('id') && keys.has('clear'));
  });

  it('sees the extension hook reach it', () => {
    assert.ok(namesUsed(readScript('extensions.js')).includes('summary'));
  });

  for (const script of CALLERS) {
    it(`${script} uses only names OpenPage has`, () => {
      const missing = namesUsed(readScript(script)).filter(name => !keys.has(name));
      assert.deepEqual(missing, []);
    });

    it(`${script} reads none of storage.js's page state directly`, () => {
      const source = readScript(script);
      const read = STORAGE_STATE_NAMES.filter(name => new RegExp(`(?<![.\\w])${name}\\b`).test(source));
      assert.deepEqual(read, []);
    });
  }
});
