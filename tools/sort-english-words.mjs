// Rewrites english-words.json in frequency order, commonest word first.
//
// The list is a membership filter, so its order was free to carry meaning and
// now does: the editor reads a word's position in the array as its rank and
// ranks rhyme results by it. Words the frequency list does not know keep
// alphabetical order behind the ones it does.
//
//   node tools/sort-english-words.mjs

import { readFile, writeFile } from 'node:fs/promises';

const REPO_ROOT = new URL('../', import.meta.url);
const WORD_LIST = new URL('english-words.json', REPO_ROOT);
const FREQUENCY_LIST = new URL('rhymes/word-frequency.txt', new URL('./', import.meta.url));
const UNRANKED = Number.POSITIVE_INFINITY;

async function loadFrequencyRanks() {
  const text = await readFile(FREQUENCY_LIST, 'utf8');
  const ranks = new Map();
  for (const line of text.split('\n')) {
    const word = line.split(/\s/)[0];
    if (word && !ranks.has(word)) ranks.set(word, ranks.size);
  }
  return ranks;
}

function compareByRank(word1, word2, ranks) {
  const rank1 = ranks.get(word1) ?? UNRANKED;
  const rank2 = ranks.get(word2) ?? UNRANKED;
  if (rank1 !== rank2) return rank1 < rank2 ? -1 : 1;
  return word1.localeCompare(word2);
}

async function main() {
  const [words, ranks] = await Promise.all([
    readFile(WORD_LIST, 'utf8').then(JSON.parse),
    loadFrequencyRanks()
  ]);

  const sorted = [...words].sort((word1, word2) => compareByRank(word1, word2, ranks));
  await writeFile(WORD_LIST, JSON.stringify(sorted) + '\n', 'utf8');

  const rankedCount = sorted.filter((word) => ranks.has(word)).length;
  console.log(`${sorted.length} words, ${rankedCount} ranked, ${sorted.length - rankedCount} alphabetical`);
  console.log('first ten:', sorted.slice(0, 10).join(', '));
}

main();
