// Rhyme logic against the real dictionary and word lists the site ships, to
// catch data changes the hand-written cases in rhyme-core.test.mjs cannot.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

import rhymeCore from '../rhyme-core.js';

const {
  RHYME_TYPES, buildRhymeIndex, computeRhymeScheme, countSyllablesForLine, findRhymes,
  groupRhymeMarks, FUNCTION_WORDS
} = rhymeCore;

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

  it('marks internal rhymes in a real verse and never marks a function word', () => {
    const verse = [
      "I've been waiting all night for the light",
      'holding on so tight through the fight',
      'money is nothing but the way that I feel',
      'this is real, this is the deal'
    ];
    const { labels, marks } = groupRhymeMarks(index, verse);
    assert.deepEqual(labels, ['A', 'A', 'B', 'B']);

    const markedWords = marks.flatMap((lineMarks, i) =>
      lineMarks.map(({ start, end }) => verse[i].slice(start, end)));
    // waiting/holding/nothing share only an unstressed "-ing", which is not
    // heard as a rhyme inside a line.
    assert.deepEqual(new Set(markedWords), new Set([
      'night', 'light', 'tight', 'fight', 'money', 'feel', 'real', 'deal'
    ]));

    for (const word of markedWords) {
      assert.equal(FUNCTION_WORDS.has(word), false, `"${word}" is a function word and should not be marked`);
    }

    // The end-rhyme families keep the same colour as their gutter letter.
    const nightFamily = marks[0].find((m) => verse[0].slice(m.start, m.end) === 'night').family;
    const lightFamily = marks[0].find((m) => verse[0].slice(m.start, m.end) === 'light').family;
    const tightFamily = marks[1].find((m) => verse[1].slice(m.start, m.end) === 'tight').family;
    assert.equal(nightFamily, 0);
    assert.equal(lightFamily, 0);
    assert.equal(tightFamily, 0);
  });

  it('reads a curly apostrophe as part of the word', () => {
    const verse = ['I know you’re not around', 'They say it’s done'];
    const markedWords = groupRhymeMarks(index, verse).marks.flatMap((lineMarks, i) =>
      lineMarks.map(({ start, end }) => verse[i].slice(start, end)));
    assert.equal(markedWords.includes('re'), false);
    assert.equal(
      countSyllablesForLine(index, 'you’re'),
      countSyllablesForLine(index, "you're")
    );
  });

  it('does not mark a rhyme that only adds a whole syllable', () => {
    const verse = ["It's only a matter of time yeah", 'I would rather be okay', 'take it slow'];
    const markedWords = groupRhymeMarks(index, verse).marks.flatMap((lineMarks, i) =>
      lineMarks.map(({ start, end }) => verse[i].slice(start, end)));
    assert.equal(markedWords.includes('rather'), false);
    assert.equal(markedWords.includes('okay'), true);
    assert.equal(markedWords.includes('take'), true);
  });

  it('keeps a word with two pronunciations in one family', () => {
    // "re" is both "ray" and "ree"; it must not join "say" to "feel".
    const verse = ['I know you re not around', 'I feel nothing wrong', 'They say what is done'];
    const { marks } = groupRhymeMarks(index, verse);
    const familyOf = (lineIdx, word) => {
      const mark = marks[lineIdx].find((m) => verse[lineIdx].slice(m.start, m.end) === word);
      return mark ? mark.family : null;
    };
    assert.notEqual(familyOf(1, 'feel'), null);
    assert.notEqual(familyOf(1, 'feel'), familyOf(2, 'say'));
  });
});
