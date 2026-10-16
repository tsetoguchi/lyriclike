// NOTICE credits third-party code that ships to browsers or runs in the room.
// Every runtime dependency of collab/ is bundled into vendor/live-deps-*.js
// or the room Worker, so each needs its licence there.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const NOTICE = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');
const { dependencies } = JSON.parse(readFileSync(new URL('../collab/package.json', import.meta.url), 'utf8'));
const LICENCE_TITLES = { MIT: 'The MIT License', 'Apache-2.0': 'Apache License' };

describe('NOTICE', () => {
  for (const [name, version] of Object.entries(dependencies)) {
    it(`credits ${name} ${version} with its licence`, () => {
      const pkg = JSON.parse(readFileSync(new URL(`../collab/node_modules/${name}/package.json`, import.meta.url), 'utf8'));
      const heading = `${name} ${version} — ${pkg.license}`;
      const start = NOTICE.indexOf(heading);
      assert.ok(start >= 0, `missing heading "${heading}"`);
      assert.ok(NOTICE.indexOf(LICENCE_TITLES[pkg.license], start) > start, `missing ${pkg.license} text`);
    });
  }
});
