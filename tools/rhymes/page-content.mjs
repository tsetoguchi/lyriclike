// Decides what each rhyme page says: which words to show, in what order, and
// the one-sentence answer at the top. Pure data in, plain objects out; the
// HTML lives in render-html.mjs.

import rhymeCore from '../../rhyme-core.js';

const { RHYME_TYPES, countSyllables, getStressedSyllable } = rhymeCore;

const MAX_WORDS_PER_TYPE = 100;
const SUMMARY_EXAMPLE_COUNT = 5;
// Strongest first, so the answer at the top draws from the closest sounds.
const NEAR_RHYME_TYPES = ['family', 'additive', 'subtractive'];
const LOOSE_RHYME_TYPES = ['assonance', 'consonance'];
const UNRANKED = Number.POSITIVE_INFINITY;

// Closest sound first, then commonest word. The editor's categories treat the
// AA/AO vowels as one, which lets "heart" list "sort" as perfect; putting
// exact vowel matches ahead keeps "start" and "part" at the top of the page.
function compareRhymes(a, b, context) {
  const { index, ranks, target, targetSyllables } = context;
  const partA = index.rhymeIndex[a];
  const partB = index.rhymeIndex[b];
  const vowelMissA = partA.vowel === target.vowel ? 0 : 1;
  const vowelMissB = partB.vowel === target.vowel ? 0 : 1;
  const codaGapA = Math.abs(partA.coda.length - target.coda.length);
  const codaGapB = Math.abs(partB.coda.length - target.coda.length);
  const syllableGapA = Math.abs(countSyllables(index, a) - targetSyllables);
  const syllableGapB = Math.abs(countSyllables(index, b) - targetSyllables);
  const rankA = ranks.get(a) ?? UNRANKED;
  const rankB = ranks.get(b) ?? UNRANKED;
  return (vowelMissA - vowelMissB)
    || (codaGapA - codaGapB)
    || (syllableGapA - syllableGapB)
    || (rankA === rankB ? 0 : rankA < rankB ? -1 : 1)
    || a.localeCompare(b);
}

function rankRhymes(words, context) {
  return [...words].sort((a, b) => compareRhymes(a, b, context));
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

function buildSections(results, context) {
  return RHYME_TYPES.filter(({ key }) => results[key].length > 0).map((type) => {
    const shown = rankRhymes(results[type.key], context).slice(0, MAX_WORDS_PER_TYPE);
    return {
      ...type,
      total: results[type.key].length,
      shownCount: shown.length,
      groups: groupBySyllables(shown, context.index)
    };
  });
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

export function buildPageModel({ word, results, index, ranks, related }) {
  const targetSyllables = countSyllables(index, word);
  const context = { index, ranks, target: index.rhymeIndex[word], targetSyllables };
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
