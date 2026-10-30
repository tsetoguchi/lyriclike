// The sidebar (sidebar.js) and the notebook list (notebook-list.js) each export
// one object, and the other scripts reach them only through it. These checks
// read the sources, since both files need a browser to run.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const OLD_NAMES = [
  'loadLyricsList', 'refreshListIfBehind', 'refreshNotebook', 'showPageCount',
  'currentOwnPageCount', 'openLyricsList', 'closeLyricsList', 'isSidebarOpen',
  'isSidebarDocked', 'hideSidebar', 'markListItem', 'markActiveListItem', 'listedTitles',
];
const SCRIPTS = [...readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(match => match[1]);

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function exportedKeys(source, objectName) {
  const start = source.indexOf(`window.${objectName} = {`);
  const body = source.slice(start, source.indexOf('}', source.indexOf('\n', start) + 1) + 1);
  return new Set([...body.matchAll(/(?:\{|,|^)\s*(\w+)\s*(?=[,:}]|$)/gm)].map(match => match[1]));
}

function membersUsed(source, objectName) {
  return [...source.matchAll(new RegExp(`\\b${objectName}\\.(\\w+)`, 'g'))]
    .map(match => match[1]);
}

const OBJECTS = [
  { name: 'Sidebar', file: 'sidebar.js' },
  { name: 'NotebookList', file: 'notebook-list.js' },
];

describe('Sidebar and NotebookList', () => {
  for (const { name, file } of OBJECTS) {
    const keys = exportedKeys(readScript(file), name);

    it(`${file} exports ${name}`, () => {
      assert.ok(keys.size > 0);
    });

    // A script that loads earlier may only reach it through window (or root),
    // guarded, at call time.
    it(`${file} loads before every script that uses ${name} by its bare name`, () => {
      const users = SCRIPTS.filter(script => script !== file
        && new RegExp(`(?<![.\\w])${name}\\.`).test(readScript(script)));
      assert.ok(users.length > 0);
      for (const script of users) assert.ok(SCRIPTS.indexOf(file) < SCRIPTS.indexOf(script), script);
    });

    for (const script of SCRIPTS) {
      it(`${script} uses only names ${name} has`, () => {
        const missing = membersUsed(readScript(script), name).filter(key => !keys.has(key));
        assert.deepEqual(missing, []);
      });
    }
  }

  const definers = OBJECTS.map(({ file }) => file);
  for (const script of SCRIPTS.filter(script => !definers.includes(script))) {
    it(`${script} uses none of the old global names`, () => {
      const source = readScript(script);
      const used = OLD_NAMES.filter(name => new RegExp(`\\b${name}\\b`).test(source));
      assert.deepEqual(used, []);
    });
  }
});
