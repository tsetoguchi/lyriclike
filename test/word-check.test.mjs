// The word check that keeps the closed layer's words out of this repo: which
// added lines it reads, which words it flags, and what it lets through.
//
//   node --test test/word-check.test.mjs

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addedLines, findHits } from '../tools/word-check.mjs';

const DIFF = [
  'diff --git a/app.js b/app.js',
  'index 1111111..2222222 100644',
  '--- a/app.js',
  '+++ b/app.js',
  '@@ -10,0 +11,2 @@ function start() {',
  '+const first = 1;',
  '+const second = 2;',
  '@@ -40 +42 @@',
  '-old line',
  '+new line',
  'diff --git a/notes.md b/notes.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/notes.md',
  '@@ -0,0 +1 @@',
  '+++ a line that starts with two plus signs',
].join('\n');

function hitsFor(text, file = 'app.js') {
  return findHits([{ source: file, line: 1, text }]);
}

describe('addedLines', () => {
  it('reads only added lines, with their file and new line number', () => {
    assert.deepEqual(addedLines(DIFF), [
      { source: 'app.js', line: 11, text: 'const first = 1;' },
      { source: 'app.js', line: 12, text: 'const second = 2;' },
      { source: 'app.js', line: 42, text: 'new line' },
      { source: 'notes.md', line: 1, text: '++ a line that starts with two plus signs' },
    ]);
  });

  it('reads a CRLF diff the same way', () => {
    assert.deepEqual(addedLines(DIFF.replaceAll('\n', '\r\n')), addedLines(DIFF));
  });
});

describe('findHits', () => {
  it('flags the closed layer words in any case', () => {
    for (const text of [
      'Stripe', 'paddle.js', 'Lemon Squeezy', 'lemonsqueezy', 'checkout()', 'billing',
      'Subscription', 'price', 'prices', 'pricing', 'payment', 'Payments', 'Go Pro',
      '/ext/script.js', 'PRICE_LABEL', 'HTTP_PAYMENT_REQUIRED', 'monthlyPrice',
      'price_id', 'isPro', 'is_pro', 'PRO_LIMIT', 'stripeKey',
    ]) {
      assert.equal(hitsFor(text).length, 1, text);
    }
  });

  it('lets ordinary words and existing code through', () => {
    for (const text of [
      'process', 'promise', 'approach', 'priceless', 'striped', 'pay', 'plans',
      "'SF Pro Text'", 'uses: actions/checkout@v4', 'git checkout -- rhymes',
      '/ext-test/site.js', 'extensions.js', 'toPromise', 'Process', 'PROCESS_ID',
      'pro-choice', 'caprice', 'supercheckouts',
    ]) {
      assert.deepEqual(hitsFor(text), [], text);
    }
  });

  it('skips a line marked with the allow comment', () => {
    assert.deepEqual(hitsFor('const price = 1; // word-check: allow'), []);
  });

  it('skips word data files and its own word list', () => {
    for (const file of [
      'rhymes/price/index.html', 'sitemap.xml', 'english-words.json',
      'tools/rhymes/word-frequency.txt', 'tools/word-check-words.mjs',
    ]) {
      assert.deepEqual(hitsFor('price', file), [], file);
    }
  });

  it('still checks a file that only looks like a data file', () => {
    assert.equal(hitsFor('price', 'functions/rhymes.js').length, 1);
  });

  it('reports the word it found', () => {
    assert.deepEqual(hitsFor('const total = price * 2;'), [
      { source: 'app.js', line: 1, text: 'const total = price * 2;', word: 'price' },
    ]);
  });
});
