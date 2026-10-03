import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENTER_LEAD_SECONDS,
  ENTER_SECONDS,
  EXIT_SECONDS,
  fontSizeFor,
  lineStageAt,
  lineWindows
} from '../src/lines.ts';

const SPANS = [
  { start: 0.7, end: 3.5 },
  { start: 5.5, end: 8.5 },
  { start: 10.3, end: 13.4 },
  { start: 14.9, end: 17.0 }
];
const OUTRO_START = 15.6;

test('longer lines get smaller type, and never grow back', () => {
  const sizes = ['hey', 'it is okay', 'to be so unhappy', 'show that I am lonely now', 'I will just take my time living for me']
    .map(fontSizeFor);
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index] <= sizes[index - 1], `size rose at ${index}: ${sizes}`);
  }
  assert.ok(sizes[0] > sizes[sizes.length - 1]);
});

test('the first line is on screen from the very first frame', () => {
  const [first] = lineWindows(SPANS, OUTRO_START);
  assert.equal(first.appearAt, 0);
});

test('later lines arrive just before their first word', () => {
  const windows = lineWindows(SPANS, OUTRO_START);
  assert.equal(windows[1].appearAt, 5.5 - ENTER_LEAD_SECONDS);
});

test('a line has gone before the next one arrives when there is room', () => {
  const windows = lineWindows(SPANS, OUTRO_START);
  for (let index = 0; index < windows.length - 1; index += 1) {
    assert.ok(windows[index].exitEnd <= windows[index + 1].appearAt + 1e-9, `lines ${index} and ${index + 1} overlap`);
  }
});

test('a line is never cut off before its last word is done when there is room', () => {
  const windows = lineWindows(SPANS, OUTRO_START);
  windows.slice(0, -1).forEach((window, index) => {
    assert.ok(window.exitStart >= SPANS[index].end);
  });
});

test('the last line leaves when the outro recap starts', () => {
  const windows = lineWindows(SPANS, OUTRO_START);
  assert.equal(windows[3].exitStart, OUTRO_START);
});

test('a stage is hidden before it appears and after it has left', () => {
  const [first, second] = lineWindows(SPANS, OUTRO_START);
  assert.equal(lineStageAt(second.appearAt - 0.01, second).isVisible, false);
  assert.equal(lineStageAt(second.appearAt, second).isVisible, true);
  assert.equal(lineStageAt(first.exitEnd, first).isVisible, false);
});

test('entrance and exit run from 0 to 1 over their durations', () => {
  const [, second] = lineWindows(SPANS, OUTRO_START);
  assert.equal(lineStageAt(second.appearAt, second).enter, 0);
  assert.ok(Math.abs(lineStageAt(second.appearAt + ENTER_SECONDS / 2, second).enter - 0.5) < 1e-9);
  assert.ok(Math.abs(lineStageAt(second.appearAt + ENTER_SECONDS, second).enter - 1) < 1e-9);
  assert.equal(lineStageAt(second.exitStart - 0.01, second).exit, 0);
  assert.ok(Math.abs(lineStageAt(second.exitStart + EXIT_SECONDS, second).exit - 1) < 1e-9);
});

test('hold progress runs from 0 to 1 across the time the line is on screen', () => {
  const [, second] = lineWindows(SPANS, OUTRO_START);
  assert.equal(lineStageAt(second.appearAt, second).hold, 0);
  assert.ok(Math.abs(lineStageAt(second.exitStart, second).hold - 1) < 1e-9);
});
