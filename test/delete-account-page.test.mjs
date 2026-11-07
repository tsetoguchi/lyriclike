// Google Play's Data safety form points at /delete-account/, so the page has
// to exist, be served like the privacy page, and say how to delete and whom
// to write to. These tests fail if an edit drops any of it.
//
//   node --test test/delete-account-page.test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

const REPO_ROOT = new URL('../', import.meta.url);
const DELETE_PAGE = new URL('delete-account/index.html', REPO_ROOT);
const PRIVACY_PAGE = new URL('privacy/index.html', REPO_ROOT);
const SITEMAP = new URL('sitemap.xml', REPO_ROOT);
const HEADERS = new URL('_headers', REPO_ROOT);
const PAGE_PATH = '/delete-account/';
const CONTACT_LINK = 'mailto:support@lyriclike.com';
const HEAD = /<head>([\s\S]*?)<\/head>/;
const FOOTER = /<footer[\s\S]*?<\/footer>/;
// Lines in the head that name this page rather than the site.
const PAGE_SPECIFIC_HEAD = /<title>|name="description"|rel="canonical"/;
// Git on Windows may write CRLF line ends; the tests compare text, not line ends.
const LINE_END = /\r?\n/;
const HEADERS_RULE = /^\/delete-account\/\*\r?\n {2}Cache-Control: no-cache\r?$/m;

function sharedHeadLines(html) {
  return html.match(HEAD)[1].split(LINE_END).filter(line => !PAGE_SPECIFIC_HEAD.test(line));
}

function footerLines(html) {
  return html.match(FOOTER)[0].split(LINE_END);
}

describe('delete account page', () => {
  let html;
  let privacyHtml;

  before(async () => {
    [html, privacyHtml] = await Promise.all([
      readFile(DELETE_PAGE, 'utf8'), readFile(PRIVACY_PAGE, 'utf8'),
    ]);
  });

  it('loads the same styles and scripts as the privacy page', () => {
    assert.deepEqual(sharedHeadLines(html), sharedHeadLines(privacyHtml));
  });

  it('names itself as the canonical address', () => {
    assert.match(html, /<link rel="canonical" href="https:\/\/lyriclike\.com\/delete-account\/">/);
  });

  it('has the same footer as the privacy page', () => {
    assert.deepEqual(footerLines(html), footerLines(privacyHtml));
  });

  it('links back to the privacy page', () => {
    assert.match(html, /href="\/privacy\/"/);
  });

  it('names the menu item people tap', () => {
    assert.match(html, /<strong>Delete account<\/strong>/);
  });

  it('covers the iOS and Android apps', () => {
    assert.match(html, /iOS/);
    assert.match(html, /Android/);
  });

  it('says Sign in with Apple access is revoked', () => {
    assert.match(html, /Sign in with Apple/);
    assert.match(html, /revoke/i);
  });

  it('gives an email for people who cannot sign in', () => {
    assert.ok(html.includes(CONTACT_LINK), 'no contact email');
  });

  it('is linked from the privacy page', () => {
    assert.ok(privacyHtml.includes(`href="${PAGE_PATH}"`), 'privacy page does not link here');
  });

  it('is in the sitemap', async () => {
    const sitemap = await readFile(SITEMAP, 'utf8');
    assert.ok(sitemap.includes(`<loc>https://lyriclike.com${PAGE_PATH}</loc>`));
  });

  it('is revalidated like the privacy page', async () => {
    const headers = await readFile(HEADERS, 'utf8');
    assert.match(headers, HEADERS_RULE);
  });
});
