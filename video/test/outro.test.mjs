import { test } from 'node:test';
import assert from 'node:assert/strict';

import { easeInOutCubic } from '../src/ease.ts';
import { OUTRO_SCROLL_SECONDS, OUTRO_SECONDS, outroBlendAt, outroPulseAt } from '../src/outro.ts';

test('easeInOutCubic runs from 0 to 1 and is 0.5 at the midpoint', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(-3), 0);
  assert.equal(easeInOutCubic(7), 1);
});

test('the outro blend is 0 before the outro and 1 once it has settled', () => {
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
