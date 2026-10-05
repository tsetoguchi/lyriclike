import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPEAR_LEAD_SECONDS,
  PAST_FADE_SECONDS,
  PAST_OPACITY,
  estimateStackHeight,
  isLineVisible,
  lineAppearAt,
  pastDimAt,
  songFontSize,
  stackOffsetAt
} from '../src/stack.ts';

const WIDTH = 788;
const HEIGHT = 1100;
const LYRICS = [
  'it is okay to be unhappy',
  'it is okay to show that I am lonely',
  'I will just take my time living for me',
  'it is only a matter of time yeah'
];

test('a short song gets a bigger size than a long one, and the chosen size fits', () => {
  const short = songFontSize(LYRICS.slice(0, 2), WIDTH, HEIGHT);
  const long = songFontSize([...LYRICS, ...LYRICS, ...LYRICS], WIDTH, HEIGHT);
  assert.ok(short >= long, `${short} vs ${long}`);
  const size = songFontSize(LYRICS, WIDTH, HEIGHT);
  assert.ok(estimateStackHeight(LYRICS, size, WIDTH) <= HEIGHT, 'stack fits the stage');
});

test('a song too long for any size still gets the smallest size', () => {
  const huge = Array.from({ length: 80 }, () => LYRICS[1]);
  assert.equal(songFontSize(huge, WIDTH, HEIGHT), 56);
});

test('the first line is there from the start and later lines arrive just before their words', () => {
  assert.equal(lineAppearAt(0.73, 0), 0);
  assert.equal(lineAppearAt(5.5, 2), 5.5 - APPEAR_LEAD_SECONDS);
});

test('a line is hidden before its time and fully there from that moment', () => {
  assert.equal(isLineVisible(4.99, 5), false);
  assert.equal(isLineVisible(5, 5), true);
  assert.equal(isLineVisible(9, 5), true);
});

test('a line stays at full brightness until the next arrives, then eases to the past level', () => {
  assert.equal(pastDimAt(3, undefined), 1);
  assert.equal(pastDimAt(4.9, 5), 1);
  assert.ok(Math.abs(pastDimAt(5 + PAST_FADE_SECONDS, 5) - PAST_OPACITY) < 1e-9);
  assert.ok(Math.abs(pastDimAt(99, 5) - PAST_OPACITY) < 1e-9);
});

test('the stack does not scroll while everything fits', () => {
  const appear = [0, 5, 10];
  const bottoms = [300, 600, 900];
  for (const seconds of [0, 2, 6, 12, 20]) {
    assert.equal(stackOffsetAt(seconds, appear, bottoms, 1100), 0);
  }
});

test('once a line would run off the bottom the stack scrolls just enough to show it', () => {
  const appear = [0, 5, 10];
  const bottoms = [300, 700, 1300];
  const settled = stackOffsetAt(30, appear, bottoms, 1000);
  assert.equal(settled, 1300 + 24 - 1000);
});

test('scrolling never moves backwards as time advances', () => {
  const appear = [0, 5, 10, 15];
  const bottoms = [400, 800, 1200, 1600];
  let previous = -Infinity;
  for (let seconds = 0; seconds < 25; seconds += 0.05) {
    const offset = stackOffsetAt(seconds, appear, bottoms, 1000);
    assert.ok(offset >= previous - 1e-9, `offset fell at ${seconds}`);
    previous = offset;
  }
});

test('before any line has appeared the offset is zero', () => {
  assert.equal(stackOffsetAt(-1, [0], [500], 100), 0);
  assert.equal(stackOffsetAt(3, [5, 9], [], 100), 0);
});
