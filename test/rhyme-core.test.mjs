// Rhyme logic against a small hand-written dictionary, so every expected
// result can be checked by reading the phonemes below.
//
//   node --test

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import rhymeCore from '../rhyme-core.js';

const {
  RHYME_TYPES, buildRhymeIndex, classifyRhyme, computeRhymeScheme, countSyllables,
  countSyllablesForLine, extractEndRhymePart, extractRhymePart, findRhymes,
  getStressedSyllable, normalizeWord
} = rhymeCore;

const DICTIONARY = {
  bat: [['B', 'AE1', 'T']],
  cap: [['K', 'AE1', 'P']],
  cast: [['K', 'AE1', 'S', 'T']],
  cat: [['K', 'AE1', 'T']],
  caught: [['K', 'AO1', 'T']],
  cunning: [['K', 'AH1', 'N', 'IH0', 'NG']],
  cut: [['K', 'AH1', 'T']],
  ham: [['HH', 'AE1', 'M']],
  happy: [['HH', 'AE1', 'P', 'IY0']],
  hat: [['HH', 'AE1', 'T']],
  hmm: [['HH', 'M']],
  hot: [['HH', 'AA1', 'T']],
  hotel: [['HH', 'OW0', 'T', 'EH1', 'L']],
  log: [['L', 'AO1', 'G']],
  long: [['L', 'AO1', 'NG']],
  me: [['M', 'IY1']],
  running: [['R', 'AH1', 'N', 'IH0', 'NG']],
  sat: [['S', 'AE1', 'T']],
  sea: [['S', 'IY1']],
  the: [['DH', 'AH0']],
  to: [['T', 'UW1']],
  two: [['T', 'UW1']],
  yell: [['Y', 'EH1', 'L']],
  zat: [['Z', 'AE1', 'T']]
};

const INDEX = buildRhymeIndex(DICTIONARY);
const ENGLISH_WORDS = new Set(Object.keys(DICTIONARY).filter((word) => word !== 'zat'));
const BLOCKLIST = new Set(['bat']);
const FILTERS = { englishWords: ENGLISH_WORDS, blocklist: BLOCKLIST };

function classifyWords(targetWord, candidateWord) {
  return classifyRhyme(
    extractRhymePart(DICTIONARY[targetWord][0]),
    extractRhymePart(DICTIONARY[candidateWord][0])
  );
}

describe('extractRhymePart', () => {
  it('splits at the stressed vowel and drops stress marks', () => {
    assert.deepEqual(extractRhymePart(DICTIONARY.hotel[0]), {
      onset: ['HH', 'OW', 'T'], vowel: 'EH', coda: ['L']
    });
  });

  it('falls back to the last vowel when nothing carries primary stress', () => {
    assert.deepEqual(extractRhymePart(DICTIONARY.the[0]), {
      onset: ['DH'], vowel: 'AH', coda: []
    });
  });

  it('returns null when there is no vowel', () => {
    assert.equal(extractRhymePart(DICTIONARY.hmm[0]), null);
    assert.equal(extractRhymePart([]), null);
  });
});

describe('extractEndRhymePart', () => {
  it('returns the unstressed final syllable', () => {
    assert.deepEqual(extractEndRhymePart(DICTIONARY.happy[0]), {
      onset: ['HH', 'AE', 'P'], vowel: 'IY', coda: []
    });
  });

  it('returns null when the final syllable is the stressed one', () => {
    assert.equal(extractEndRhymePart(DICTIONARY.cat[0]), null);
  });
});

describe('classifyRhyme', () => {
  const cases = [
    ['cat', 'hat', 'perfect'],
    ['hat', 'cap', 'family'],
    ['cat', 'cast', 'additive'],
    ['cast', 'cat', 'subtractive'],
    ['cat', 'ham', 'assonance'],
    ['cat', 'cut', 'consonance'],
    // A shared opening sound rules out family, leaving only the vowel match.
    ['cat', 'cap', 'assonance'],
    ['hotel', 'yell', 'perfect'],
    // Cot-caught merger.
    ['hot', 'caught', 'perfect'],
    ['hot', 'log', 'family'],
    // Merged vowels need matching consonants; the vowel alone is not assonance.
    ['hot', 'long', null],
    // Identical sounds are the same word to the ear, not a rhyme.
    ['to', 'two', null]
  ];

  for (const [target, candidate, expected] of cases) {
    it(`${target} / ${candidate} is ${expected}`, () => {
      assert.equal(classifyWords(target, candidate), expected);
    });
  }

  it('returns null when either side has no rhyme part', () => {
    assert.equal(classifyRhyme(null, extractRhymePart(DICTIONARY.cat[0])), null);
  });
});

describe('findRhymes', () => {
  it('groups rhymes by type, filtered and sorted', () => {
    assert.deepEqual(findRhymes(INDEX, 'cat', FILTERS), {
      perfect: ['hat', 'sat'],
      family: [],
      additive: ['cast'],
      subtractive: [],
      assonance: ['cap', 'ham', 'happy'],
      consonance: ['caught', 'cut', 'hot']
    });
  });

  it('returns one list per rhyme type, in display order', () => {
    const results = findRhymes(INDEX, 'cat', FILTERS);
    assert.deepEqual(Object.keys(results), RHYME_TYPES.map(({ key }) => key));
  });

  it('finds merged-vowel rhymes from either side', () => {
    const results = findRhymes(INDEX, 'caught', FILTERS);
    assert.deepEqual(results.perfect, ['hot']);
    assert.deepEqual(results.family, ['log']);
  });

  it('skips the English filter when that list is not loaded yet', () => {
    const results = findRhymes(INDEX, 'cat', { englishWords: null, blocklist: BLOCKLIST });
    assert.deepEqual(results.perfect, ['hat', 'sat', 'zat']);
  });

  it('never lists a blocked word, even unfiltered', () => {
    const results = findRhymes(INDEX, 'cat', { englishWords: null, blocklist: BLOCKLIST });
    const listed = RHYME_TYPES.flatMap(({ key }) => results[key]);
    assert.equal(listed.includes('bat'), false);
  });

  it('never lists the word itself', () => {
    const results = findRhymes(INDEX, 'cat', FILTERS);
    const listed = RHYME_TYPES.flatMap(({ key }) => results[key]);
    assert.equal(listed.includes('cat'), false);
  });

  it('returns null for words it cannot rhyme', () => {
    assert.equal(findRhymes(INDEX, 'zzyzx', FILTERS), null);
    assert.equal(findRhymes(INDEX, 'hmm', FILTERS), null);
    assert.equal(findRhymes(INDEX, '', FILTERS), null);
  });
});

describe('normalizeWord', () => {
  it('lowercases and keeps only letters and apostrophes', () => {
    assert.equal(normalizeWord('Heart!'), 'heart');
    assert.equal(normalizeWord("Runnin'"), "runnin'");
  });
});

describe('syllables', () => {
  it('counts and locates stress from the dictionary', () => {
    assert.equal(countSyllables(INDEX, 'hotel'), 2);
    assert.equal(getStressedSyllable(INDEX, 'hotel'), 2);
    assert.equal(getStressedSyllable(INDEX, 'happy'), 1);
  });

  it('totals a line', () => {
    assert.equal(countSyllablesForLine(INDEX, 'The happy cat'), 4);
  });

  it('leaves bracketed and parenthesised text out', () => {
    assert.equal(countSyllablesForLine(INDEX, '[Chorus] the cat (oh yeah) sat'), 3);
  });

  it('guesses from vowel letters for words the dictionary lacks', () => {
    assert.equal(countSyllablesForLine(INDEX, 'zebra'), 2);
    assert.equal(countSyllablesForLine(INDEX, 'hmm'), 1);
  });

  it('guesses every word while the dictionary is still loading', () => {
    assert.equal(countSyllablesForLine(null, 'beautiful day'), 4);
  });

  it('counts nothing on an empty line', () => {
    assert.equal(countSyllablesForLine(INDEX, ''), 0);
    assert.equal(countSyllablesForLine(INDEX, '   '), 0);
    assert.equal(countSyllablesForLine(INDEX, undefined), 0);
  });
});

describe('computeRhymeScheme', () => {
  it('labels couplets', () => {
    const lines = ['I saw a cat', 'wearing a hat', 'out by the sea', 'with me'];
    assert.deepEqual(computeRhymeScheme(INDEX, lines), ['A', 'A', 'B', 'B']);
  });

  it('labels alternating rhymes', () => {
    const lines = ['cat', 'sea', 'hat', 'me'];
    assert.deepEqual(computeRhymeScheme(INDEX, lines), ['A', 'B', 'A', 'B']);
  });

  it('leaves lines with no word unlabelled', () => {
    const lines = ['cat', '', '[Chorus]', 'hat'];
    assert.deepEqual(computeRhymeScheme(INDEX, lines), ['A', '', '', 'A']);
  });

  it('reads the last word before any bracketed aside', () => {
    assert.deepEqual(computeRhymeScheme(INDEX, ['cat', 'hat (yeah)']), ['A', 'A']);
  });

  it('gives unknown words a group of their own', () => {
    assert.deepEqual(computeRhymeScheme(INDEX, ['cat', 'zzyzx', 'hat']), ['A', 'B', 'A']);
  });

  it('understands dropped-g endings', () => {
    assert.deepEqual(computeRhymeScheme(INDEX, ['running', "cunnin'"]), ['A', 'A']);
  });

  it('rhymes an unstressed ending with a stressed syllable', () => {
    assert.deepEqual(computeRhymeScheme(INDEX, ['happy', 'me']), ['A', 'A']);
  });

  it('rhymes across the cot-caught merger', () => {
    assert.deepEqual(computeRhymeScheme(INDEX, ['hot', 'caught']), ['A', 'A']);
  });

  it('pairs a repeated word with itself', () => {
    assert.deepEqual(computeRhymeScheme(INDEX, ['cat', 'cat']), ['A', 'A']);
  });

  it('wraps labels after Z', () => {
    const lines = Array.from({ length: 27 }, (_, i) => 'q'.repeat(i + 1));
    const scheme = computeRhymeScheme(INDEX, lines);
    assert.equal(scheme[25], 'Z');
    assert.equal(scheme[26], 'A');
  });
});
