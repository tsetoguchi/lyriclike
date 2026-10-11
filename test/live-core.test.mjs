// The pure logic behind live editing. Each case is small enough to check
// by reading it.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import liveCore from '../live-core.js';
import { Y } from './support/live-deps.mjs';

const { applyEdit, diffTextEdit, isMidPair } = liveCore;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function textOf(value) {
  const doc = new Y.Doc();
  const ytext = doc.getText('body');
  ytext.insert(0, value);
  return ytext;
}

// What another person's copy holds after this one's update reaches it.
function roundTrip(ytext) {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(ytext.doc));
  return other.getText('body').toString();
}

describe('diffTextEdit', () => {
  it('returns null when nothing changed', () => {
    assert.equal(diffTextEdit('same', 'same', 2), null);
  });

  it('finds a typed letter', () => {
    assert.deepEqual(diffTextEdit('helo', 'hello', 4), { index: 3, deleteCount: 0, insert: 'l' });
  });

  it('places a letter typed into a run of that letter where it was typed', () => {
    // "hel|lo" plus "l": without the caret the change would be found at 4.
    assert.deepEqual(diffTextEdit('hello', 'helllo', 4), { index: 3, deleteCount: 0, insert: 'l' });
  });

  it('places a backspace in a run where it happened', () => {
    assert.deepEqual(diffTextEdit('helllo', 'hello', 3), { index: 3, deleteCount: 1, insert: '' });
  });

  it('finds a replacement (autocorrect, the rhyme swap)', () => {
    assert.deepEqual(diffTextEdit('teh cat', 'the cat', 3), { index: 1, deleteCount: 2, insert: 'he' });
  });

  it('finds a paste over a selection, keeping letters both words share', () => {
    // "bad" → "good": the shared final "d" stays, so only "ba" → "goo".
    assert.deepEqual(diffTextEdit('a bad day', 'a good day', 6),
      { index: 2, deleteCount: 2, insert: 'goo' });
  });

  it('works with no caret', () => {
    assert.deepEqual(diffTextEdit('abc', 'abXc'), { index: 2, deleteCount: 0, insert: 'X' });
  });

  it('never splits an emoji when one emoji replaces another', () => {
    // 😀 is 😀 and 😁 is 😁: they share the first half.
    const edit = diffTextEdit('a😀b', 'a😁b', 3);
    assert.deepEqual(edit, { index: 1, deleteCount: 2, insert: '😁' });
  });

  it('never splits an emoji when one is typed before another', () => {
    const edit = diffTextEdit('😀', '😁😀', 2);
    assert.equal(LONE_SURROGATE.test(edit.insert), false);
    const ytext = textOf('😀');
    applyEdit(ytext, edit, 'local');
    assert.equal(ytext.toString(), '😁😀');
    assert.equal(roundTrip(ytext), '😁😀');
  });
});

describe('isMidPair', () => {
  it('is true only between the two halves of one character', () => {
    assert.equal(isMidPair('a😀b', 2), true);
    assert.equal(isMidPair('a😀b', 1), false);
    assert.equal(isMidPair('a😀b', 3), false);
  });
});

describe('applyEdit', () => {
  it('applies the edit in one transaction with the given origin', () => {
    const ytext = textOf('teh cat');
    const origins = [];
    ytext.doc.on('afterTransaction', transaction => origins.push(transaction.origin));
    applyEdit(ytext, { index: 1, deleteCount: 2, insert: 'he' }, 'local');
    assert.equal(ytext.toString(), 'the cat');
    assert.deepEqual(origins, ['local']);
  });
});
