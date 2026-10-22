// The words tools/word-check.mjs refuses in new lines. They belong to a closed
// layer that lives in another repo, so finding one here means something was
// written in the wrong place. Tuned against this repo: the lookbehinds let
// through the code that already uses these words for something else.

export const WORD_PATTERNS = [
  /\bstripe\b/i,
  /\bpaddle\b/i,
  /\blemon ?squeezy\b/i,
  /(?<!git |actions\/)\bcheckout/i,
  /\bbilling\b/i,
  /\bsubscriptions?\b/i,
  /\bpric(e|es|ed|ing)\b/i,
  /\bpayments?\b/i,
  /(?<!SF )\bPro\b/,
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
