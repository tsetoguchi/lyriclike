// The rhyme pages print each word's pronunciation in IPA and its meaning
// from WordNet. These pin down the two pieces that turn raw data into text.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseGloss } from '../tools/rhymes/collect-definitions.mjs';
import { toIpa } from '../tools/rhymes/pronounce.mjs';

describe('toIpa', () => {
  it('leaves a one-syllable word unmarked', () => {
    assert.equal(toIpa(['JH', 'OW1', 'K']), 'dʒoʊk');
  });

  it('marks the stressed syllable before its first sound', () => {
    assert.equal(toIpa(['AY0', 'D', 'IY1', 'AH0']), 'aɪˈdiə');
    assert.equal(toIpa(['AH0', 'B', 'AW1', 'T']), 'əˈbaʊt');
  });

  it('gives the next syllable the longest cluster English starts a syllable with', () => {
    assert.equal(toIpa(['EH1', 'K', 'S', 'T', 'R', 'AH0']), 'ˈɛkstrə');
    assert.equal(toIpa(['K', 'AH0', 'M', 'P', 'Y', 'UW1', 'T', 'ER0']), 'kəmˈpjutɚ');
  });

  it('marks secondary stress too', () => {
    assert.equal(toIpa(['S', 'AE1', 'T', 'AH0', 'L', 'AY2', 'T']), 'ˈsætəˌlaɪt');
  });
});

describe('parseGloss', () => {
  it('splits the definition from the quoted examples', () => {
    const gloss = 'a humorous anecdote or remark intended to provoke laughter; "he told a very funny joke"; "thanks for the laugh"';
    assert.deepEqual(parseGloss(gloss), {
      definition: 'a humorous anecdote or remark intended to provoke laughter',
      examples: ['he told a very funny joke', 'thanks for the laugh']
    });
  });

  it('keeps a definition that has its own semicolon', () => {
    const gloss = 'the content of cognition; the main thing you are thinking about; "it was not a good idea"';
    assert.equal(parseGloss(gloss).definition, 'the content of cognition; the main thing you are thinking about');
  });

  it('handles a gloss with no examples', () => {
    assert.deepEqual(parseGloss('tell a joke; speak humorously'), {
      definition: 'tell a joke; speak humorously',
      examples: []
    });
  });
});
