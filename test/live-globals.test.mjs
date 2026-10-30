// The app's scripts share one global scope. A top-level function named like
// something the live scripts set on window gets replaced by it, which broke
// storage.js once (its liveSession helper became the session object).
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const WINDOW_NAMES = [
  'liveSession', 'livePage', 'LiveCore', 'LiveBinding', 'LiveStore', 'Live', 'LiveDeps',
  'LivePresence', 'LivePresenceView',
];
const SCRIPTS = [...readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(match => match[1]);

describe('global names', () => {
  it('lists the app scripts', () => {
    assert.ok(SCRIPTS.includes('storage.js') && SCRIPTS.includes('live.js'));
  });

  it('storage.js declares each new lock helper once', () => {
    const source = readFileSync(new URL('../storage.js', import.meta.url), 'utf8');
    for (const name of ['lockEditor', 'unlockEditor', 'setEditorReadOnly']) {
      const declarations = source.split('\n').filter(line => line.startsWith(`function ${name}(`));
      assert.equal(declarations.length, 1, name);
    }
    assert.doesNotMatch(source, /isLockedWithoutSession|lockWithoutLiveSession/);
  });

  it('loads the presence scripts before live.js', () => {
    const at = name => SCRIPTS.indexOf(name);
    assert.ok(at('live-presence.js') > -1 && at('live-presence.js') < at('live-presence-view.js'));
    assert.ok(at('live-presence-view.js') < at('live.js'));
  });

  for (const script of SCRIPTS) {
    it(`${script} declares no top-level function the live scripts overwrite`, () => {
      const source = readFileSync(new URL(`../${script}`, import.meta.url), 'utf8');
      const declared = [...source.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map(match => match[1]);
      assert.deepEqual(declared.filter(name => WINDOW_NAMES.includes(name)), []);
    });
  }
});

describe('short names outside the presence scripts', () => {
  for (const script of ['notebook-list.js', 'sharing.js']) {
    it(`${script} shortens names through window.LivePresence, guarded`, () => {
      const source = readFileSync(new URL(`../${script}`, import.meta.url), 'utf8');
      assert.match(source, /window\.LivePresence \? window\.LivePresence\.shortNameOf\(/);
      assert.doesNotMatch(source, /(^|[^.])LivePresence\.shortNameOf/m);
    });
  }
});
