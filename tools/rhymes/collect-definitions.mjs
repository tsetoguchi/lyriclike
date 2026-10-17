// Writes definitions.json: what each rhyme page's word means, from WordNet.
// The rhyme lists of two rhyming words are nearly the same page, so the
// meaning is what gives each one something of its own.
//
// Run after build-pages.mjs whenever the set of pages changes, then build
// the pages again. It reads the page words from sitemap.xml and needs the
// WordNet 3.1 database, which is not kept in the repo:
//
//   curl -LO https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz
//   tar xzf wn3.1.dict.tar.gz
//   node tools/rhymes/collect-definitions.mjs path/to/dict

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from './build-data.mjs';

const OUTPUT = new URL('./definitions.json', import.meta.url);
const PARTS_OF_SPEECH = [
  { file: 'noun', label: 'noun' },
  { file: 'verb', label: 'verb' },
  { file: 'adj', label: 'adjective' },
  { file: 'adv', label: 'adverb' }
];
// One sense per part of speech, so "fire" shows the noun and the verb
// rather than three kinds of burning.
const MAX_SENSES = 2;
// Shorter than this, a definition is a usage label ("nonstandard usage").
const MIN_DEFINITION_WORDS = 3;
// A word WordNet never saw in use only gets a meaning when it is at least
// this long. Short common words are where its one sense is a rarity: "he"
// as a Hebrew letter, "at" as a coin from Laos.
const MIN_UNSEEN_WORD_LENGTH = 5;
// WordNet's own rules for finding the base form of an inflected word,
// tried after its lists of irregular forms ("woke" → "wake").
const SUFFIX_RULES = {
  noun: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  verb: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  adj: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e']],
  adv: []
};

async function readLines(path) {
  return (await readFile(path, 'latin1')).split('\n');
}

// index.<pos> lines read: lemma pos synset_cnt p_cnt [ptr...] sense_cnt
// tagsense_cnt offset... Offsets come most-used sense first, and
// tagsense_cnt says how often the word was seen used this way at all.
function parseIndexLine(line) {
  const fields = line.trim().split(' ');
  const synsetCount = Number(fields[2]);
  const pointerCount = Number(fields[3]);
  const tagged = Number(fields[5 + pointerCount]);
  const offsets = fields.slice(6 + pointerCount, 6 + pointerCount + synsetCount);
  return { lemma: fields[0], tagged, offsets };
}

async function loadPartOfSpeech(dictDir, { file, label }) {
  const index = new Map();
  for (const line of await readLines(join(dictDir, `index.${file}`))) {
    if (!line || line.startsWith(' ')) continue;
    const entry = parseIndexLine(line);
    index.set(entry.lemma, entry);
  }
  const irregular = new Map();
  for (const line of await readLines(join(dictDir, `${file}.exc`))) {
    const [inflected, ...bases] = line.trim().split(' ');
    if (inflected) irregular.set(inflected, bases);
  }
  const data = await readFile(join(dictDir, `data.${file}`), 'latin1');
  // data.<pos> lines read: offset lex_filenum ss_type w_cnt (hex) then
  // word lex_id pairs, then pointers, then "| gloss".
  const synsetAt = (offset) => {
    const start = data.indexOf(`\n${offset} `) + 1;
    const line = data.slice(start, data.indexOf('\n', start));
    const fields = line.split(' ');
    const wordCount = parseInt(fields[3], 16);
    const words = Array.from({ length: wordCount }, (_, n) => fields[4 + n * 2].replace(/\(.*\)$/, ''));
    return { words, gloss: line.slice(line.indexOf('| ') + 2).trim() };
  };
  return { file, label, index, irregular, synsetAt };
}

function baseForms(word, pos) {
  const forms = [word, ...(pos.irregular.get(word) || [])];
  for (const [suffix, ending] of SUFFIX_RULES[pos.file]) {
    if (word.endsWith(suffix)) forms.push(word.slice(0, -suffix.length) + ending);
  }
  return [...new Set(forms)].filter((form) => form && pos.index.has(form));
}

// The word itself, unless WordNet never saw it used and a base form it did
// see exists: "legs" alone means "staying power", but "leg" is the limb.
function findBase(word, pos) {
  const forms = baseForms(word, pos);
  return forms.find((form) => pos.index.get(form).tagged > 0) || forms[0] || null;
}

// "a humorous anecdote; "he told a joke"; "thanks for the laugh"" →
// the definition, and the examples in quotes.
export function parseGloss(gloss) {
  const examples = [...gloss.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim());
  const firstQuote = gloss.indexOf('"');
  const definition = (firstQuote === -1 ? gloss : gloss.slice(0, firstQuote)).replace(/[;\s]+$/, '').trim();
  return { definition, examples };
}

function tokens(text) {
  return text.toLowerCase().split(/[^a-z']+/).filter(Boolean);
}

// An example only earns its place if it shows the word in use; WordNet
// often illustrates a sense with a synonym instead ("he knows a million gags").
function pickExample(examples, forms) {
  return examples.find((example) => tokens(example).some((token) => forms.has(token))) || null;
}

function buildEntry(word, parts, unwanted, names) {
  const isClean = (text) => !tokens(text).some((token) => unwanted.has(token));
  const matches = parts
    .map((pos) => ({ pos, base: findBase(word, pos) }))
    .filter(({ base }) => base)
    .map(({ pos, base }) => ({ pos, base, entry: pos.index.get(base) }))
    // The way the word is most often used leads. The first part of speech
    // always counts; a second only if anyone was ever seen using it.
    .sort((a, b) => b.entry.tagged - a.entry.tagged)
    .filter(({ entry }, n) => n === 0 || entry.tagged > 0);
  // First names ("anna", a coin) only ever match some other sense.
  const unseen = matches.length > 0 && matches[0].entry.tagged === 0;
  if (unseen && (word.length < MIN_UNSEEN_WORD_LENGTH || names.has(word))) return null;
  const senses = [];
  for (const { pos, base, entry } of matches) {
    if (senses.length >= MAX_SENSES) break;
    for (const offset of entry.offsets) {
      const { words, gloss } = pos.synsetAt(offset);
      // WordNet writes a name with a capital ("Ur", the city), and a page
      // for "ur" is about the word, not the place.
      if (words.some((name) => name.toLowerCase() === base && name !== base)) continue;
      const { definition, examples } = parseGloss(gloss);
      const example = pickExample(examples.filter(isClean), new Set([word, base]));
      if (tokens(definition).length < MIN_DEFINITION_WORDS || !isClean(definition)) continue;
      senses.push({ pos: pos.label, base, definition, ...(example ? { example } : {}) });
      break;
    }
  }
  if (senses.length === 0) return null;
  // The page says "a form of" only when every sense came from one other word.
  const bases = new Set(senses.map((sense) => sense.base));
  const base = bases.size === 1 && !bases.has(word) ? senses[0].base : undefined;
  return { ...(base ? { base } : {}), senses: senses.map(({ base: _, ...sense }) => sense) };
}

async function readRepoJson(path) {
  return JSON.parse(await readFile(new URL(path, REPO_ROOT), 'utf8'));
}

async function main() {
  const dictDir = process.argv[2];
  if (!dictDir) throw new Error('Usage: node tools/rhymes/collect-definitions.mjs path/to/wordnet/dict');
  const sitemap = await readFile(new URL('sitemap.xml', REPO_ROOT), 'utf8');
  const words = [...sitemap.matchAll(/\/rhymes\/([^/<]+)\/<\/loc>/g)].map((match) => decodeURIComponent(match[1]));
  const [crude, blocklist, pageExcluded, names] = await Promise.all([
    readRepoJson('crude-words.json'),
    readRepoJson('blocklist.json'),
    readRepoJson('tools/rhymes/page-excluded-words.json'),
    readRepoJson('name-words.json').then((list) => new Set(list))
  ]);
  const unwanted = new Set([...crude, ...blocklist, ...pageExcluded]);
  const parts = await Promise.all(PARTS_OF_SPEECH.map((pos) => loadPartOfSpeech(dictDir, pos)));

  // Every page word gets a key, null when WordNet has nothing, so the page
  // build can tell "no meaning" apart from "not collected yet".
  const definitions = {};
  for (const word of [...words].sort()) definitions[word] = buildEntry(word, parts, unwanted, names);
  await writeFile(OUTPUT, `${JSON.stringify(definitions, null, 1)}\n`);
  const found = Object.values(definitions).filter(Boolean).length;
  console.log(`Wrote definitions for ${found} of ${words.length} page words`);
}

// Run directly, not when a test imports parseGloss.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
