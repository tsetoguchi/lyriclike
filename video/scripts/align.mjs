import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CURLY_APOSTROPHES = /[‘’]/g;
const WORD_RUNS = /[A-Za-z‘’']+/g;
const NEAR_MATCH_SIMILARITY = 0.5;
const UNHEARD_WORD_SECONDS = 0.3;
const WEAK_ALIGNMENT_MATCH = 0.7;
const SONGS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'songs');

export function normalizeWord(text) {
  return text.toLowerCase().replace(CURLY_APOSTROPHES, "'").replace(/[^a-z']/g, '');
}

function parseLine(line) {
  const words = [];
  for (const match of line.matchAll(WORD_RUNS)) {
    const text = normalizeWord(match[0]);
    if (text === '') continue;
    words.push({
      text,
      raw: match[0],
      charStart: match.index,
      charEnd: match.index + match[0].length
    });
  }
  return words;
}

export function parseLyricLines(lyrics) {
  return lyrics
    .split(/\r?\n/)
    .map(parseLine)
    .filter((words) => words.length > 0);
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    previous = current;
  }
  return previous[b.length];
}

function matchWeight(lyricText, heardText) {
  const longest = Math.max(lyricText.length, heardText.length);
  const similarity = 1 - editDistance(lyricText, heardText) / longest;
  return similarity >= NEAR_MATCH_SIMILARITY ? 1 + similarity : 0;
}

function buildScoreTable(lyricWords, heardWords) {
  const table = Array.from({ length: lyricWords.length + 1 }, () =>
    new Array(heardWords.length + 1).fill(0)
  );
  for (let i = 1; i <= lyricWords.length; i += 1) {
    for (let j = 1; j <= heardWords.length; j += 1) {
      const weight = matchWeight(lyricWords[i - 1].text, heardWords[j - 1].text);
      const diagonal = weight > 0 ? table[i - 1][j - 1] + weight : 0;
      table[i][j] = Math.max(diagonal, table[i - 1][j], table[i][j - 1]);
    }
  }
  return table;
}

function traceMatches(table, lyricWords, heardWords) {
  const heardIndexes = new Array(lyricWords.length).fill(null);
  let i = lyricWords.length;
  let j = heardWords.length;
  while (i > 0 && j > 0) {
    const weight = matchWeight(lyricWords[i - 1].text, heardWords[j - 1].text);
    if (weight > 0 && table[i][j] === table[i - 1][j - 1] + weight) {
      heardIndexes[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (table[i][j] === table[i - 1][j]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return heardIndexes;
}

function findRunBounds(timed, runStart, runEnd) {
  const before = runStart > 0 ? timed[runStart - 1].end : null;
  const after = runEnd < timed.length ? timed[runEnd].start : null;
  const runLength = runEnd - runStart;
  const lead = runLength * UNHEARD_WORD_SECONDS;
  if (before !== null && after !== null) return [before, after];
  if (before !== null) return [before, before + lead];
  if (after !== null) return [Math.max(0, after - lead), after];
  return [0, lead];
}

function fillRun(result, words, runStart, runEnd) {
  const [from, to] = findRunBounds(result, runStart, runEnd);
  const slot = (to - from) / (runEnd - runStart);
  for (let i = runStart; i < runEnd; i += 1) {
    const start = from + (i - runStart) * slot;
    result[i] = { ...words[i], start, end: start + slot, isInterpolated: true };
  }
}

function fillUnheardRuns(words) {
  const result = words.map((word) => (word.start === null ? null : word));
  let i = 0;
  while (i < result.length) {
    if (result[i] !== null) {
      i += 1;
      continue;
    }
    let runEnd = i;
    while (runEnd < result.length && result[runEnd] === null) runEnd += 1;
    fillRun(result, words, i, runEnd);
    i = runEnd;
  }
  return result;
}

function toTimedWords(lyricWords, heardWords, heardIndexes) {
  return lyricWords.map((word, index) => {
    const heard = heardWords[heardIndexes[index]];
    if (heard === undefined) return { ...word, start: null, end: null };
    return { ...word, start: heard.start, end: heard.end, isInterpolated: false };
  });
}

function groupByLine(lines, flatWords) {
  let offset = 0;
  return lines.map((line) => {
    const words = flatWords.slice(offset, offset + line.length);
    offset += line.length;
    return words;
  });
}

function fractionHeard(words) {
  const heardCount = words.filter((word) => !word.isInterpolated).length;
  return heardCount / words.length;
}

export function alignLyrics(lines, heardWords) {
  const lyricWords = lines.flat();
  const heard = heardWords.map((entry) => ({
    ...entry,
    text: normalizeWord(entry.word)
  }));
  const table = buildScoreTable(lyricWords, heard);
  const heardIndexes = traceMatches(table, lyricWords, heard);
  const timed = toTimedWords(lyricWords, heard, heardIndexes);
  const filled = fillUnheardRuns(timed);
  const timeline = groupByLine(lines, filled);
  return {
    timeline,
    lineMatch: timeline.map(fractionHeard),
    overallMatch: fractionHeard(filled)
  };
}

function runCli(slug) {
  const songDir = join(SONGS_DIR, slug);
  const lyrics = readFileSync(join(songDir, 'lyrics.txt'), 'utf8');
  const heard = JSON.parse(readFileSync(join(songDir, 'words.json'), 'utf8'));
  const result = alignLyrics(parseLyricLines(lyrics), heard);
  writeFileSync(join(songDir, 'timeline.json'), JSON.stringify(result, null, 2));
  result.lineMatch.forEach((fraction, index) => {
    console.log(`line ${index + 1}: ${Math.round(fraction * 100)}% heard`);
  });
  console.log(`overall: ${Math.round(result.overallMatch * 100)}% heard`);
  if (result.overallMatch < WEAK_ALIGNMENT_MATCH) {
    console.log('weak alignment: run separate_vocals.py and transcribe again');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv[2]);
}
