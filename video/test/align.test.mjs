import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alignLyrics, parseLyricLines } from '../scripts/align.mjs';

const heard = (text, start, end) => ({ word: text, start, end });

test('parseLyricLines keeps line and word order and normalises words', () => {
  const lines = parseLyricLines("it’s okay\n\nI'll go");
  assert.deepEqual(
    lines.map((line) => line.map((word) => word.text)),
    [["it's", 'okay'], ["i'll", 'go']]
  );
});

test('dotted initials stay one word, shown with their dots and matched without them', () => {
  const [line] = parseLyricLines('ain’t in L.A.​');
  assert.deepEqual(line.map((word) => word.raw), ['ain’t', 'in', 'L.A.']);
  assert.deepEqual(line.map((word) => word.text), ["ain't", 'in', 'la']);
  const { timeline } = alignLyrics([line], [
    heard('ain’t', 1, 1.2),
    heard('in', 1.3, 1.4),
    heard('L.A.', 1.5, 2)
  ]);
  assert.equal(timeline[0][2].start, 1.5);
  assert.equal(timeline[0][2].isInterpolated, false);
});

test('initials Whisper splits into pieces are glued back so the word starts at its first letter', () => {
  const [line] = parseLyricLines('ain’t in L.A.');
  const { timeline } = alignLyrics([line], [
    heard('ain’t', 10.72, 11.06),
    heard('in', 11.06, 11.22),
    heard('L', 11.22, 11.42),
    heard('.A', 11.42, 13.22),
    heard('.', 13.22, 13.48)
  ]);
  const initials = timeline[0][2];
  assert.equal(initials.start, 11.22);
  assert.equal(initials.end, 13.48);
});

test('a full stop at the end of an ordinary word is not kept', () => {
  const [line] = parseLyricLines('run away.');
  assert.deepEqual(line.map((word) => word.raw), ['run', 'away']);
});

test('matched words take the transcribed times', () => {
  const lines = parseLyricLines('hello world');
  const { timeline } = alignLyrics(lines, [
    heard('Hello', 1, 1.4),
    heard('world', 1.5, 2)
  ]);
  assert.deepEqual(
    timeline.flat().map((word) => [word.start, word.end]),
    [[1, 1.4], [1.5, 2]]
  );
});

test('a misheard word is matched by position and keeps the lyric spelling', () => {
  const lines = parseLyricLines('i feel lonely tonight');
  const { timeline } = alignLyrics(lines, [
    heard('i', 0, 0.2),
    heard('feel', 0.3, 0.6),
    heard('only', 0.7, 1.1),
    heard('tonight', 1.2, 1.8)
  ]);
  const words = timeline.flat();
  assert.equal(words[2].text, 'lonely');
  assert.equal(words[2].start, 0.7);
});

test('a word the transcript missed is interpolated between its neighbours', () => {
  const lines = parseLyricLines('one two three');
  const { timeline } = alignLyrics(lines, [
    heard('one', 0, 1),
    heard('three', 3, 4)
  ]);
  const middle = timeline.flat()[1];
  assert.equal(middle.text, 'two');
  assert.ok(middle.start >= 1 && middle.end <= 3, 'sits inside the gap');
  assert.equal(middle.isInterpolated, true);
});

test('extra transcribed words that are not in the lyrics are dropped', () => {
  const lines = parseLyricLines('go now');
  const { timeline } = alignLyrics(lines, [
    heard('uh', 0, 0.2),
    heard('go', 0.3, 0.6),
    heard('now', 0.7, 1)
  ]);
  assert.deepEqual(timeline.flat().map((word) => word.start), [0.3, 0.7]);
});

test('zero-length words invented after the audio ends never steal a match', () => {
  const lines = parseLyricLines('one time');
  const { timeline } = alignLyrics(lines, [
    heard('one', 1, 1.4),
    heard('time', 1.5, 1.9),
    heard('Thanks', 9, 9),
    heard('time.', 9, 9)
  ]);
  assert.deepEqual(timeline.flat().map((word) => word.start), [1, 1.5]);
});

test('interpolated times stay in order across a run of missing words', () => {
  const lines = parseLyricLines('a b c d e');
  const { timeline } = alignLyrics(lines, [heard('a', 0, 1), heard('e', 9, 10)]);
  const starts = timeline.flat().map((word) => word.start);
  assert.deepEqual([...starts].sort((x, y) => x - y), starts);
});

test('match fractions are reported per line and overall', () => {
  const lines = parseLyricLines('one two\nthree four');
  const { lineMatch, overallMatch } = alignLyrics(lines, [
    heard('one', 0, 1),
    heard('two', 1, 2),
    heard('three', 2, 3)
  ]);
  assert.deepEqual(lineMatch, [1, 0.5]);
  assert.equal(overallMatch, 0.75);
});

test('leading and trailing unmatched words still get ordered times', () => {
  const lines = parseLyricLines('yeah go yeah');
  const { timeline } = alignLyrics(lines, [heard('go', 5, 6)]);
  const words = timeline.flat();
  assert.ok(words[0].end <= 5, 'leading word ends before the matched one');
  assert.ok(words[2].start >= 6, 'trailing word starts after it');
});
