// The app's scripts share one global scope. A top-level function named like
// something the live scripts set on window gets replaced by it, which broke
// storage.js once (its liveSession helper became the session object).
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const WINDOW_NAMES = ['liveSession', 'livePage', 'LiveCore', 'LiveBinding', 'LiveStore', 'Live', 'LiveDeps'];
const SCRIPTS = [...readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(match => match[1]);

describe('global names', () => {
  it('lists the app scripts', () => {
    assert.ok(SCRIPTS.includes('storage.js') && SCRIPTS.includes('live.js'));
  });

  for (const script of SCRIPTS) {
    it(`${script} declares no top-level function the live scripts overwrite`, () => {
      const source = readFileSync(new URL(`../${script}`, import.meta.url), 'utf8');
      const declared = [...source.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map(match => match[1]);
      assert.deepEqual(declared.filter(name => WINDOW_NAMES.includes(name)), []);
    });
  }
});
