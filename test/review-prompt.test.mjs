// review-prompt.js decides when the iPhone app asks for an App Store review.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../review-prompt.js', import.meta.url), 'utf8');
const FIRST_DAY = '2026-11-01';
const WEEK_LATER = '2026-11-08';
const VERSION = '1.0';

function loadReviewPrompt() {
  const context = { document: {} };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  return context.ReviewPrompt;
}

function memoryStorage(initial) {
  const items = new Map(Object.entries(initial || {}));
  return {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, value),
  };
}

function usedOn(days, askedVersion = null) {
  return { firstDay: days[0], daysUsed: days, askedVersion };
}

const ReviewPrompt = loadReviewPrompt();

describe('dayKeyOf', () => {
  it('names the local day with padded parts', () => {
    assert.equal(ReviewPrompt.dayKeyOf(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  });
});

describe('readState', () => {
  it('starts fresh on today when nothing is stored', () => {
    const state = ReviewPrompt.readState(memoryStorage(), FIRST_DAY);
    assert.deepEqual({ ...state, daysUsed: [...state.daysUsed] },
      { firstDay: FIRST_DAY, daysUsed: [FIRST_DAY], askedVersion: null });
  });

  it('starts fresh when the stored value is broken', () => {
    const storage = memoryStorage({ review_prompt: '{oops' });
    assert.equal(ReviewPrompt.readState(storage, WEEK_LATER).firstDay, WEEK_LATER);
  });

  it('starts fresh when storage throws', () => {
    const storage = { getItem() { throw new Error('blocked'); } };
    assert.equal(ReviewPrompt.readState(storage, WEEK_LATER).firstDay, WEEK_LATER);
  });

  it('keeps what was stored', () => {
    const stored = usedOn([FIRST_DAY, '2026-11-03'], VERSION);
    const storage = memoryStorage({ review_prompt: JSON.stringify(stored) });
    assert.equal(ReviewPrompt.readState(storage, WEEK_LATER).askedVersion, VERSION);
  });
});

describe('withDayUsed', () => {
  it('counts a day once', () => {
    const state = usedOn([FIRST_DAY]);
    assert.equal(ReviewPrompt.withDayUsed(state, FIRST_DAY), state);
  });

  it('keeps only the last three days, never the first one', () => {
    const state = usedOn([FIRST_DAY, '2026-11-02', '2026-11-03']);
    const next = ReviewPrompt.withDayUsed(state, '2026-11-04');
    assert.deepEqual([...next.daysUsed], ['2026-11-02', '2026-11-03', '2026-11-04']);
    assert.equal(next.firstDay, FIRST_DAY);
  });
});

describe('isReviewDue', () => {
  const threeDays = usedOn([FIRST_DAY, '2026-11-03', WEEK_LATER]);

  it('is due a week in, on a third day of use', () => {
    assert.equal(ReviewPrompt.isReviewDue(threeDays, WEEK_LATER, VERSION), true);
  });

  it('waits a full week from the first day', () => {
    const early = usedOn([FIRST_DAY, '2026-11-02', '2026-11-07']);
    assert.equal(ReviewPrompt.isReviewDue(early, '2026-11-07', VERSION), false);
  });

  it('waits for a third day of use', () => {
    const twoDays = usedOn([FIRST_DAY, WEEK_LATER]);
    assert.equal(ReviewPrompt.isReviewDue(twoDays, WEEK_LATER, VERSION), false);
  });

  it('asks once per app version', () => {
    const asked = { ...threeDays, askedVersion: VERSION };
    assert.equal(ReviewPrompt.isReviewDue(asked, WEEK_LATER, VERSION), false);
    assert.equal(ReviewPrompt.isReviewDue(asked, WEEK_LATER, '1.1'), true);
  });

  it('never asks before the app version is known', () => {
    assert.equal(ReviewPrompt.isReviewDue(threeDays, WEEK_LATER, null), false);
  });
});

describe('hasRealVerse', () => {
  it('needs eight written lines, blank ones not counted', () => {
    const sevenLines = Array(7).fill('words').join('\n\n');
    assert.equal(ReviewPrompt.hasRealVerse(sevenLines), false);
    assert.equal(ReviewPrompt.hasRealVerse(`${sevenLines}\nmore`), true);
  });
});

describe('who can be asked', () => {
  it('needs the review call from the iPhone store plugin', () => {
    assert.equal(ReviewPrompt.canRequestReview(null), false);
    assert.equal(ReviewPrompt.canRequestReview({}), false);
    assert.equal(ReviewPrompt.canRequestReview({ requestReview() {} }), true);
  });

  it('shows the rate row only with an App Store id', () => {
    const appStore = { writeReview() {} };
    assert.equal(ReviewPrompt.canWriteReview(appStore, ''), false);
    assert.equal(ReviewPrompt.canWriteReview(appStore, '123'), true);
  });
});
