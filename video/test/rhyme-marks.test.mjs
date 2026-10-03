import { test } from 'node:test';
import assert from 'node:assert/strict';

import rhymeCore from '../../rhyme-core.js';
import { parseLyricLines } from '../scripts/align.mjs';
import {
  attachRhymeMarks,
  markLyricStanzas,
  splitStanzas
} from '../scripts/rhyme-marks.mjs';

const DICTIONARY = {
  night: [['N', 'AY1', 'T']],
  light: [['L', 'AY1', 'T']],
  stay: [['S', 'T', 'EY1']],
  we: [['W', 'IY1']]
};

test('splitStanzas groups lines on blank lines and drops empty ones', () => {
  const stanzas = splitStanzas('one\ntwo\n\n\nthree\n');
  assert.deepEqual(stanzas, [['one', 'two'], ['three']]);
});

test('a mark takes over the word whose character range it overlaps', () => {
  const timeline = parseLyricLines('hello big night');
  const marks = [[{ start: 10, end: 15, family: 3, isSlant: false }]];
  const [line] = attachRhymeMarks(timeline, marks);
  assert.deepEqual(
    line.map((word) => word.family),
    [null, null, 3]
  );
  assert.equal(line[2].isSlant, false);
});

test('a slant mark keeps its slant flag', () => {
  const timeline = parseLyricLines('night');
  const marks = [[{ start: 0, end: 5, family: 0, isSlant: true }]];
  const [[word]] = attachRhymeMarks(timeline, marks);
  assert.equal(word.isSlant, true);
});

test('offsets count a curly apostrophe as one character', () => {
  const timeline = parseLyricLines('it’s night');
  const marks = [[{ start: 5, end: 10, family: 1, isSlant: false }]];
  const [line] = attachRhymeMarks(timeline, marks);
  assert.deepEqual(
    line.map((word) => word.family),
    [null, 1]
  );
});

test('real marks pair up end rhymes across lines and skip unrhymed words', () => {
  const index = rhymeCore.buildRhymeIndex(DICTIONARY);
  const stanzas = [['we stay', 'in the night', 'in the light']];
  const marks = markLyricStanzas(rhymeCore, index, stanzas);
  const lines = stanzas[0].map((text) => parseLyricLines(text)[0]);
  const marked = attachRhymeMarks(lines, marks);
  const night = marked[1].find((word) => word.text === 'night');
  const light = marked[2].find((word) => word.text === 'light');
  assert.notEqual(night.family, null);
  assert.equal(night.family, light.family);
});
