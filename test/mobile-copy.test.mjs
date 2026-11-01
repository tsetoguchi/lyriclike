// mobile/scripts/copy-web.mjs decides what goes into the app bundle. The
// server code, the tests and the 100 MB of rhyme pages must stay out of it,
// and every file the pages load must be in.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { copySite, isBundledRootFile } from '../mobile/scripts/copy-web.mjs';

describe('isBundledRootFile', () => {
  it('takes the pages, scripts, styles and data the app loads', () => {
    for (const name of ['index.html', 'app.js', 'styles.css', 'cmudict.json', 'manifest.json', 'LICENSE', 'NOTICE']) {
      assert.equal(isBundledRootFile(name), true, name);
    }
  });

  it('leaves out what only the website host reads', () => {
    for (const name of ['404.html', '_headers', '_redirects', 'wrangler.toml', 'sitemap.xml', 'robots.txt', 'README.md']) {
      assert.equal(isBundledRootFile(name), false, name);
    }
  });
});

describe('copySite', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'lyriclike-copy-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  function touch(root, relative) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'x');
  }

  it('copies the bundle and nothing from the server, tests or rhyme pages', () => {
    const site = path.join(scratch, 'site');
    const output = path.join(scratch, 'www');
    for (const file of [
      'index.html', 'app.js', 'assets/icons/a.png', 'fonts/f.woff2', 'vendor/y.js',
      '404.html', '_headers', 'functions/api/me.js', 'test/a.test.mjs', 'rhymes/love/index.html',
      'collab/src/x.js', 'migrations/0001.sql',
    ]) touch(site, file);

    copySite(site, output);
    assert.deepEqual(readdirSync(output).sort(), ['app.js', 'assets', 'fonts', 'index.html', 'vendor']);
  });

  it('starts clean, so a file removed from the site leaves the bundle', () => {
    const site = path.join(scratch, 'site2');
    const output = path.join(scratch, 'www2');
    for (const file of ['index.html', 'assets/a.png', 'fonts/f.woff2', 'vendor/y.js']) touch(site, file);
    touch(output, 'old.js');

    copySite(site, output);
    assert.equal(readdirSync(output).includes('old.js'), false);
  });
});
