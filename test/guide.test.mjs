// The guide at /guide/ describes the app in words, so these tests fail when the
// app is renamed or changes what it does and the guide is left behind.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

import rhymeCore from '../rhyme-core.js';
import sampleVerse from '../sample-verse.js';

const { RHYME_TYPES, buildRhymeIndex, countSyllablesForLine, findRhymes, groupRhymeMarks } =
  rhymeCore;
const { SAMPLE_VERSE } = sampleVerse;

const REPO_ROOT = new URL('../', import.meta.url);
const SCHEME_COLOR_COUNT = 10;
const NAMED_ENTITIES = { amp: '&', ndash: '–', mdash: '—', lt: '<', gt: '>', quot: '"' };
const SORT_BUTTON = /<button[^>]*data-order="[^"]*"[^>]*>([^<]+)<\/button>/g;
const EXAMPLE_CHIP = /data-type="(\w+)" data-for="(\w+)">(\w+)</g;
const VERSE_LINE = /<p class="specimen-line">(.*?)<\/p>/g;

async function readRepoFile(relativePath) {
  return readFile(new URL(relativePath, REPO_ROOT), 'utf8');
}

function decodeEntities(html) {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(\w+);/g, (match, name) => NAMED_ENTITIES[name] ?? match);
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ''));
}

function matchAll(pattern, text) {
  return [...text.matchAll(pattern)];
}

let guideHtml;
let guideText;
let index;
let filters;

before(async () => {
  const [guide, dictionary, englishWords, blocklist] = await Promise.all([
    readRepoFile('guide/index.html'),
    readRepoFile('cmudict.json').then(JSON.parse),
    readRepoFile('english-words.json').then(JSON.parse),
    readRepoFile('blocklist.json').then(JSON.parse)
  ]);
  guideHtml = guide;
  guideText = stripTags(guide);
  index = buildRhymeIndex(dictionary);
  const wordRanks = new Map();
  englishWords.forEach((word, rank) => {
    if (!wordRanks.has(word)) wordRanks.set(word, rank);
  });
  filters = { englishWords: new Set(englishWords), blocklist: new Set(blocklist), wordRanks };
});

describe('the guide names what the app names', () => {
  it('mentions every kind of rhyme', () => {
    for (const { name } of RHYME_TYPES) {
      assert.ok(guideText.includes(name), `guide never says ${name}`);
    }
  });

  it('mentions every sort option', async () => {
    const appHtml = await readRepoFile('index.html');
    const labels = matchAll(SORT_BUTTON, appHtml).map(([, label]) => decodeEntities(label.trim()));
    assert.ok(labels.length >= 4, 'found the sort options in index.html');
    for (const label of labels) {
      assert.ok(guideText.includes(label), `guide never says ${label}`);
    }
  });
});

describe('the guide examples are real rhymes', () => {
  it('lists each example under the kind it claims', () => {
    const chips = matchAll(EXAMPLE_CHIP, guideHtml);
    assert.equal(chips.length, RHYME_TYPES.length, 'one example per kind');
    for (const [, type, base, example] of chips) {
      const results = findRhymes(index, base, filters);
      assert.ok(results[type].includes(example), `${example} is not a ${type} rhyme of ${base}`);
    }
  });
});

describe('the sample verse in the guide matches the editor', () => {
  const lines = SAMPLE_VERSE.split('\n');
  const ARIA_HIDDEN_CELL = /<span class="specimen-(count|letter)[^>]*>([^<]*)</g;
  const WHOLE_ARIA_HIDDEN_CELL = /<span class="specimen-(?:count|letter)[^>]*>[^<]*<\/span>/g;

  function specimenLines() {
    return matchAll(VERSE_LINE, guideHtml).map(([, html]) => html);
  }

  it('shows the verse itself', () => {
    const shown = specimenLines().map((html) => stripTags(html.replace(WHOLE_ARIA_HIDDEN_CELL, '')));
    assert.deepEqual(shown, lines);
  });

  it('shows the same syllable counts and rhyme letters', () => {
    const { labels } = groupRhymeMarks(index, lines);
    specimenLines().forEach((html, lineNumber) => {
      const cells = Object.fromEntries(
        matchAll(ARIA_HIDDEN_CELL, html).map(([, kind, text]) => [kind, text])
      );
      assert.equal(Number(cells.count), countSyllablesForLine(index, lines[lineNumber]));
      assert.equal(cells.letter, labels[lineNumber]);
    });
  });

  it('underlines the same words in the same colour and style', () => {
    const { marks } = groupRhymeMarks(index, lines);
    const expected = marks.map((lineMarks, lineNumber) => lineMarks
      .map(({ start, end, family, isSlant }) => ({
        word: lines[lineNumber].slice(start, end),
        color: family % SCHEME_COLOR_COUNT,
        isSlant
      }))
      .sort((a, b) => lines[lineNumber].indexOf(a.word) - lines[lineNumber].indexOf(b.word)));

    const MARK_SPAN = /<span class="mark mark-(\d+)([^"]*)">(\w+)<\/span>/g;
    const shown = specimenLines().map((html) => matchAll(MARK_SPAN, html).map(
      ([, color, classes, word]) => ({
        word, color: Number(color), isSlant: classes.includes('is-slant')
      })
    ));
    assert.deepEqual(shown, expected);
  });
});

describe('what the guide says about repeats', () => {
  it('draws a word and its prefixed twin as a near rhyme', () => {
    const { marks } = groupRhymeMarks(index, ['I know the only way', 'And so I walk away']);
    assert.ok(marks.flat().length > 0 && marks.flat().every((mark) => mark.isSlant));
  });
});
