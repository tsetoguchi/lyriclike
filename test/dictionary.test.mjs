// Rhyme logic against the real dictionary and word lists the site ships, to
// catch data changes the hand-written cases in rhyme-core.test.mjs cannot.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

import rhymeCore from '../rhyme-core.js';

const { RHYME_TYPES, buildRhymeIndex, computeRhymeScheme, countSyllablesForLine, findRhymes } =
  rhymeCore;

const REPO_ROOT = new URL('../', import.meta.url);
const SAMPLE_WORDS = ['love', 'heart', 'night', 'fire', 'money', 'time', 'away'];

async function readRepoJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, REPO_ROOT), 'utf8'));
}

let index;
let filters;

before(async () => {
  const [dictionary, englishWords, blocklist] = await Promise.all([
    readRepoJson('cmudict.json'),
    readRepoJson('english-words.json'),
    readRepoJson('blocklist.json')
  ]);
  index = buildRhymeIndex(dictionary);
  const wordRanks = new Map();
  englishWords.forEach((word, rank) => {
    if (!wordRanks.has(word)) wordRanks.set(word, rank);
  });
  filters = { englishWords: new Set(englishWords), blocklist: new Set(blocklist), wordRanks };
});

function listAll(results) {
  return RHYME_TYPES.flatMap(({ key }) => results[key]);
}

describe('shipped dictionary', () => {
  it('finds familiar perfect rhymes', () => {
    assert.ok(findRhymes(index, 'cat', filters).perfect.includes('hat'));
    assert.ok(findRhymes(index, 'love', filters).perfect.includes('above'));
    assert.ok(findRhymes(index, 'night', filters).perfect.includes('light'));
  });

  it('only lists English, unblocked words', () => {
    for (const word of SAMPLE_WORDS) {
      for (const listed of listAll(findRhymes(index, word, filters))) {
        assert.ok(filters.englishWords.has(listed), `${word} listed ${listed}`);
        assert.ok(!filters.blocklist.has(listed), `${word} listed a blocked word`);
      }
    }
  });

  it('lists each word under one type at most', () => {
    for (const word of SAMPLE_WORDS) {
      const listed = listAll(findRhymes(index, word, filters));
      assert.equal(new Set(listed).size, listed.length, `${word} repeats a rhyme`);
    }
  });

  it('ranks the closest rhymes first', () => {
    const perfect = findRhymes(index, 'night', filters).perfect;
    assert.ok(perfect.indexOf('bite') < perfect.indexOf('tonight'), 'one syllable first');

    // "iced" keeps the T that ends "night"; "biked" does not.
    const additive = findRhymes(index, 'night', filters).additive;
    assert.ok(additive.indexOf('iced') < additive.indexOf('biked'), 'shared ending first');
  });

  it('ranks common words above obscure ones of the same closeness', () => {
    const perfect = findRhymes(index, 'night', filters).perfect;
    for (const obscure of ['kyte', 'reit', 'wight']) {
      assert.ok(perfect.indexOf('right') < perfect.indexOf(obscure), `right before ${obscure}`);
    }
    assert.equal(perfect[0], 'right');
  });

  it('keeps an exact vowel match ahead of a merged one', () => {
    // "sort" is a perfect rhyme for "heart" only through the AA/AO merger.
    const perfect = findRhymes(index, 'heart', filters).perfect;
    assert.ok(perfect.indexOf('start') < perfect.indexOf('sort'), 'exact vowel first');
  });

  it('ranks by frequency only when the word list has loaded', () => {
    const unranked = findRhymes(index, 'night', { ...filters, wordRanks: null });
    assert.notEqual(unranked.perfect[0], 'right');
    assert.ok(unranked.perfect.length > 0);
  });

  it('keeps english-words.json in frequency order', () => {
    const words = [...filters.englishWords];
    assert.ok(words.indexOf('the') < words.indexOf('aardvark'), 'commonest words first');
    assert.ok(words.indexOf('love') < words.indexOf('loamy'), 'not alphabetical');
  });

  it('labels a real verse', () => {
    const verse = [
      "I've been waiting all night",
      'for you to hold me tight',
      'but you never came home',
      "so I'm sitting alone"
    ];
    assert.deepEqual(computeRhymeScheme(index, verse), ['A', 'A', 'B', 'B']);
  });

  it('counts syllables in a real line', () => {
    assert.equal(countSyllablesForLine(index, 'Twinkle twinkle little star'), 7);
  });
});
