// The dialog (dialog.js) and the page notice (page-notice.js) each export one
// object, and the other scripts reach them only through it. window.openDialog
// stays as well, since the closed extension script calls it by that name.
// These checks read the sources, since both files need a browser to run.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const OLD_NAMES = ['openDialog', 'closeDialog', 'showNotice', 'hideNotice'];
const SCRIPTS = [...readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(match => match[1]);

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function exportedKeys(source, objectName) {
  const match = source.match(new RegExp(`window\\.${objectName} = \\{([^}]*)\\}`));
  return new Set(match ? match[1].split(',').map(key => key.trim()) : []);
}

function membersUsed(source, objectName) {
  return [...source.matchAll(new RegExp(`\\b${objectName}\\.(\\w+)`, 'g'))]
    .map(match => match[1]);
}

const OBJECTS = [
  { name: 'Dialog', file: 'dialog.js' },
  { name: 'PageNotice', file: 'page-notice.js' },
];

describe('Dialog and PageNotice', () => {
  it('keeps window.openDialog for the extension script', () => {
    assert.match(readScript('dialog.js'), /window\.openDialog = open;/);
  });

  for (const { name, file } of OBJECTS) {
    const keys = exportedKeys(readScript(file), name);

    it(`${file} loads before every script that uses ${name}`, () => {
      const users = SCRIPTS.filter(script => membersUsed(readScript(script), name).length);
      assert.ok(users.length > 0);
      for (const script of users) assert.ok(SCRIPTS.indexOf(file) < SCRIPTS.indexOf(script));
    });

    for (const script of SCRIPTS) {
      it(`${script} uses only names ${name} has`, () => {
        const missing = membersUsed(readScript(script), name).filter(key => !keys.has(key));
        assert.deepEqual(missing, []);
      });
    }
  }

  for (const script of SCRIPTS.filter(script => script !== 'dialog.js')) {
    it(`${script} calls none of the old global names`, () => {
      const source = readScript(script);
      const used = OLD_NAMES.filter(name => new RegExp(`(?<![.\\w])${name}\\(`).test(source));
      assert.deepEqual(used, []);
    });
  }
});
