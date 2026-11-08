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
const SERVICES_HEADING = '<h2>Services we use</h2>';
const APPLE_ROW_HEADER = '<th scope="row">Apple sign-in token</th>';
const APP_TOKEN_ROW_HEADER = '<th scope="row">Sign-in token in the apps</th>';

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

  it('names the iOS and Android apps', () => {
    assert.match(html, /iOS/);
    assert.match(html, /Android/);
  });

  it('lists Apple among the services, with its relay addresses', () => {
    const section = findSection(html, SERVICES_HEADING);
    assert.ok(section, 'no services section');
    assert.match(section, /Sign in with Apple/);
    assert.match(section, /Hide My Email/);
    assert.match(section, /only see Apple's relay address/);
  });

  it('says the Apple token is kept encrypted and Apple is asked to revoke it', () => {
    const row = findRow(html, APPLE_ROW_HEADER);
    assert.ok(row, 'no row for the Apple token');
    assert.match(row, /encrypted/);
    assert.match(findSection(html, DELETING_HEADING), /ask Apple to revoke/);
  });

  it('says the apps keep a sign-in token on the device', () => {
    assert.ok(findRow(html, APP_TOKEN_ROW_HEADER), 'no row for the app sign-in token');
  });

  it('is dated the day it last changed', () => {
    assert.match(html, /Last updated November 8, 2026/);
  });

  it('gives an email to ask about your data', () => {
    const section = findSection(html, '<h2>Contact</h2>');
    assert.ok(section, 'no contact section');
    assert.match(section, /mailto:support@lyriclike\.com/);
  });
});
