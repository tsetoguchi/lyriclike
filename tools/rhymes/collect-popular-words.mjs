// Ranks the words people most often look up rhymes for, using Google's
// autocomplete: its suggestions for "words that rhyme with a..." are ordered
// by search popularity. Run rarely; the output is committed.
//
//   node tools/rhymes/collect-popular-words.mjs

import { writeFile } from 'node:fs/promises';

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const REQUEST_DELAY_MS = 250;
const MAX_CONSECUTIVE_FAILURES = 5;
const SUGGESTIONS_PER_QUERY = 10;
const MIN_WORD_LENGTH = 2;
const OUTPUT_URL = new URL('./popular-words.tsv', import.meta.url);

// Two-letter prefixes only for the dominant phrasing; the others add
// coverage of the head terms without multiplying the request count.
const DEEP_PHRASE = 'words that rhyme with ';
const SHALLOW_PHRASES = ['what rhymes with ', 'rhymes with '];
const SINGLE_WORD = /^[a-z]+$/;

function buildPrefixes() {
  const letters = ALPHABET.split('');
  const pairs = letters.flatMap((first) => letters.map((second) => first + second));
  const queries = [...letters, ...pairs].map((prefix) => DEEP_PHRASE + prefix);
  for (const phrase of SHALLOW_PHRASES) {
    queries.push(...letters.map((letter) => phrase + letter));
  }
  return queries;
}

async function fetchSuggestions(query) {
  const params = new URLSearchParams({ client: 'firefox', hl: 'en', gl: 'us', q: query });
  const response = await fetch(`${SUGGEST_URL}?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status} for "${query}"`);
  const body = await response.json();
  return body[1];
}

function extractWord(suggestion, query) {
  const phrase = query.replace(/[a-z]+$/, '');
  if (!suggestion.startsWith(phrase)) return null;
  const word = suggestion.slice(phrase.length).trim();
  // Autocomplete often echoes the typed prefix back ("...rhyme with q"),
  // which says nothing about what people search for.
  if (suggestion === query || word.length < MIN_WORD_LENGTH) return null;
  return SINGLE_WORD.test(word) ? word : null;
}

function addScores(scores, suggestions, query) {
  suggestions.forEach((suggestion, position) => {
    const word = extractWord(suggestion, query);
    if (!word) return;
    scores.set(word, (scores.get(word) || 0) + SUGGESTIONS_PER_QUERY - position);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectScores(queries) {
  const scores = new Map();
  let consecutiveFailures = 0;
  for (const query of queries) {
    try {
      addScores(scores, await fetchSuggestions(query), query);
      consecutiveFailures = 0;
    } catch (err) {
      console.error(err.message);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error('Too many failures in a row; stopping so as not to hammer the endpoint');
      }
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return scores;
}

function formatScores(scores) {
  const ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.map(([word, score]) => `${word}\t${score}`).join('\n') + '\n';
}

async function main() {
  const queries = buildPrefixes();
  console.log(`Querying ${queries.length} prefixes...`);
  const scores = await collectScores(queries);
  await writeFile(OUTPUT_URL, formatScores(scores));
  console.log(`Wrote ${scores.size} words to ${OUTPUT_URL.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
