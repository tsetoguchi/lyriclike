// Every script index.html loads has to parse. One that doesn't stops all of
// its code, and the page fails quietly: a broken storage.js once left the
// notebook showing no pages. Most of these scripts need a browser to run, so
// this only asks Node to parse each one.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { APP_SCRIPTS } from './support/app-scripts.mjs';

function checkSyntax(name) {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
  return spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
}

describe('app scripts', () => {
  for (const name of APP_SCRIPTS) {
    it(`${name} parses`, () => {
      const result = checkSyntax(name);
      assert.equal(result.status, 0, result.stderr);
    });
  }
});
