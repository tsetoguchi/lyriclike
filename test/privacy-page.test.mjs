// The privacy page has to say earlier versions of pages may be kept, and how
// they go, before any are kept. These tests fail if an edit drops it.
//
//   node --test test/privacy-page.test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

const PRIVACY_PAGE = new URL('../privacy/index.html', import.meta.url);
const TABLE_ROW = /<tr>([\s\S]*?)<\/tr>/g;
const SECTION = /<section>([\s\S]*?)<\/section>/g;
const DELETING_HEADING = '<h2>Seeing and deleting your data</h2>';
const VERSIONS_ROW_HEADER = '<th scope="row">Earlier versions of saved pages</th>';

function findRow(html, rowHeader) {
  return [...html.matchAll(TABLE_ROW)].map(match => match[1]).find(row => row.includes(rowHeader));
}

function findSection(html, heading) {
  return [...html.matchAll(SECTION)].map(match => match[1]).find(body => body.includes(heading));
}

describe('privacy page', () => {
  let html;

  before(async () => {
    html = await readFile(PRIVACY_PAGE, 'utf8');
  });

  it('the table lists earlier versions', () => {
    const row = findRow(html, VERSIONS_ROW_HEADER);
    assert.ok(row, 'no row for earlier versions');
    const cells = row.match(/<td>([\s\S]*?)<\/td>/g);
    assert.match(cells[cells.length - 1], /gone within a day/);
  });

  it('deleting a page or account deletes earlier versions within a day', () => {
    const section = findSection(html, DELETING_HEADING);
    assert.ok(section, 'no deleting section');
    assert.match(section, /Deleting a page also deletes its earlier versions/);
    assert.match(section, /within a day/);
  });

  it('co-writers keep their words without a name', () => {
    assert.match(findSection(html, DELETING_HEADING), /without your name/);
  });

  it('gives an email to ask about your data', () => {
    const section = findSection(html, '<h2>Contact</h2>');
    assert.ok(section, 'no contact section');
    assert.match(section, /mailto:support@lyriclike\.com/);
  });
});
