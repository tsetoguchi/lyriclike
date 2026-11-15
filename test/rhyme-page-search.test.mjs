// The rhyme pages carry a search box that works with no script: a plain form
// that opens the editor on the typed word. The hand-written 404 page has to
// carry the very same form.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { editorLinkFor, renderHubPage, renderRhymePage, renderWordSearch } from '../tools/rhymes/render-html.mjs';

const NOT_FOUND_PAGE = new URL('../404.html', import.meta.url);
const WORD_PATTERN = new RegExp(`^(?:${renderWordSearch().match(/pattern="([^"]+)"/)[1]})$`);
const PAGE_MODEL = {
  word: 'night',
  summary: { kind: 'perfect', examples: ['light', 'right'], total: 2 },
  syllables: 1,
  pronunciation: 'N AY1 T',
  meaning: null,
  sections: [],
  related: []
};

describe('the rhyme pages search box', () => {
  it('sends the typed word to the editor the way a rhyme link does', () => {
    const [path, query] = editorLinkFor('night').split('?');
    const fieldName = query.split('=')[0];
    assert.match(renderWordSearch(), new RegExp(`<form[^>]* action="${path}" method="get"`));
    assert.match(renderWordSearch(), new RegExp(`<input[^>]* name="${fieldName}"`));
  });

  it('lets through one word, spaces around it included, and nothing else', () => {
    for (const typed of ['love', 'Love', " don't ", 'love ']) assert.match(typed, WORD_PATTERN);
    for (const typed of ['blue sky', '123', '', "'tis"]) assert.doesNotMatch(typed, WORD_PATTERN);
  });

  it('is on the hub page and on every word page', () => {
    assert.ok(renderHubPage(['night']).includes(renderWordSearch()));
    assert.ok(renderRhymePage(PAGE_MODEL, new Set(['night'])).includes(renderWordSearch()));
  });

  it('is on the 404 page, word for word', () => {
    const page = readFileSync(NOT_FOUND_PAGE, 'utf8').replaceAll('\r\n', '\n');
    assert.ok(page.includes(renderWordSearch()));
  });
});
