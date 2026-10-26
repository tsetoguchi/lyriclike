// Decides what each rhyme page says: which words to show, in what order, and
// the one-sentence answer at the top. Pure data in, plain objects out; the
// HTML lives in render-html.mjs.

import rhymeCore from '../../rhyme-core.js';
import { toIpa } from './pronounce.mjs';

const {
  RHYME_TYPES, countSyllables, extractEndRhymePart, getStressedSyllable, rankRhymeWords, tierRhymeWords
} = rhymeCore;

const MAX_WORDS_PER_TYPE = 100;
const SUMMARY_EXAMPLE_COUNT = 5;
// Strongest first, so the answer at the top draws from the closest sounds.
const NEAR_RHYME_TYPES = ['family', 'additive', 'subtractive'];
const LOOSE_RHYME_TYPES = ['assonance', 'consonance'];
// Every type that keeps the stressed vowel, so a word from any of them can
// still be heard as a rhyme when its last syllable matches too.
const STRESSED_VOWEL_TYPES = [...NEAR_RHYME_TYPES, 'assonance'];
// Common words first, then closest sound: the same tiers and order the
// editor's panel uses, so a page and the app never disagree about which rhyme
// is the best one. The editor lists names, rare words and crude words last; a
// page leaves them out, since it is often the first thing a visitor sees. It
// also leaves out the words ad networks treat as sensitive.
function rankRhymes(words, context) {
  const listed = words.filter((word) => !context.pageExcluded.has(word));
  const ranked = rankRhymeWords(context.index, context.word, listed, context.ranks);
  return tierRhymeWords(ranked, context.ranks, context.names, context.crude)
    .filter(({ tier }) => tier !== 'buried');
}

function groupBySyllables(entries, index) {
  const groups = new Map();
  for (const entry of entries) {
    const syllables = countSyllables(index, entry.word);
    if (!groups.has(syllables)) groups.set(syllables, []);
    groups.get(syllables).push(entry);
  }
  return [...groups].sort((a, b) => a[0] - b[0]).map(([syllables, list]) => ({ syllables, words: list }));
}

function buildSection(type, results, context) {
  const shown = rankRhymes(results[type.key], context).slice(0, MAX_WORDS_PER_TYPE);
  return {
    ...type,
    total: results[type.key].length,
    shownCount: shown.length,
    groups: groupBySyllables(shown, context.index)
  };
}

// A type whose every word was left out gets no section, rather than a heading
// over an empty list.
function buildSections(results, context) {
  return RHYME_TYPES
    .map((type) => buildSection(type, results, context))
    .filter((section) => section.shownCount > 0);
}

// Fills from the strongest type before touching the next, so a handful of
// family rhymes are never crowded out by hundreds of weaker subtractive ones.
function topWords(results, typeKeys, context) {
  const examples = [];
  for (const key of typeKeys) {
    const needed = SUMMARY_EXAMPLE_COUNT - examples.length;
    if (needed <= 0) break;
    examples.push(...rankRhymes(results[key], context).slice(0, needed).map(({ word }) => word));
  }
  return examples;
}

function rankedWords(results, typeKeys, context) {
  return typeKeys.flatMap((key) => rankRhymes(results[key], context).map(({ word }) => word));
}

function endingSound(index, word) {
  const part = extractEndRhymePart(index.dictionary[word][0]);
  return part ? [part.vowel, ...part.coda].join(' ') : null;
}

// "Oranges" for "orange" or "silverware" for "silver" is the word again, not
// a rhyme for it.
function isFormOf(word, target) {
  return word.includes(target) || target.includes(word);
}

// Same syllable count and same last syllable: "finish" for "english" keeps
// the whole sound, where "thing" keeps only the stressed vowel.
function hasSameShape(word, context) {
  const { index } = context;
  if (countSyllables(index, word) !== context.targetSyllables) return false;
  return endingSound(index, word) === context.targetEnding;
}

// With no perfect rhyme, ranking by commonness alone leads with short words
// that drop the end of the target, so same-shape words go first.
function nearExamples(results, context) {
  const isFresh = (word) => !isFormOf(word, context.word);
  const near = rankedWords(results, NEAR_RHYME_TYPES, context).filter(isFresh);
  const sameShape = context.targetEnding
    ? rankedWords(results, STRESSED_VOWEL_TYPES, context)
      .filter((word) => isFresh(word) && hasSameShape(word, context))
    : [];
  return [...new Set([...sameShape, ...near])].slice(0, SUMMARY_EXAMPLE_COUNT);
}

function buildSummary(results, context) {
  const perfect = topWords(results, ['perfect'], context);
  if (perfect.length > 0) return { kind: 'perfect', examples: perfect, total: results.perfect.length };
  const near = nearExamples(results, context);
  if (near.length > 0) return { kind: 'near', examples: near };
  return { kind: 'loose', examples: topWords(results, LOOSE_RHYME_TYPES, context) };
}

export function countListedRhymes(results) {
  return RHYME_TYPES.reduce((sum, { key }) => sum + results[key].length, 0);
}

export function buildPageModel({ word, results, index, ranks, names, crude, pageExcluded, related, meaning, pronunciation }) {
  const targetSyllables = countSyllables(index, word);
  const targetEnding = endingSound(index, word);
  const context = { index, ranks, names, crude, pageExcluded, word, targetSyllables, targetEnding };
  return {
    word,
    syllables: targetSyllables,
    stressedSyllable: getStressedSyllable(index, word),
    ipa: toIpa(pronunciation),
    meaning,
    summary: buildSummary(results, context),
    sections: buildSections(results, context),
    related
  };
}
