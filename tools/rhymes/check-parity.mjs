// Confirms rhyme-core.mjs finds exactly what app.js finds. app.js expects a
// browser, so it runs in a sandbox where every DOM object is an inert stub;
// only its pure rhyme functions are exercised.
//
//   node tools/rhymes/check-parity.mjs

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { REPO_ROOT, loadBuildData } from './build-data.mjs';
import { RHYME_TYPES, buildRhymeIndex, findRhymes } from './rhyme-core.mjs';

// Every Nth dictionary word, on top of every popular word, keeps the run short
// while still covering all vowels and endings.
const DICTIONARY_SAMPLE_STEP = 200;

function createInertStub() {
  const handler = {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive) return () => '';
      // A promise that never settles: app.js waits on things like
      // document.fonts.ready, and those callbacks are DOM work to skip.
      if (prop === 'then') return () => stub;
      return stub;
    },
    set: () => true,
    apply: () => stub,
    construct: () => stub
  };
  const stub = new Proxy(function inert() {}, handler);
  return stub;
}

function createBrowserContext(dictionary) {
  const stub = createInertStub();
  const noop = () => 0;
  const fetchDictionary = async () => ({ ok: true, json: async () => dictionary });
  return vm.createContext({
    console, document: stub, window: stub, navigator: stub, location: stub, history: stub,
    sessionStorage: stub, localStorage: stub, ResizeObserver: stub, MutationObserver: stub,
    getComputedStyle: stub, matchMedia: stub, CustomEvent: stub, Event: stub,
    requestAnimationFrame: noop, cancelAnimationFrame: noop, setTimeout: noop,
    clearTimeout: noop, setInterval: noop, clearInterval: noop, fetch: fetchDictionary
  });
}

async function loadAppFindRhymes(data) {
  const context = createBrowserContext(data.dictionary);
  const appSource = await readFile(new URL('app.js', REPO_ROOT), 'utf8');
  vm.runInContext(appSource, context, { filename: 'app.js' });
  context.__englishWords = data.filters.englishWords;
  context.__blocklist = data.filters.blocklist;
  await vm.runInContext(
    'englishWords = __englishWords; blocklist = __blocklist; loadDictionary()', context
  );
  return (word) => vm.runInContext(`findRhymes(${JSON.stringify(word)})`, context);
}

function pickWords(data) {
  const sample = Object.keys(data.dictionary).filter((_, i) => i % DICTIONARY_SAMPLE_STEP === 0);
  return [...new Set([...data.popularWords, ...sample])];
}

function describeMismatch(word, appResults, coreResults) {
  if (!appResults || !coreResults) return appResults === coreResults ? null : `${word}: one side found nothing`;
  const differing = RHYME_TYPES.map(({ key }) => key)
    .filter((key) => appResults[key].join(' ') !== coreResults[key].join(' '));
  return differing.length > 0 ? `${word}: ${differing.join(', ')} differ` : null;
}

async function main() {
  const data = await loadBuildData();
  const appFindRhymes = await loadAppFindRhymes(data);
  const index = buildRhymeIndex(data.dictionary);
  const words = pickWords(data);

  const mismatches = words
    .map((word) => describeMismatch(word, appFindRhymes(word), findRhymes(index, word, data.filters)))
    .filter(Boolean);

  mismatches.slice(0, 20).forEach((line) => console.error(line));
  console.log(`Compared ${words.length} words: ${mismatches.length} mismatches`);
  if (mismatches.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
