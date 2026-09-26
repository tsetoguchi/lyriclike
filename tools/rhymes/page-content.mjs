// Decides what each rhyme page says: which words to show, in what order, and
// the one-sentence answer at the top. Pure data in, plain objects out; the
// HTML lives in render-html.mjs.

import rhymeCore from '../../rhyme-core.js';

const { RHYME_TYPES, countSyllables, getStressedSyllable, rankRhymeWords, tierRhymeWords } = rhymeCore;

const MAX_WORDS_PER_TYPE = 100;
const SUMMARY_EXAMPLE_COUNT = 5;
// Strongest first, so the answer at the top draws from the closest sounds.
const NEAR_RHYME_TYPES = ['family', 'additive', 'subtractive'];
const LOOSE_RHYME_TYPES = ['assonance', 'consonance'];
// Common words first, then closest sound: the same tiers and order the
// editor's panel uses, so a page and the app never disagree about which rhyme
// is the best one. The editor lists names, rare words and crude words last; a
// page leaves them out, since it is often the first thing a visitor sees.
function rankRhymes(words, context) {
  const ranked = rankRhymeWords(context.index, context.word, words, context.ranks);
  return tierRhymeWords(ranked, context.ranks, context.names, context.crude)
    .filter(({ tier }) => tier !== 'buried')
    .map(({ word }) => word);
}

function groupBySyllables(words, index) {
  const groups = new Map();
  for (const word of words) {
    const syllables = countSyllables(index, word);
    if (!groups.has(syllables)) groups.set(syllables, []);
    groups.get(syllables).push(word);
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
    examples.push(...rankRhymes(results[key], context).slice(0, needed));
  }
  return examples;
}

function buildSummary(results, context) {
  const perfect = topWords(results, ['perfect'], context);
  if (perfect.length > 0) return { kind: 'perfect', examples: perfect, total: results.perfect.length };
  const near = topWords(results, NEAR_RHYME_TYPES, context);
  if (near.length > 0) return { kind: 'near', examples: near };
  return { kind: 'loose', examples: topWords(results, LOOSE_RHYME_TYPES, context) };
}

export function countListedRhymes(results) {
  return RHYME_TYPES.reduce((sum, { key }) => sum + results[key].length, 0);
}

export function buildPageModel({ word, results, index, ranks, names, crude, related }) {
  const targetSyllables = countSyllables(index, word);
  const context = { index, ranks, names, crude, word };
  return {
    word,
    syllables: targetSyllables,
    stressedSyllable: getStressedSyllable(index, word),
    totalRhymes: countListedRhymes(results),
    summary: buildSummary(results, context),
    sections: buildSections(results, context),
    related
  };
}
