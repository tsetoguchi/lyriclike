// The room, the browser bundle and these tests must all run the same
// versions, so they are pinned exactly.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { Y, newDmp } from './support/live-deps.mjs';

const PINNED = {
  yjs: '13.6.33',
  'y-protocols': '1.0.7',
  lib0: '0.2.117',
  'diff-match-patch': '1.0.5',
};

const manifest = JSON.parse(readFileSync(new URL('../collab/package.json', import.meta.url)));

describe('live dependencies', () => {
  it('pins every version exactly', () => {
    assert.deepEqual(manifest.dependencies, PINNED);
  });

  it('loads Yjs and diff-match-patch', () => {
    const doc = new Y.Doc();
    doc.getText('body').insert(0, 'hello');
    assert.equal(doc.getText('body').toString(), 'hello');
    assert.equal(newDmp().diff_main('a', 'b').length, 2);
  });
});
