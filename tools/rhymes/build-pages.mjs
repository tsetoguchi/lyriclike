// Generates the static rhyme pages under /rhymes/ and rewrites sitemap.xml.
// The output is committed, since the site deploys the repo with no build step.
//
//   node tools/rhymes/build-pages.mjs

import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, loadBuildData } from './build-data.mjs';
import { buildPageModel, countListedRhymes } from './page-content.mjs';
import { RHYMES_PATH, renderHubPage, renderRhymePage, renderSitemap, rhymePagePath } from './render-html.mjs';
import rhymeCore from '../../rhyme-core.js';

const { buildRhymeIndex, findRhymes, hasRhymeEntry } = rhymeCore;

const MAX_PAGES = 1000;
// Below this a page is too thin to be worth indexing.
const MIN_LISTED_RHYMES = 10;
const RELATED_COUNT = 24;
const OUTPUT_DIR = new URL('rhymes/', REPO_ROOT);
const STYLESHEET_SOURCE = new URL('./page.css', import.meta.url);

// Autocomplete surfaces slang and fragments ("ty"), so a page also needs the
// word to be on the same English list the editor filters results with.
function isPageCandidate(word, index, filters) {
  return filters.englishWords.has(word) && !filters.blocklist.has(word) && hasRhymeEntry(index, word);
}

function selectPages(index, data) {
  const pages = [];
  const seen = new Set();
  for (const word of data.popularWords) {
    if (pages.length >= MAX_PAGES) break;
    if (seen.has(word) || !isPageCandidate(word, index, data.filters)) continue;
    seen.add(word);
    const results = findRhymes(index, word, data.filters);
    if (countListedRhymes(results) >= MIN_LISTED_RHYMES) pages.push({ word, results });
  }
  return pages;
}

// Neighbours in popularity order, so every page is linked from others.
function pickRelated(pages, position) {
  const start = Math.max(0, Math.min(position - RELATED_COUNT / 2, pages.length - RELATED_COUNT - 1));
  return pages.slice(start, start + RELATED_COUNT + 1)
    .map((page) => page.word)
    .filter((word) => word !== pages[position].word)
    .slice(0, RELATED_COUNT);
}

async function resetOutputDir() {
  // Everything under /rhymes/ is generated, so a rebuild starts clean.
  if (!fileURLToPath(OUTPUT_DIR).replace(/\\/g, '/').endsWith('/rhymes/')) {
    throw new Error(`Refusing to clear unexpected output directory ${OUTPUT_DIR}`);
  }
  // Empties the folder rather than removing it: on Windows, Dropbox or an
  // open preview holds the folder itself and rmdir fails with EBUSY.
  await mkdir(OUTPUT_DIR, { recursive: true });
  const entries = await readdir(OUTPUT_DIR);
  await Promise.all(entries.map((name) => rm(new URL(name, OUTPUT_DIR), { recursive: true, force: true })));
}

async function writePage(path, html) {
  const dir = new URL(`.${path}`, REPO_ROOT);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('index.html', dir), html);
}

async function writeRhymePages(pages, index, ranks) {
  const pageWords = new Set(pages.map((page) => page.word));
  for (let position = 0; position < pages.length; position++) {
    const { word, results } = pages[position];
    const related = pickRelated(pages, position);
    const model = buildPageModel({ word, results, index, ranks, related });
    await writePage(rhymePagePath(word), renderRhymePage(model, pageWords));
  }
}

async function writeSitemap(pages) {
  const paths = ['/', RHYMES_PATH, ...pages.map((page) => rhymePagePath(page.word))];
  await writeFile(new URL('sitemap.xml', REPO_ROOT), renderSitemap(paths));
}

async function main() {
  const data = await loadBuildData();
  const index = buildRhymeIndex(data.dictionary);
  const pages = selectPages(index, data);

  await resetOutputDir();
  await writeRhymePages(pages, index, data.ranks);
  await writePage(RHYMES_PATH, renderHubPage(pages.map((page) => page.word)));
  await copyFile(STYLESHEET_SOURCE, new URL('rhymes.css', OUTPUT_DIR));
  await writeSitemap(pages);
  console.log(`Wrote ${pages.length} rhyme pages, the hub page and sitemap.xml`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
