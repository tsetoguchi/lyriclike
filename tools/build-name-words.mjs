// Writes name-words.json: the words in english-words.json that English only
// spells with a capital — "wayne", "spain", "dwayne". The rhymes panel sends
// them to the back of each group, behind the words a lyric can actually use.
//
// The signal is the Hunspell en_US spelling dictionary (SCOWL), which lists a
// name capitalized and an ordinary word in lower case. A word it lists both
// ways ("will", "chase", "may") is an ordinary word and stays where it is.
// Run rarely; the output is committed.
//
//   node tools/build-name-words.mjs

import { readFile, writeFile } from 'node:fs/promises';

const REPO_ROOT = new URL('../', import.meta.url);
const WORD_LIST = new URL('english-words.json', REPO_ROOT);
const OUTPUT = new URL('name-words.json', REPO_ROOT);
const DICTIONARY_URL = 'https://cdn.jsdelivr.net/npm/dictionary-en@4.0.0/index.dic';
const LOWER_CASE_ENTRY = /^[a-z']+$/;
const CAPITALIZED_ENTRY = /^[A-Z][a-z']+$/;
// Hunspell stores "flowers" as "flower/S", so a plural or past tense of an
// ordinary word never appears in lower case itself. Undoing the common
// endings keeps those words out of the list.
const INFLECTIONS = [
  ['ies', 'y'], ['ied', 'y'], ['es', ''], ['s', ''], ['ed', ''], ['ed', 'e'],
  ['d', ''], ['ing', ''], ['ing', 'e'], ['er', ''], ['r', ''], ['ly', '']
];
// Words the dictionary lists only capitalized that a lyric still uses as
// ordinary words: "As" is arsenic, "Grey" is the British spelling, and days,
// months and holidays are wanted rhymes, not someone's name.
const NOT_NAMES = new Set([
  'as', 'grey',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'christmas', 'easter', 'halloween'
]);
const MIN_NAME_LENGTH = 2;

async function loadDictionaryEntries() {
  const response = await fetch(DICTIONARY_URL);
  if (!response.ok) throw new Error(`loadDictionaryEntries: HTTP ${response.status}`);
  const text = await response.text();
  // The first line is the entry count, not an entry.
  return text.split('\n').slice(1).map((line) => line.split('/')[0].trim()).filter(Boolean);
}

function splitByCase(entries) {
  const lowerCase = new Set();
  const capitalized = new Set();
  for (const entry of entries) {
    if (LOWER_CASE_ENTRY.test(entry)) lowerCase.add(entry);
    else if (CAPITALIZED_ENTRY.test(entry)) capitalized.add(entry.toLowerCase());
  }
  return { lowerCase, capitalized };
}

function isOrdinaryWord(word, lowerCase) {
  if (lowerCase.has(word)) return true;
  return INFLECTIONS.some(([ending, replacement]) => word.endsWith(ending)
    && lowerCase.has(word.slice(0, -ending.length) + replacement));
}

function isName(word, cases) {
  if (word.length < MIN_NAME_LENGTH || NOT_NAMES.has(word)) return false;
  return cases.capitalized.has(word) && !isOrdinaryWord(word, cases.lowerCase);
}

async function main() {
  const [words, entries] = await Promise.all([
    readFile(WORD_LIST, 'utf8').then(JSON.parse),
    loadDictionaryEntries()
  ]);
  const cases = splitByCase(entries);
  // Kept in english-words.json's order, commonest first, so the file reads
  // sensibly and diffs stay small when the word list is re-sorted.
  const names = words.filter((word) => isName(word, cases));
  await writeFile(OUTPUT, JSON.stringify(names) + '\n', 'utf8');
  console.log(`${names.length} names of ${words.length} words`);
  console.log('first ten:', names.slice(0, 10).join(', '));
}

main();
