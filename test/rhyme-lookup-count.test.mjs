// Which rhyme lookups the editor reports, and as what: every tap, and the
// line-above rhymes once per line rather than on every key pressed there.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import rhymeLookupCount from '../rhyme-lookup-count.js';

const { createLookupCounter } = rhymeLookupCount;

const NIGHT_LINE_ABOVE = { isPointerPick: false, isLineAbove: true, word: 'night', start: 10 };

describe('createLookupCounter', () => {
  it('counts a tap on a word as a tap', () => {
    const lookupTrigger = createLookupCounter();
    const pick = { isPointerPick: true, isLineAbove: false, word: 'light', start: 0 };
    assert.equal(lookupTrigger(pick), 'tap');
    assert.equal(lookupTrigger(pick), 'tap');
  });

  it('counts a tap on a blank spot as a tap, though the rhymes are for the line above', () => {
    const lookupTrigger = createLookupCounter();
    assert.equal(lookupTrigger({ ...NIGHT_LINE_ABOVE, isPointerPick: true }), 'tap');
  });

  it('leaves out picks made while typing a word', () => {
    const lookupTrigger = createLookupCounter();
    const typed = { isPointerPick: false, isLineAbove: false, word: 'light', start: 0 };
    assert.equal(lookupTrigger(typed), '');
  });

  it('counts the line-above rhymes once for the same line', () => {
    const lookupTrigger = createLookupCounter();
    assert.equal(lookupTrigger(NIGHT_LINE_ABOVE), 'line_above');
    assert.equal(lookupTrigger(NIGHT_LINE_ABOVE), '');
    assert.equal(lookupTrigger(NIGHT_LINE_ABOVE), '');
  });

  it('counts the line-above rhymes again for the next line', () => {
    const lookupTrigger = createLookupCounter();
    lookupTrigger(NIGHT_LINE_ABOVE);
    assert.equal(lookupTrigger({ ...NIGHT_LINE_ABOVE, start: 30 }), 'line_above');
  });

  it('counts a line ending on the same word as an earlier one', () => {
    const lookupTrigger = createLookupCounter();
    lookupTrigger(NIGHT_LINE_ABOVE);
    assert.equal(lookupTrigger({ ...NIGHT_LINE_ABOVE, start: 40 }), 'line_above');
  });

  it('does not count the same line again after a tap on it from below', () => {
    const lookupTrigger = createLookupCounter();
    lookupTrigger(NIGHT_LINE_ABOVE);
    lookupTrigger({ ...NIGHT_LINE_ABOVE, isPointerPick: true });
    assert.equal(lookupTrigger(NIGHT_LINE_ABOVE), '');
  });

  it('counts the line-above rhymes again after a tap on another word', () => {
    const lookupTrigger = createLookupCounter();
    lookupTrigger(NIGHT_LINE_ABOVE);
    lookupTrigger({ isPointerPick: true, isLineAbove: false, word: 'light', start: 0 });
    assert.equal(lookupTrigger(NIGHT_LINE_ABOVE), 'line_above');
  });
});
