// The search result text for each rhyme page. It has to fit Bing's limit
// and lead with the rhymes, since that is what gets the click.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeRhymePage } from '../tools/rhymes/render-html.mjs';

function pageModel(word, summary, shownCount) {
  return { word, summary, sections: [{ shownCount }] };
}

describe('describeRhymePage', () => {
  it('opens with the question and the best perfect rhymes', () => {
    const summary = { kind: 'perfect', examples: ['car', 'far', 'guitar', 'bizarre', 'jar'], total: 80 };
    assert.equal(
      describeRhymePage(pageModel('star', summary, 431)),
      'What rhymes with star? Car, far, guitar and bizarre. See all 431 rhymes for songs and poems, sorted by syllable count.'
    );
  });

  it('says so when a word has no perfect rhyme', () => {
    const summary = { kind: 'near', examples: ['finish', 'thing', 'bring'] };
    assert.equal(
      describeRhymePage(pageModel('english', summary, 132)),
      'What rhymes with english? No perfect rhymes. Closest: finish, thing and bring. See all 132 rhymes for songs and poems, sorted by syllable count.'
    );
  });

  it('drops examples until the text fits', () => {
    const summary = { kind: 'perfect', examples: ['internationalization', 'institutionalization', 'compartmentalization', 'responsibilities'] };
    const description = describeRhymePage(pageModel('organization', summary, 1200));
    assert.ok(description.length <= 160, description);
    assert.match(description, /^What rhymes with organization\? Internationalization/);
  });
});
