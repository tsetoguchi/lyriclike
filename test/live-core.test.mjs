// The pure logic behind live editing. Each case is small enough to check
// by reading it.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import liveCore from '../live-core.js';
import { Y, newDmp } from './support/live-deps.mjs';

const {
  applyEdit, applyEdits, diffTextEdit, isMidPair, isUpdateSaved, mapSelection, mergeTitle,
  minimalEdits, rebase,
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

  it("does not grow a selection over words a co-writer typed at its start", () => {
    // "the rain falls" with "rain" selected; "cold " arrives at index 4.
    assert.deepEqual(mapSelection({ start: 4, end: 8 }, [{ retain: 4 }, { insert: 'cold ' }]),
      { start: 9, end: 13 });
  });

  it("does not grow a selection over words a co-writer typed at its end", () => {
    assert.deepEqual(mapSelection({ start: 4, end: 8 }, [{ retain: 8 }, { insert: ' down' }]),
      { start: 4, end: 8 });
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
    assert.equal(rebase(Y, newDmp(), base, theirs, ours), 'ONE\ntwo\nTHREE\n');
  });

  it('is a plain copy when nothing else changed', () => {
    assert.equal(rebase(Y, newDmp(), 'a', 'ab', 'a'), 'ab');
  });

  it('adds every word of a change to an empty page', () => {
    assert.equal(rebase(Y, newDmp(), '', 'new words', ''), 'new words');
  });

  it("puts the co-writer's words first when both wrote at the same spot", () => {
    assert.equal(rebase(Y, newDmp(), '', 'hello', 'existing'), 'existinghello');
  });

  it('keeps a word the co-writer added inside a line that was deleted', () => {
    const base = 'verse one\nthe rain falls down\nverse two\n';
    const changed = 'verse one\nverse two\n';
    const onto = 'verse one\nthe cold rain falls down\nverse two\n';
    assert.match(rebase(Y, newDmp(), base, changed, onto), /cold/);
  });

  it('keeps a line the co-writer added inside a long deleted stanza', () => {
    const base = 'intro\nfirst line of the stanza here\nsecond line of the stanza\noutro\n';
    const changed = 'intro\noutro\n';
    const onto = 'intro\nfirst line of the stanza here\nB WROTE THIS\nsecond line of the stanza\noutro\n';
    assert.match(rebase(Y, newDmp(), base, changed, onto), /B WROTE THIS/);
  });

  it('places a change correctly after the co-writer added a verse above', () => {
    const base = 'verse one line\nchorus goes here\nlast line of song\n';
    const changed = 'verse one line\nchorus goes here NEW WORDS\nlast line of song\n';
    const added = 'a brand new verse the co-writer wrote at the top\n'.repeat(6);
    const onto = added + base;
    assert.equal(rebase(Y, newDmp(), base, changed, onto), added + changed);
  });

  it('applies a delete after the co-writer added a verse above', () => {
    const base = 'keep\nbad line\nkeep too\n';
    const added = 'a brand new verse the co-writer wrote at the top\n'.repeat(6);
    assert.equal(rebase(Y, newDmp(), base, 'keep\nkeep too\n', added + base), `${added}keep\nkeep too\n`);
  });

  it('keeps every word the co-writer wrote over a line that was deleted', () => {
    // Only whole words are compared, so no letter of theirs can be taken for
    // an old one and deleted with it. A shared space or line break may go.
    const result = rebase(Y, newDmp(), 'remove this line\n', '', 'something else\n');
    assert.match(result, /^something else\n?$/);
  });

  it('keeps whole words when a co-writer reworded a line that was deleted', () => {
    const result = rebase(Y, newDmp(), 'the rain falls\n', '', 'then sun rises\n');
    for (const word of ['then', 'sun', 'rises']) assert.match(result, new RegExp(`\\b${word}\\b`));
  });

  it('never loses or cuts a word the co-writer added, whatever was deleted (fuzz)', () => {
    const random = seededRandom(23);
    const VOCAB = ['rain', 'falls', 'down', 'the', 'night', 'is', 'cold', 'and', 'we', 'sing'];
    const words = n => Array.from({ length: n }, () => VOCAB[Math.floor(random() * VOCAB.length)]);
    for (let round = 0; round < 300; round += 1) {
      const base = words(12);
      const mine = base.filter(() => random() > 0.4).map(w => (random() < 0.2 ? `${w}s` : w));
      // Added words share letters with the old ones, as real rewrites do, so
      // a merge that compared letters would mix them up.
      const added = new Set();
      const theirs = base.flatMap((w, i) => {
        if (random() >= 0.3) return [w];
        const word = `${VOCAB[Math.floor(random() * VOCAB.length)]}${round}x${i}`;
        added.add(word);
        return [word, w];
      }).filter(w => added.has(w) || random() > 0.15);
      const result = rebase(Y, newDmp(), base.join(' '), mine.join(' '), theirs.join(' '));
      for (const word of added) {
        // Unbroken, though it may touch a word the other side wrote at the
        // very same spot, as two people rewriting one word do.
        assert.ok(result.includes(word), `round ${round}: ${word} missing from ${result}`);
      }
    }
  });

  it("never loses a line the co-writer added (fuzz)", () => {
    const random = seededRandom(11);
    const lines = n => Array.from({ length: n }, (_, i) => `line ${i} of the song\n`);
    for (let round = 0; round < 300; round += 1) {
      const baseLines = lines(8);
      const mine = baseLines.filter(() => random() > 0.25);
      const theirs = [...baseLines];
      const added = `co-writer line ${round}\n`;
      theirs.splice(Math.floor(random() * (theirs.length + 1)), 0, added);
      const result = rebase(Y, newDmp(), baseLines.join(''), mine.join(''), theirs.join(''));
      assert.ok(result.includes(added), `round ${round}: ${JSON.stringify(result)}`);
    }
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

describe('isUpdateSaved', () => {
  // A client and a room that start from the same text.
  function clientAndRoom(text) {
    const room = new Y.Doc();
    room.getText('body').insert(0, text);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(room));
    return { client, room };
  }

  function captureUpdate(doc, change) {
    let update = null;
    doc.once('update', captured => { update = captured; });
    change();
    return update;
  }

  const snapshotOf = doc => Y.encodeSnapshot(Y.snapshot(doc));

  it('is false before the room has an insert, true after', () => {
    const { client, room } = clientAndRoom('hello');
    const update = captureUpdate(client, () => client.getText('body').insert(5, '!'));
    assert.equal(isUpdateSaved(Y, update, snapshotOf(room)), false);
    Y.applyUpdate(room, update);
    assert.equal(isUpdateSaved(Y, update, snapshotOf(room)), true);
  });

  it('is false before the room has a delete-only update, true after', () => {
    const { client, room } = clientAndRoom('hello world');
    const update = captureUpdate(client, () => client.getText('body').delete(5, 6));
    assert.equal(isUpdateSaved(Y, update, snapshotOf(room)), false);
    Y.applyUpdate(room, update);
    assert.equal(isUpdateSaved(Y, update, snapshotOf(room)), true);
  });

  it('needs both halves of an update that inserts and deletes', () => {
    const { client, room } = clientAndRoom('teh cat');
    const update = captureUpdate(client, () => {
      client.transact(() => {
        client.getText('body').delete(1, 2);
        client.getText('body').insert(1, 'he');
      });
    });
    assert.equal(isUpdateSaved(Y, update, snapshotOf(room)), false);
    Y.applyUpdate(room, update);
    assert.equal(isUpdateSaved(Y, update, snapshotOf(room)), true);
  });
});
