// The hub lists a short set of words above the A to Z list, so search
// engines reach those pages first.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderHubPage } from '../tools/rhymes/render-html.mjs';

const PAGE_WORDS = ['apple', 'kids', 'twinkle'];
const FEATURED_HEADING = '<h2>Rhymes people search for</h2>';

describe('renderHubPage featured words', () => {
  it('links the featured words, in the order given, above the letter list', () => {
    const html = renderHubPage(PAGE_WORDS, ['twinkle', 'kids']);
    const featuredAt = html.indexOf(FEATURED_HEADING);
    const lettersAt = html.indexOf('<nav class="letter-jump">');
    assert.ok(featuredAt > 0 && featuredAt < lettersAt);
    const featured = html.slice(featuredAt, lettersAt);
    assert.match(featured, /href="\/rhymes\/twinkle\/".*href="\/rhymes\/kids\/"/s);
    assert.doesNotMatch(featured, /apple/);
  });

  it('leaves the section out when no word is featured', () => {
    assert.ok(!renderHubPage(PAGE_WORDS).includes(FEATURED_HEADING));
  });
});
