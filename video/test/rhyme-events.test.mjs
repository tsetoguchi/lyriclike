import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rhymeEvents } from '../src/rhyme-events.ts';
import { arcBetween, cubicPoint } from '../src/arcs.ts';

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

test('words with no family produce no events', () => {
  assert.deepEqual(rhymeEvents([[word(0, null)]]), []);
});

const PEAK_X = 868;

test('an arc between rows starts under one word and ends above the other', () => {
  const upper = { x: 100, y: 0, width: 80, height: 80 };
  const lower = { x: 300, y: 200, width: 100, height: 80 };
  const arc = arcBetween(upper, lower, PEAK_X);
  assert.ok(arc[0].y > upper.y + upper.height, 'starts below the upper word');
  assert.ok(arc[3].y < lower.y, 'ends above the lower word');
  assert.equal(arc[0].x, 140);
  assert.equal(arc[3].x, 350);
});

test('an arc between rows swings out to the right margin, clear of the text', () => {
  const upper = { x: 320, y: 0, width: 160, height: 80 };
  const lower = { x: 320, y: 240, width: 160, height: 80 };
  const widest = cubicPoint(arcBetween(upper, lower, PEAK_X), 0.5);
  assert.ok(Math.abs(widest.x - PEAK_X) < 8, `reached x=${widest.x}`);
});

test('an arc between words on the same row bows above the text', () => {
  const left = { x: 100, y: 50, width: 80, height: 80 };
  const right = { x: 400, y: 50, width: 80, height: 80 };
  const arc = arcBetween(left, right, PEAK_X);
  assert.ok(arc[1].y < left.y && arc[2].y < right.y);
});

test('cubicPoint hits both end points', () => {
  const arc = arcBetween(
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 100, y: 100, width: 10, height: 10 },
    PEAK_X
  );
  assert.deepEqual(cubicPoint(arc, 0), arc[0]);
  assert.deepEqual(cubicPoint(arc, 1), arc[3]);
});
