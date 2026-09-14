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

// Rank 0 is the most frequent word; the file is already sorted by count.
async function loadFrequencyRanks() {
  const words = firstColumn(await readText(TOOLS_DIR, 'word-frequency.txt'));
  const ranks = new Map();
  words.forEach((word, rank) => {
    if (!ranks.has(word)) ranks.set(word, rank);
  });
  return ranks;
}

// Most-searched first, as written by collect-popular-words.mjs.
async function loadPopularWords() {
  return firstColumn(await readText(TOOLS_DIR, 'popular-words.tsv'));
}

export async function loadBuildData() {
  const [dictionary, englishWords, blocklist, ranks, popularWords] = await Promise.all([
    readRepoJson('cmudict.json'),
    readRepoJson('english-words.json').then((words) => new Set(words)),
    readRepoJson('blocklist.json').then((words) => new Set(words)),
    loadFrequencyRanks(),
    loadPopularWords()
  ]);
  return { dictionary, filters: { englishWords, blocklist }, ranks, popularWords };
}
