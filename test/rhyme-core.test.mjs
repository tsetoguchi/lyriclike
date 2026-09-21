// Rhyme logic against a small hand-written dictionary, so every expected
// result can be checked by reading the phonemes below.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import rhymeCore from '../rhyme-core.js';

const {
  RHYME_TYPES, buildRhymeIndex, classifyRhyme, computeRhymeScheme, countSyllables,
  countSyllablesForLine, extractEndRhymePart, extractRhymePart, findRhymes,
  getStressedSyllable, normalizeWord, groupRhymeMarks, FUNCTION_WORDS, OVERFLOW_FAMILY
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
  it('groups rhymes by type, filtered and ranked', () => {
    assert.deepEqual(findRhymes(INDEX, 'cat', FILTERS), {
      perfect: ['hat', 'sat'],
      family: [],
      additive: ['cast'],
      subtractive: [],
      assonance: ['cap', 'ham', 'happy'],
      consonance: ['cut', 'hot', 'caught']
    });
  });

  it('ranks the words nearest the target first', () => {
    const results = findRhymes(INDEX, 'cat', FILTERS);
    // "cap" and "ham" are the target's own one syllable; "happy" has two.
    assert.deepEqual(results.assonance, ['cap', 'ham', 'happy']);
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

describe('FUNCTION_WORDS', () => {
  it('is a closed grammatical class, not a frequency cutoff', () => {
    for (const word of ['a', 'the', 'and', 'is', 'to', 'it', 'my', 'he']) {
      assert.ok(FUNCTION_WORDS.has(word), `${word} should be a function word`);
    }
    // Common words that must stay markable — the whole reason the list is
    // hand-written rather than a frequency threshold.
    assert.equal(FUNCTION_WORDS.has('night'), false);
    assert.equal(FUNCTION_WORDS.has('love'), false);
  });

  it('lists contractions without their apostrophe', () => {
    for (const word of ['aint', 'cant', 'dont', 'im', 'ill', 'gonna', 'wanna', 'em', 'ya', 'imma']) {
      assert.ok(FUNCTION_WORDS.has(word), `${word} should be listed unapostrophised`);
    }
  });
});

describe('groupRhymeMarks', () => {
  // A dictionary of its own: findRhymes' expectations above are exact lists
  // scoped to `cat`, and adding words that share its vowel would change them.
  const MARK_DICTIONARY = {
    cat: [['K', 'AE1', 'T']],
    hat: [['HH', 'AE1', 'T']],
    sea: [['S', 'IY1']],
    me: [['M', 'IY1']],
    free: [['F', 'R', 'IY1']],
    he: [['HH', 'IY1']],
    hand: [['HH', 'AE1', 'N', 'D']],
    man: [['M', 'AE1', 'N']],
    tan: [['T', 'AE1', 'N']],
    night: [['N', 'AY1', 'T']],
    sky: [['S', 'K', 'AY1']],
    light: [['L', 'AY1', 'T']],
    sight: [['S', 'AY1', 'T']],
    day: [['D', 'EY1']],
    way: [['W', 'EY1']],
    hot: [['HH', 'AA1', 'T']],
    caught: [['K', 'AO1', 'T']],
    wont: [['W', 'OW1', 'N', 'T']],
    dont: [['D', 'OW1', 'N', 'T']]
  };
  const MARK_INDEX = buildRhymeIndex(MARK_DICTIONARY);

  function textOf(line, mark) {
    return line.slice(mark.start, mark.end);
  }

  it('never marks a function word, even when it anchors a real family', () => {
    const lines = ['out on the sea', 'he ran so free'];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    assert.ok(marks[0].some((m) => textOf(lines[0], m) === 'sea'));
    assert.ok(marks[1].some((m) => textOf(lines[1], m) === 'free'));
    assert.equal(marks[1].some((m) => textOf(lines[1], m) === 'he'), false);
  });

  it('strips the apostrophe before checking the function-word list', () => {
    // If the strip were missing, "don't" would slip through as a normal
    // candidate and perfect-rhyme with "wont", marking both.
    const lines = ['it will not be wont', "but still you don't care"];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    assert.deepEqual(marks[0], []);
    assert.deepEqual(marks[1], []);
  });

  it('never marks a word with no rhyme partner', () => {
    const lines = ['a lonely cat walked here'];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    assert.deepEqual(marks[0], []);
  });

  it('does not mark two occurrences of the same word by themselves', () => {
    const lines = ['the night was long and the night was still'];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    assert.deepEqual(marks[0], []);
  });

  it('rescues a subtractive pair that shares a coda edge', () => {
    const lines = ['I raised my hand up high', 'and called out to the man'];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    const handMark = marks[0].find((m) => textOf(lines[0], m) === 'hand');
    const manMark = marks[1].find((m) => textOf(lines[1], m) === 'man');
    assert.ok(handMark && manMark, 'hand and man should both be marked');
    assert.equal(handMark.family, manMark.family);
  });

  it('does not rescue a subtractive pair without a shared coda edge', () => {
    const lines = ['all through the night I walked', 'gazing up at the sky above'];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    assert.deepEqual(marks[0], []);
    assert.deepEqual(marks[1], []);
  });

  it('excludes a rhyme outside the line window', () => {
    const lines = ['a kite drifted in the wind', 'zzyzx', 'zzyzx', 'zzyzx', 'zzyzx', 'a bite of cake'];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    assert.equal(marks[0].some((m) => textOf(lines[0], m) === 'kite'), false);
    assert.equal(marks[5].some((m) => textOf(lines[5], m) === 'bite'), false);
  });

  it("colours an end-rhyme family with its own gutter letter's index", () => {
    const lines = ['I saw a cat', 'wearing a hat'];
    const { labels, marks } = groupRhymeMarks(MARK_INDEX, lines);
    assert.deepEqual(labels, ['A', 'A']);
    const catMark = marks[0].find((m) => textOf(lines[0], m) === 'cat');
    const hatMark = marks[1].find((m) => textOf(lines[1], m) === 'hat');
    assert.ok(catMark && hatMark);
    assert.equal(catMark.family, 0);
    assert.equal(hatMark.family, 0);
  });

  it('marks the fifth family of a stanza in overflow rather than dropping it', () => {
    const lines = [
      'a cat and a hat sat down',
      'a man in a tan coat walked',
      'the light and the sight glowed',
      'a day and a way appeared',
      'it was hot and caught somehow'
    ];
    const { marks } = groupRhymeMarks(MARK_INDEX, lines);
    for (let i = 0; i < 4; i++) {
      assert.ok(marks[i].every((m) => m.family !== OVERFLOW_FAMILY), `line ${i} should have a real colour`);
      assert.ok(marks[i].length > 0, `line ${i} should still be marked`);
    }
    assert.ok(marks[4].length > 0, 'the fifth family is marked, not dropped');
    assert.ok(marks[4].every((m) => m.family === OVERFLOW_FAMILY));
  });

  it("keeps a family's colour index stable as the stanza grows", () => {
    const base = ['a cat and a hat sat down', 'a man in a tan coat walked'];
    const grown = base.concat(['the light and the sight glowed']);
    const before = groupRhymeMarks(MARK_INDEX, base).marks;
    const after = groupRhymeMarks(MARK_INDEX, grown).marks;
    const familyOf = (marks, lineIdx, line, word) =>
      marks[lineIdx].find((m) => textOf(line, m) === word).family;
    assert.equal(familyOf(before, 0, base[0], 'cat'), familyOf(after, 0, grown[0], 'cat'));
    assert.equal(familyOf(before, 1, base[1], 'man'), familyOf(after, 1, grown[1], 'man'));
  });
});
