// Pages serves the whole repo, so _redirects sends the repo's own files
// (tests, tools, migrations, config) home instead. These tests fail if a
// rule goes missing.
//
//   node --test test/repo-files-hidden.test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

const REDIRECTS = new URL('../_redirects', import.meta.url);
const HIDDEN_FILES = Object.freeze([
  '/README.md', '/wrangler.toml', '/.gitignore', '/.gitattributes',
]);
const HIDDEN_FOLDERS = Object.freeze([
  '/test/', '/tools/', '/migrations/', '/collab/', '/mobile/',
  '/.github/', '/.githooks/', '/.claude/',
]);
const LINE_END = /\r?\n/;
const RULE_PARTS = /\s+/;
const HOME = '/';
const MOVED = '301';

function parse_rules(text) {
  return text.split(LINE_END)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split(RULE_PARTS));
}

function is_sent_home(rules, source) {
  return rules.some(([from, to, code]) => from === source && to === HOME && code === MOVED);
}

describe('repo files are not served', () => {
  let rules;

  before(async () => {
    rules = parse_rules(await readFile(REDIRECTS, 'utf8'));
  });

  for (const file of HIDDEN_FILES) {
    it(`sends ${file} home`, () => {
      assert.ok(is_sent_home(rules, file), `no 301 rule for ${file}`);
    });
  }

  for (const folder of HIDDEN_FOLDERS) {
    it(`sends everything under ${folder} home`, () => {
      assert.ok(is_sent_home(rules, `${folder}*`), `no 301 rule for ${folder}*`);
    });
  }
});
