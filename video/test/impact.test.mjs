import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SHAKE_PX, SHAKE_SECONDS, latestLanding, shakeAt } from '../src/impact.ts';

const event = (time, countInFamily) => ({
  lineIndex: 0,
  wordIndex: 0,
  family: 1,
  time,
  countInFamily,
  previous: null
});

const EVENTS = [event(1, 1), event(2, 2), event(5, 3)];

test('only a second or later word of a family counts as a landing', () => {
  assert.equal(latestLanding(EVENTS, 1.5), null);
  assert.equal(latestLanding(EVENTS, 2.5).time, 2);
  assert.equal(latestLanding(EVENTS, 9).time, 5);
});

test('there is no shake before a landing or once it has settled', () => {
  assert.deepEqual(shakeAt(1.5, EVENTS), { x: 0, y: 0 });
  assert.deepEqual(shakeAt(2 + SHAKE_SECONDS + 0.01, EVENTS), { x: 0, y: 0 });
});

test('the shake never exceeds its limit and dies away', () => {
  let strongest = 0;
  let previousPeak = Infinity;
  for (let age = 0; age < SHAKE_SECONDS; age += 0.01) {
    const { x, y } = shakeAt(2 + age, EVENTS);
    strongest = Math.max(strongest, Math.abs(x), Math.abs(y));
  }
  assert.ok(strongest > 1, 'the shake is visible');
  assert.ok(strongest <= SHAKE_PX, `peaked at ${strongest}`);
  const late = shakeAt(2 + SHAKE_SECONDS * 0.95, EVENTS);
  previousPeak = Math.abs(late.x) + Math.abs(late.y);
  assert.ok(previousPeak < 1, 'nearly still at the end');
});

test('the shake is identical every time it is asked for the same moment', () => {
  assert.deepEqual(shakeAt(2.1, EVENTS), shakeAt(2.1, EVENTS));
});
