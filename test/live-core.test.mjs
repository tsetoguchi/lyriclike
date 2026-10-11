// The pure logic behind live editing. Each case is small enough to check
// by reading it.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import liveCore from '../live-core.js';
import { Y, newDmp } from './support/live-deps.mjs';

const {
  applyEdit, applyEdits, diffTextEdit, isMidPair, mapSelection, mergeTitle, minimalEdits, rebase,
  UNPLACED_SEPARATOR,
} = liveCore;

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

describe('mapSelection', () => {
  const caret = position => ({ start: position, end: position });

  it('shifts past an insert before it', () => {
    assert.deepEqual(mapSelection(caret(5), [{ insert: 'abc' }]), caret(8));
  });

  it('stays put for an insert exactly at it', () => {
    assert.deepEqual(mapSelection(caret(5), [{ retain: 5 }, { insert: 'abc' }]), caret(5));
  });

  it('ignores an insert after it', () => {
    assert.deepEqual(mapSelection(caret(5), [{ retain: 7 }, { insert: 'abc' }]), caret(5));
  });

  it('moves back for a delete before it', () => {
    assert.deepEqual(mapSelection(caret(5), [{ retain: 1 }, { delete: 2 }]), caret(3));
  });

  it('collapses onto a delete that spans it', () => {
    assert.deepEqual(mapSelection(caret(5), [{ retain: 3 }, { delete: 4 }]), caret(3));
  });

  it('collapses a selection inside deleted text', () => {
    assert.deepEqual(mapSelection({ start: 4, end: 6 }, [{ retain: 2 }, { delete: 6 }]),
      { start: 2, end: 2 });
  });

  it('maps each end of a selection on its own', () => {
    const delta = [{ retain: 2 }, { insert: 'xx' }, { retain: 4 }, { delete: 1 }];
    assert.deepEqual(mapSelection({ start: 3, end: 9 }, delta), { start: 5, end: 10 });
  });
});

// A small seeded generator, so a failing case can be replayed.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ['a', 'b', ' ', '\n', 'la', '😀', '😁', '鈴', 'é'];

function randomText(random, length) {
  let text = '';
  while (text.length < length) text += PIECES[Math.floor(random() * PIECES.length)];
  return text;
}

describe('minimalEdits', () => {
  it('returns no edits for equal texts', () => {
    assert.deepEqual(minimalEdits(newDmp(), 'same', 'same'), []);
  });

  it('turns one text into the other', () => {
    const ytext = textOf('the quick brown fox');
    applyEdits(ytext, minimalEdits(newDmp(), 'the quick brown fox', 'a quick red fox'), 'merge');
    assert.equal(ytext.toString(), 'a quick red fox');
  });

  it('makes two small edits for two distant changes in a long page', () => {
    const middle = 'line of lyrics\n'.repeat(13_000);
    const from = `start\n${middle}end\n`;
    const to = `START\n${middle}END\n`;
    const edits = minimalEdits(newDmp(), from, to);
    assert.equal(edits.length, 2);
    for (const edit of edits) assert.ok(edit.deleteCount <= 5 && edit.insert.length <= 5);
  });

  it('never splits an emoji, so every copy agrees (fuzz)', () => {
    const random = seededRandom(7);
    for (let round = 0; round < 300; round += 1) {
      const from = randomText(random, 20);
      const to = randomText(random, 20);
      const ytext = textOf(from);
      const edits = minimalEdits(newDmp(), from, to);
      for (const edit of edits) assert.equal(LONE_SURROGATE.test(edit.insert), false, `${from} → ${to}`);
      applyEdits(ytext, edits, 'merge');
      assert.equal(ytext.toString(), to, `${from} → ${to}`);
      assert.equal(roundTrip(ytext), to, `${from} → ${to}`);
    }
  });
});

describe('rebase', () => {
  it('keeps both sides when they changed different lines', () => {
    const base = 'one\ntwo\nthree\n';
    const theirs = 'ONE\ntwo\nthree\n';
    const ours = 'one\ntwo\nTHREE\n';
    assert.deepEqual(rebase(newDmp(), base, theirs, ours), { text: 'ONE\ntwo\nTHREE\n', unplaced: [] });
  });

  it('is a plain copy when nothing else changed', () => {
    assert.deepEqual(rebase(newDmp(), 'a', 'ab', 'a'), { text: 'ab', unplaced: [] });
  });

  it('adds every word of a change to an empty page', () => {
    assert.deepEqual(rebase(newDmp(), '', 'new words', ''), { text: 'new words', unplaced: [] });
  });

  it('puts words that no longer fit at the end instead of losing them', () => {
    const base = 'the old verse about the rain\n';
    const changed = 'the old verse about the rain and the river\n';
    // Shares no letters with the patch's context, so no fuzzy match is found.
    const onto = 'qqqq qqqq\n';
    const { text, unplaced } = rebase(newDmp(), base, changed, onto);
    assert.deepEqual(unplaced, [' and the river']);
    assert.equal(text, `${onto}${UNPLACED_SEPARATOR} and the river`);
  });

  it('ignores a delete that no longer fits, since no words are lost', () => {
    const { text, unplaced } = rebase(newDmp(), 'remove this line\n', '', 'something else\n');
    assert.deepEqual(unplaced, []);
    assert.equal(text, 'something else\n');
  });
});

describe('rebase strictness', () => {
  it('still applies a delete when a co-writer changed the line beside it', () => {
    const base = 'verse one\nbad line\nverse two\n';
    const changed = 'verse one\nverse two\n';
    const onto = 'verse ONE\nbad line\nverse two\n';
    assert.deepEqual(rebase(newDmp(), base, changed, onto), { text: 'verse ONE\nverse two\n', unplaced: [] });
  });

  it("leaves the caller's matcher settings as they were", () => {
    const dmp = newDmp();
    rebase(dmp, 'remove this line\n', '', 'something else\n');
    assert.equal(dmp.Match_Threshold, 0.5);
    assert.equal(dmp.Patch_DeleteThreshold, 0.5);
  });
});

describe('mergeTitle', () => {
  it('takes the outside rename when the room did not rename', () => {
    assert.equal(mergeTitle('Draft', 'Draft', 'Rain Song'), 'Rain Song');
  });

  it('keeps the room rename when the room renamed since its last write', () => {
    assert.equal(mergeTitle('Draft', 'River Song', 'Rain Song'), 'River Song');
  });
});
