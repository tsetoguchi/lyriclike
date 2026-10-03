import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OUTRO_STAGGER_SECONDS } from '../src/outro.ts';
import { buildWordMaps, rhymeEvents, wordKey } from '../src/rhyme-events.ts';

const word = (start, family) => ({ start, family });

test('rhymeEvents lists marked words in the order they are sung', () => {
  const timeline = [
    [word(0, null), word(1, 1), word(2, 0)],
    [word(5, 1), word(6, null), word(7, 0)]
  ];
  const events = rhymeEvents(timeline);
  assert.deepEqual(
    events.map((event) => [event.lineIndex, event.wordIndex]),
    [[0, 1], [0, 2], [1, 0], [1, 2]]
  );
});

test('each event counts its family and points at the word it answers', () => {
  const timeline = [[word(1, 1), word(2, 0)], [word(5, 1), word(7, 0)], [word(9, 1)]];
  const events = rhymeEvents(timeline);
  const family1 = events.filter((event) => event.family === 1);
  assert.deepEqual(family1.map((event) => event.countInFamily), [1, 2, 3]);
  assert.equal(family1[0].previous, null);
  assert.deepEqual(family1[2].previous, { lineIndex: 1, wordIndex: 0 });
});

test('only words that complete a rhyme are landings, and every rhyme word gets a turn', () => {
  const timeline = [[word(1, 1), word(2, 0)], [word(5, 1), word(7, 0)]];
  const { landings, outroDelays } = buildWordMaps(rhymeEvents(timeline));
  assert.deepEqual([...landings].sort(), [wordKey(1, 0), wordKey(1, 1)]);
  assert.equal(outroDelays[wordKey(0, 0)], 0);
  assert.equal(outroDelays[wordKey(1, 1)], 3 * OUTRO_STAGGER_SECONDS);
});

test('words with no family produce no events', () => {
  assert.deepEqual(rhymeEvents([[word(0, null)]]), []);
});
