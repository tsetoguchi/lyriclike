// Every page in sitemap.xml must be committed, since the site deploys the repo
// as it is. A .gitignore rule once hid rhymes/plans/, so the live site
// answered 404 for a page the sitemap listed. Asks git, not the disk, so a
// page that exists locally but is ignored still fails here.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const REPO_ROOT = new URL('../', import.meta.url);
const SITE = 'https://lyriclike.com/';
const LOC_PATTERN = /<loc>([^<]+)<\/loc>/g;

function listSitemapFiles() {
  const xml = readFileSync(new URL('sitemap.xml', REPO_ROOT), 'utf8');
  return [...xml.matchAll(LOC_PATTERN)]
    .map(([, url]) => url.slice(SITE.length) + 'index.html');
}

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return new Set(output.split('\n'));
}

describe('sitemap.xml', () => {
  it('lists only pages that are committed', () => {
    const tracked = listTrackedFiles();
    const missing = listSitemapFiles().filter((file) => !tracked.has(file));
    assert.deepEqual(missing, []);
  });
});
