// Loads the inputs the rhyme-page build reads: the app's own dictionary and
// filter lists from the repo root, plus the two ranking lists kept here.

import { readFile } from 'node:fs/promises';

export const REPO_ROOT = new URL('../../', import.meta.url);
const TOOLS_DIR = new URL('./', import.meta.url);

async function readText(baseUrl, relativePath) {
  return readFile(new URL(relativePath, baseUrl), 'utf8');
}

async function readRepoJson(relativePath) {
  return JSON.parse(await readText(REPO_ROOT, relativePath));
}

function firstColumn(text) {
  return text.split('\n').map((line) => line.split(/\s/)[0]).filter(Boolean);
}

// Most frequent first; the file is already sorted by count.
async function loadFrequentWords() {
  return firstColumn(await readText(TOOLS_DIR, 'word-frequency.txt'));
}

// Rank 0 is the most frequent word.
function rankWords(words) {
  const ranks = new Map();
  words.forEach((word, rank) => {
    if (!ranks.has(word)) ranks.set(word, rank);
  });
  return ranks;
}

// Words that ad networks treat as sensitive. They get no page and are left
// out of every page's lists; the editor still lists them.
async function loadPageExcludedWords() {
  return new Set(JSON.parse(await readText(TOOLS_DIR, 'page-excluded-words.json')));
}

// What each page word means, as written by collect-definitions.mjs. A word
// WordNet has nothing for is null.
async function loadDefinitions() {
  return JSON.parse(await readText(TOOLS_DIR, 'definitions.json'));
}

// Most-searched first, as written by collect-popular-words.mjs.
async function loadPopularWords() {
  return firstColumn(await readText(TOOLS_DIR, 'popular-words.tsv'));
}

export async function loadBuildData() {
  const [dictionary, englishWords, blocklist, names, crude, frequentWords, popularWords, pageExcluded, definitions] = await Promise.all([
    readRepoJson('cmudict.json'),
    readRepoJson('english-words.json').then((words) => new Set(words)),
    readRepoJson('blocklist.json').then((words) => new Set(words)),
    readRepoJson('name-words.json').then((words) => new Set(words)),
    readRepoJson('crude-words.json').then((words) => new Set(words)),
    loadFrequentWords(),
    loadPopularWords(),
    loadPageExcludedWords(),
    loadDefinitions()
  ]);
  const ranks = rankWords(frequentWords);
  return { dictionary, filters: { englishWords, blocklist }, names, crude, ranks, popularWords, frequentWords, pageExcluded, definitions };
}
