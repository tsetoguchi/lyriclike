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
  filters = { englishWords: new Set(englishWords), blocklist: new Set(blocklist) };
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

  it('lists each word under one type at most, in alphabetical order', () => {
    for (const word of SAMPLE_WORDS) {
      const results = findRhymes(index, word, filters);
      const listed = listAll(results);
      assert.equal(new Set(listed).size, listed.length, `${word} repeats a rhyme`);
      for (const { key } of RHYME_TYPES) {
        assert.deepEqual(results[key], [...results[key]].sort(), `${word} ${key} unsorted`);
      }
    }
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
