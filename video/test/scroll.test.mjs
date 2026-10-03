import { test } from 'node:test';
import assert from 'node:assert/strict';

import { easeInOutCubic } from '../src/ease.ts';
import { OUTRO_SCROLL_SECONDS, OUTRO_SECONDS, outroBlendAt, outroPulseAt } from '../src/outro.ts';
import {
  SCROLL_LEAD_SECONDS,
  SCROLL_SECONDS,
  activeLineAt,
  lineEmphasis,
  scrollOffsetAt
} from '../src/scroll.ts';

const STARTS = [0.7, 5.5, 10.3];
const TOPS = [100, 300, 520];
const arrivalOf = (index) => STARTS[index] - SCROLL_LEAD_SECONDS;

test('easeInOutCubic runs from 0 to 1 and is 0.5 at the midpoint', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(-3), 0);
  assert.equal(easeInOutCubic(7), 1);
});

test('activeLineAt picks the last line that has started', () => {
  assert.equal(activeLineAt(0, STARTS), 0);
  assert.equal(activeLineAt(5.4, STARTS), 0);
  assert.equal(activeLineAt(5.5, STARTS), 1);
  assert.equal(activeLineAt(99, STARTS), 2);
});

test('the sheet rests on the first line until the first scroll begins', () => {
  assert.equal(scrollOffsetAt(0, STARTS, TOPS), 100);
  assert.equal(scrollOffsetAt(arrivalOf(1) - SCROLL_SECONDS - 0.01, STARTS, TOPS), 100);
});

test('the sheet reaches each line just before its first word', () => {
  assert.equal(scrollOffsetAt(arrivalOf(1), STARTS, TOPS), 300);
  assert.equal(scrollOffsetAt(arrivalOf(1) + 1, STARTS, TOPS), 300);
  assert.equal(scrollOffsetAt(arrivalOf(2), STARTS, TOPS), 520);
  assert.equal(scrollOffsetAt(999, STARTS, TOPS), 520);
});

test('halfway through a scroll the sheet is halfway between the lines', () => {
  const halfway = arrivalOf(1) - SCROLL_SECONDS / 2;
  assert.equal(scrollOffsetAt(halfway, STARTS, TOPS), 200);
});

test('scrolling never moves backwards as time advances', () => {
  let previous = -Infinity;
  for (let seconds = 0; seconds < 12; seconds += 0.05) {
    const offset = scrollOffsetAt(seconds, STARTS, TOPS);
    assert.ok(offset >= previous, `offset fell at ${seconds}`);
    previous = offset;
  }
});

test('before the layout is measured the offset is zero', () => {
  assert.equal(scrollOffsetAt(3, STARTS, []), 0);
});

test('the outro blend is 0 before the outro and 1 once the overview has settled', () => {
  const duration = 17;
  const outroStart = duration - OUTRO_SECONDS;
  assert.equal(outroBlendAt(outroStart - 1, duration), 0);
  assert.equal(outroBlendAt(outroStart, duration), 0);
  const midway = outroBlendAt(outroStart + OUTRO_SCROLL_SECONDS / 2, duration);
  assert.ok(Math.abs(midway - 0.5) < 1e-9, `midway blend was ${midway}`);
  assert.equal(outroBlendAt(duration, duration), 1);
});

test('the outro pulse is a bell that only rings inside its window', () => {
  const duration = 17;
  const outroStart = duration - OUTRO_SECONDS;
  assert.equal(outroPulseAt(outroStart - 0.1, duration, 0), 0);
  assert.ok(outroPulseAt(outroStart + 0.3, duration, 0) > 0.99);
  assert.equal(outroPulseAt(outroStart + 0.3, duration, 0.5), 0);
});

test('a line is active as it arrives and past once the next line comes in', () => {
  assert.deepEqual(lineEmphasis(0, STARTS, 0), { active: 0, past: 0 });
  assert.deepEqual(lineEmphasis(2, STARTS, 0), { active: 1, past: 0 });
  assert.deepEqual(lineEmphasis(6, STARTS, 0), { active: 0, past: 1 });
  assert.deepEqual(lineEmphasis(99, STARTS, 2), { active: 1, past: 0 });
});
