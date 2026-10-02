import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import rhymeCore from '../../rhyme-core.js';

const HAS_LETTER = /[A-Za-z]/;
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SONGS_DIR = join(SCRIPTS_DIR, '..', 'songs');
const DICTIONARY_PATH = join(SCRIPTS_DIR, '..', '..', 'cmudict.json');

export function splitStanzas(lyrics) {
  return lyrics
    .split(/\r?\n\s*\r?\n/)
    .map((stanza) => stanza.split(/\r?\n/).filter((line) => HAS_LETTER.test(line)))
    .filter((lines) => lines.length > 0);
}

export function markLyricStanzas(core, index, stanzas) {
  return stanzas.flatMap((lines) => core.groupRhymeMarks(index, lines).marks);
}

function overlappingMark(word, lineMarks) {
  return lineMarks.find((mark) => mark.start < word.charEnd && mark.end > word.charStart);
}

function withMark(word, lineMarks) {
  const mark = overlappingMark(word, lineMarks);
  if (mark === undefined) return { ...word, family: null, isSlant: false };
  return { ...word, family: mark.family, isSlant: mark.isSlant };
}

export function attachRhymeMarks(timeline, marksPerLine) {
  return timeline.map((line, lineIndex) =>
    line.map((word) => withMark(word, marksPerLine[lineIndex]))
  );
}

function runCli(slug) {
  const songDir = join(SONGS_DIR, slug);
  const lyrics = readFileSync(join(songDir, 'lyrics.txt'), 'utf8');
  const aligned = JSON.parse(readFileSync(join(songDir, 'timeline.json'), 'utf8'));
  const dictionary = JSON.parse(readFileSync(DICTIONARY_PATH, 'utf8'));
  const index = rhymeCore.buildRhymeIndex(dictionary);
  const marks = markLyricStanzas(rhymeCore, index, splitStanzas(lyrics));
  const timeline = attachRhymeMarks(aligned.timeline, marks);
  writeFileSync(
    join(songDir, 'timeline.json'),
    JSON.stringify({ ...aligned, timeline }, null, 2)
  );
  const families = new Set(timeline.flat().map((word) => word.family));
  families.delete(null);
  console.log(`marked ${families.size} rhyme families`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv[2]);
}
