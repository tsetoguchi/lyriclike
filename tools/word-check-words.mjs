// The words tools/word-check.mjs refuses in new lines. They belong to a closed
// layer that lives in another repo, so finding one here means something was
// written in the wrong place. Tuned against this repo: the lookbehinds let
// through the code that already uses these words for something else.

const TELLING_WORDS = [
  'stripe', 'paddle', 'lemonsqueezy', 'lemon squeezy', 'checkout', 'billing',
  'subscription', 'subscriptions', 'price', 'prices', 'priced', 'pricing',
  'payment', 'payments',
];

// Git commands and the checkout action use the word for something else.
const ALLOWED_BEFORE = {
  checkout: '(?<!git |actions\\/)',
};

function capitalized(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// A word in any case on its own, and inside names: price_id and priceId,
// PRICE_ID, and monthlyPrice. Case matters in the name forms, since a
// letter on either side of the same case makes it another word ("priceless").
function patternsFor(word) {
  const allowed = ALLOWED_BEFORE[word] || '';
  const upper = word.toUpperCase();
  return [
    new RegExp(`${allowed}\\b${word}\\b`, 'i'),
    new RegExp(`${allowed}(?<![A-Za-z])${word}(?![a-z])`),
    new RegExp(`${allowed}(?<![A-Za-z])${upper}(?![A-Za-z])`),
    new RegExp(`${allowed}(?<![A-Z])${capitalized(word)}(?![a-z])`),
  ];
}

export const WORD_PATTERNS = [
  ...TELLING_WORDS.flatMap(patternsFor),
  // Case matters here: "pro" alone is an ordinary word, and the editor's
  // font list names "SF Pro".
  /(?<!SF )(?<![A-Za-z])Pro(?![a-z])/,
  /(?<![A-Za-z])PRO(?![A-Za-z])/,
  /[a-z0-9]Pro(?![a-z])/,
  /(?<![A-Za-z])pro_|_pro(?![a-z])/,
  /\/ext\//i,
];

// Word data and the rhyme pages built from it hold every English word, these
// included. This file and its test hold the list itself.
export const SKIPPED_FILES = [
  /^rhymes\//,
  /^sitemap\.xml$/,
  /^(blocklist|cmudict|crude-words|english-words|name-words)\.json$/,
  /^tools\/rhymes\/.*\.(json|tsv|txt)$/,
  /^tools\/word-check-words\.mjs$/,
  /^test\/word-check\.test\.mjs$/,
];
