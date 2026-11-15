// The rhyme build rewrites sitemap.xml from scratch. Pages added to the file
// by hand were once dropped by the next build, so the build's own list has
// to produce the committed file.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { renderSitemap, sitemapPaths } from '../tools/rhymes/render-html.mjs';

const SITEMAP = new URL('../sitemap.xml', import.meta.url);
const RHYME_PAGE_PATTERN = /<loc>https:\/\/lyriclike\.com(\/rhymes\/[^/<]+\/)<\/loc>/g;

function readSitemap() {
  return readFileSync(SITEMAP, 'utf8').replaceAll('\r\n', '\n');
}

describe('the sitemap build', () => {
  it('writes the committed sitemap, hand-written pages included', () => {
    const committed = readSitemap();
    const rhymePaths = [...committed.matchAll(RHYME_PAGE_PATTERN)].map(([, path]) => path);
    assert.equal(renderSitemap(sitemapPaths(rhymePaths)), committed);
  });
});
