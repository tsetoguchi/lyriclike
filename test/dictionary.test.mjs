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
  groupRhymeMarks, tierRhymeWords, FUNCTION_WORDS
} = rhymeCore;

const REPO_ROOT = new URL('../', import.meta.url);
const SAMPLE_WORDS = ['love', 'heart', 'night', 'fire', 'money', 'time', 'away'];

async function readRepoJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, REPO_ROOT), 'utf8'));
}

let index;
let filters;
let nameWords;
let crudeWords;

before(async () => {
  const [dictionary, englishWords, blocklist, names, crude] = await Promise.all([
    readRepoJson('cmudict.json'),
    readRepoJson('english-words.json'),
    readRepoJson('blocklist.json'),
    readRepoJson('name-words.json'),
    readRepoJson('crude-words.json')
  ]);
  nameWords = new Set(names);
  crudeWords = new Set(crude);
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

  it('opens a group on usable words, with names and rare words behind them', () => {
    const perfect = tierRhymeWords(findRhymes(index, 'rain', filters).perfect,
      filters.wordRanks, nameWords);
    // Roughly the first row of chips in the panel.
    const firstRow = perfect.slice(0, 8).map(({ word }) => word);
    for (const buried of ['wayne', 'dwayne', 'legerdemain', 'jane', 'spain']) {
      assert.ok(!firstRow.includes(buried), `first row lists ${buried}`);
    }
    assert.ok(firstRow.includes('pain') && firstRow.includes('train'));
    const buried = perfect.filter(({ tier }) => tier === 'buried').map(({ word }) => word);
    assert.ok(buried.includes('wayne') && buried.includes('legerdemain'));
  });

  it('never opens a group on a crude word', () => {
    const assonance = tierRhymeWords(findRhymes(index, 'love', filters).assonance,
      filters.wordRanks, nameWords, crudeWords);
    const unburied = assonance.filter(({ tier }) => tier !== 'buried').map(({ word }) => word);
    for (const crude of ['fuck', 'fucked', 'slut']) {
      assert.ok(!unburied.includes(crude), `love lists ${crude} ahead of the buried words`);
    }
  });

  it('only lists real words as crude', () => {
    for (const word of crudeWords) {
      assert.ok(filters.englishWords.has(word), `${word} is not in english-words.json`);
    }
  });

  it('never lists an everyday word as a name', () => {
    for (const word of ['will', 'chase', 'may', 'flowers', 'monday', 'grey']) {
      assert.ok(!nameWords.has(word), `${word} is listed as a name`);
    }
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
    // heard as a rhyme inside a line; neither is money's unstressed "-ey"
    // against feel.
    assert.deepEqual(new Set(markedWords), new Set([
      'night', 'light', 'tight', 'fight', 'feel', 'real', 'deal'
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

  it('does not underline a line-final "yeah" that only shares a scheme letter', () => {
    const verse = [
      'it’s okay to be unhappy', 'it’s okay to show that I’m lonely',
      'I’ll just take my time living for me', 'It’s only a matter of time yeah',
      'I’ll just keep loving myself yeah'
    ];
    const markedWords = groupRhymeMarks(index, verse).marks.flatMap((lineMarks, i) =>
      lineMarks.map(({ start, end }) => verse[i].slice(start, end)));
    assert.equal(markedWords.includes('yeah'), false);
    assert.equal(markedWords.includes('unhappy'), true);
  });

  it('marks a line-final "down" that rhymes with drown and around', () => {
    const verse = ['Falling upside down', 'Trying not to drown', 'I know you’re not around'];
    const markedWords = groupRhymeMarks(index, verse).marks.flatMap((lineMarks, i) =>
      lineMarks.map(({ start, end }) => verse[i].slice(start, end)));
    assert.deepEqual(markedWords, ['down', 'drown', 'around']);
  });

  it('reads a word in single quotes', () => {
    const verse = ["she whispered 'goodnight'", 'and turned out the light'];
    assert.deepEqual(computeRhymeScheme(index, verse), ['A', 'A']);
    const markedWords = groupRhymeMarks(index, verse).marks.flatMap((lineMarks, i) =>
      lineMarks.map(({ start, end }) => verse[i].slice(start, end)));
    assert.ok(markedWords.includes("'goodnight'"));
  });

  it('keeps a word with two pronunciations in one family', () => {
    // "re" is both "ray" and "ree"; it must not join "say" to "feel".
    const verse = ['I know you re not around', 'I feel nothing wrong', 'They say what is done'];
    const { marks } = groupRhymeMarks(index, verse);
    const familyOf = (lineIdx, word) => {
      const mark = marks[lineIdx].find((m) => verse[lineIdx].slice(m.start, m.end) === word);
      return mark ? mark.family : null;
    };
    // The stronger rhyme claims "re" first (ray/say is perfect, ree/feel is
    // not), and once "re" is said one way it cannot also be said the other.
    assert.notEqual(familyOf(0, 're'), null);
    assert.equal(familyOf(0, 're'), familyOf(2, 'say'));
    assert.notEqual(familyOf(1, 'feel'), familyOf(2, 'say'));
  });

  describe('internal rhymes on a realistic stanza', () => {
    // Regression checks from plans/internal-rhyme-evaluation.md, run against
    // the real dictionary rather than hand-written phonemes.
    function marksOf(verse) {
      const { labels, marks } = groupRhymeMarks(index, verse);
      const found = marks.flatMap((lineMarks, i) => lineMarks.map((m) => ({
        text: verse[i].slice(m.start, m.end), line: i, family: m.family, isSlant: m.isSlant
      })));
      return { labels, found };
    }

    it('puts a line-ending word and a mid-line word that rhyme with it in one family', () => {
      const { found } = marksOf([
        'I watch the night, beneath the starry sky',
        'I dream of love that will never die'
      ]);
      const family = (word) => found.find((m) => m.text === word)?.family;
      assert.notEqual(family('night'), undefined);
      assert.equal(family('sky'), family('night'));
      assert.equal(family('die'), family('night'));
    });

    it('does not mark the stock word "every" against me or sea', () => {
      const { found } = marksOf([
        'In every note and rhyme, there is a part of you and me',
        'With every word I sing, with every chord I play',
        'In every shade and way, from the mountains to the sea'
      ]);
      assert.equal(found.some((m) => m.text === 'every'), false);
    });

    it('draws end rhymes in the colour of their gutter letter', () => {
      const { labels, found } = marksOf(['I see your face', 'in a silent space']);
      assert.deepEqual(labels, ['A', 'A']);
      for (const word of ['face', 'space']) {
        assert.equal(found.find((m) => m.text === word)?.family, 0);
      }
    });

    it('ignores a weak-form pronunciation, so good does not rhyme with lit', () => {
      // The dictionary also lists "good" as G IH0 D; only the stressed UH1 counts.
      const { found } = marksOf(['the moon is lit like the sky', 'turned tears into diamonds, got good']);
      assert.equal(found.some((m) => m.text === 'good' || m.text === 'lit'), false);
    });

    it('does not put paint and shade in one family through way', () => {
      const { found } = marksOf(['I paint a shade today', 'we play and I stay', 'a way to say']);
      const family = (word) => found.find((m) => m.text === word)?.family;
      const shared = family('paint') !== undefined && family('paint') === family('shade');
      assert.equal(shared, false);
    });

    it('draws an exact rhyme solid and a near rhyme slant', () => {
      const exact = marksOf(['a quiet night', 'a golden light']).found;
      assert.ok(exact.length > 0);
      assert.ok(exact.every((m) => m.isSlant === false));

      const near = marksOf(['a quiet night', 'a golden like']).found;
      assert.ok(near.every((m) => m.isSlant === true));
    });
  });
});
