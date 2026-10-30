// The marks a whole lyric gets, line by line: stanza splits, rhyme letters
// and internal-rhyme positions, against a small hand-written dictionary.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import rhymeCore from '../rhyme-core.js';
import lyricMarks from '../lyric-marks.js';

const { buildRhymeIndex } = rhymeCore;
const { internalRhymeMarks, lineStartOffsets, schemeLetters, splitIntoStanzas } = lyricMarks;

const INDEX = buildRhymeIndex({
  cat: [['K', 'AE1', 'T']],
  hat: [['HH', 'AE1', 'T']],
  home: [['HH', 'OW1', 'M']],
  roam: [['R', 'OW1', 'M']],
  sky: [['S', 'K', 'AY1']]
});

describe('splitIntoStanzas', () => {
  it('splits on blank lines and remembers where each stanza starts', () => {
    const lines = ['', 'one', 'two', '  ', '', 'three'];
    assert.deepEqual(splitIntoStanzas(lines, lines.length), {
      stanzas: [['one', 'two'], ['three']],
      stanzaStartIndices: [1, 5]
    });
  });

  it('stops at lineCount', () => {
    const lines = ['one', '', 'two'];
    assert.deepEqual(splitIntoStanzas(lines, 1).stanzas, [['one']]);
  });
});

describe('lineStartOffsets', () => {
  it('counts the newline each line ends with', () => {
    assert.deepEqual(lineStartOffsets(['ab', '', 'cde']), [0, 3, 4]);
  });
});

describe('schemeLetters', () => {
  it('starts the letters again in each stanza', () => {
    const lines = ['cat', 'hat', '', 'home', 'roam'];
    assert.deepEqual(schemeLetters(INDEX, lines, lines.length), ['A', 'A', '', 'A', 'A']);
  });

  it('gives a line that rhymes with nothing its own letter', () => {
    const lines = ['cat', 'sky', 'hat'];
    assert.deepEqual(schemeLetters(INDEX, lines, lines.length), ['A', 'B', 'A']);
  });

  it('leaves lines past lineCount out', () => {
    assert.deepEqual(schemeLetters(INDEX, ['cat', 'hat', 'cat'], 2), ['A', 'A']);
  });
});

describe('internalRhymeMarks', () => {
  it('places marks at their offset in the whole text', () => {
    const lines = ['sky', '', 'the cat in a hat'];
    const marks = internalRhymeMarks(INDEX, lines, lines.length);
    const catAt = lines.slice(0, 2).join('\n').length + 1 + 'the '.length;
    const hatAt = catAt + 'cat in a '.length;
    assert.deepEqual([...marks.keys()].sort((a, b) => a - b), [catAt, hatAt]);
  });

  it('numbers the stanza each mark is in', () => {
    const lines = ['the cat in a hat', '', 'home and roam'];
    const marks = internalRhymeMarks(INDEX, lines, lines.length);
    assert.deepEqual([...marks.values()].map(mark => mark.stanza), [0, 0, 1, 1]);
  });

  it('gives the words of one rhyme the same family', () => {
    const lines = ['the cat in a hat'];
    const families = [...internalRhymeMarks(INDEX, lines, 1).values()].map(mark => mark.family);
    assert.equal(families.length, 2);
    assert.equal(families[0], families[1]);
  });
});
