// Gathers the site's static files into mobile/www, which Capacitor bundles
// into the iOS and Android apps. The website has no build step and keeps none:
// this copies files and changes nothing in them.
//
//   node mobile/scripts/copy-web.mjs

import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT_DIR = fileURLToPath(new URL('../www/', import.meta.url));
// Folders the pages load from. Everything else is the server, the tests, or
// pages that open on the real site (rhymes alone is over 100 MB).
const BUNDLED_DIRS = Object.freeze(['assets', 'fonts', 'vendor']);
const BUNDLED_ROOT_PATTERN = /\.(html|js|css|json)$|^(LICENSE|NOTICE)$/;
// The server's error page and the files only the website's host reads.
const LEFT_OUT_ROOT_FILES = Object.freeze(['404.html', 'package.json', 'package-lock.json']);

export function isBundledRootFile(name) {
  return BUNDLED_ROOT_PATTERN.test(name) && !LEFT_OUT_ROOT_FILES.includes(name);
}

function listRootFiles(siteRoot) {
  return readdirSync(siteRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && isBundledRootFile(entry.name))
    .map(entry => entry.name);
}

export function copySite(siteRoot, outputDir) {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const names = [...listRootFiles(siteRoot), ...BUNDLED_DIRS];
  for (const name of names) {
    cpSync(path.join(siteRoot, name), path.join(outputDir, name), { recursive: true });
  }
  return names;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const copied = copySite(SITE_ROOT, OUTPUT_DIR);
  console.log(`Copied ${copied.length} entries to ${OUTPUT_DIR}`);
}
