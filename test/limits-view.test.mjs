// The parts of limits.js that touch no page: the sidebar's page count text
// and the limit check, which must match the server's.
//
//   node --test test/limits-view.test.mjs

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import siteLimits from '../limits.js';

const { pageCountText, isAtLimit } = siteLimits;

describe('pageCountText', () => {
  it('reads "3 of 5 pages" under the limit', () => {
    assert.equal(pageCountText(3, 5), '3 of 5 pages');
  });

  it('reads "7 of 5 pages" over the limit', () => {
    assert.equal(pageCountText(7, 5), '7 of 5 pages');
  });

  it('is empty with no limit', () => {
    assert.equal(pageCountText(3, null), '');
  });

  it('is empty when an old server sends no limit at all', () => {
    assert.equal(pageCountText(3, undefined), '');
  });
});

describe('isAtLimit', () => {
  it('is true at the limit', () => {
    assert.equal(isAtLimit(5, 5), true);
  });

  it('is false under the limit', () => {
    assert.equal(isAtLimit(4, 5), false);
  });

  it('is false with no limit', () => {
    assert.equal(isAtLimit(99, null), false);
  });
});
