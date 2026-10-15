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

// sharing.js can be served fresh while a cached storage.js is older (both are
// no-cache, but a tab can hold one stale). Names storage.js added for live
// editing are only read behind a typeof guard there, so a stale storage.js
// cannot throw a ReferenceError in the poll.
const STORAGE_LIVE_NAMES = ['isLiveDraft', 'goLiveFromRest', 'goLiveAfterShare'];

describe('sharing.js and newer storage.js names', () => {
  const lines = readFileSync(new URL('../sharing.js', import.meta.url), 'utf8').split('\n');
  for (const name of STORAGE_LIVE_NAMES) {
    it(`reads ${name} only behind a typeof guard`, () => {
      const unguarded = lines.filter(line => line.includes(name) && !line.includes(`typeof ${name}`));
      assert.deepEqual(unguarded, []);
    });
  }
});
