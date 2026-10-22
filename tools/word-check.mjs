// Refuses a push or PR whose new lines, commit messages, branch name or PR
// text use a word from tools/word-check-words.mjs. Only what is added is
// read, so words already in the repo never trip it. A line holding
// "word-check: allow" is let through, for the rare honest use.
//
//   node tools/word-check.mjs <base> <head> [branch]
//
// The pre-push hook in .githooks and the word-check workflow both run it.
// The workflow passes the PR title and body in WORD_CHECK_TEXT.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { SKIPPED_FILES, WORD_PATTERNS } from './word-check-words.mjs';

const ALLOW_MARK = 'word-check: allow';
const NO_COMMIT = /^0+$/;
const MAIN_BRANCH = 'origin/main';
const GIT_OUTPUT_LIMIT = 512 * 1024 * 1024;
const HUNK_START = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const NEW_FILE = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/;
const EXIT_HITS = 1;
const EXIT_FAILED = 2;

// The added lines of a `git diff --unified=0`, each with its file and its
// line number in the new version.
export function addedLines(diff) {
  const entries = [];
  let source = null;
  let line = 0;
  let isInHunk = false;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('diff --git ')) {
      isInHunk = false;
    } else if (!isInHunk && NEW_FILE.test(raw)) {
      source = raw.match(NEW_FILE)[1] ?? null;
    } else if (HUNK_START.test(raw)) {
      isInHunk = true;
      line = Number(raw.match(HUNK_START)[1]);
    } else if (isInHunk && raw.startsWith('+')) {
      entries.push({ source, line, text: raw.slice(1) });
      line += 1;
    }
  }
  return entries;
}

function isSkippedFile(source) {
  return SKIPPED_FILES.some(pattern => pattern.test(source));
}

function firstWord(text) {
  for (const pattern of WORD_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// Each entry ({ source, line, text }) that uses a refused word, with the word.
export function findHits(entries) {
  const hits = [];
  for (const entry of entries) {
    if (entry.source === null || isSkippedFile(entry.source)) continue;
    if (entry.text.includes(ALLOW_MARK)) continue;
    const word = firstWord(entry.text);
    if (word) hits.push({ ...entry, word });
  }
  return hits;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: GIT_OUTPUT_LIMIT });
}

function textLines(source, text) {
  return text.split(/\r?\n/).map((lineText, index) => ({
    source, line: index + 1, text: lineText,
  }));
}

function commitMessageLines(base, head) {
  const log = git('log', '--format=%h%x00%B%x1e', `${base}..${head}`);
  return log.split('\x1e').filter(record => record.trim()).flatMap(record => {
    const [hash, message] = record.trim().split('\0');
    return textLines(`commit ${hash}`, message);
  });
}

// Everything the push or PR adds: new lines, commit messages, the branch
// name and any PR text.
function collectEntries(base, head, branch) {
  const from = git('merge-base', NO_COMMIT.test(base) ? MAIN_BRANCH : base, head).trim();
  return [
    ...addedLines(git('diff', '--unified=0', '--no-color', '--no-ext-diff', from, head)),
    ...commitMessageLines(from, head),
    ...(branch ? textLines('branch name', branch) : []),
    ...textLines('PR text', process.env.WORD_CHECK_TEXT || ''),
  ];
}

function report(hits) {
  for (const hit of hits) {
    console.error(`${hit.source}:${hit.line}: "${hit.word}" in: ${hit.text.trim()}`);
  }
  console.error(`\nWord check: ${hits.length} line(s) use a word that belongs in the ` +
    `other repo. Move the change there, or add "${ALLOW_MARK}" to a line that ` +
    'really belongs here.');
}

function main([base, head, branch]) {
  if (!base || !head) {
    console.error('Usage: node tools/word-check.mjs <base> <head> [branch]');
    return EXIT_FAILED;
  }
  const hits = findHits(collectEntries(base, head, branch));
  if (hits.length) report(hits);
  return hits.length ? EXIT_HITS : 0;
}

const isRunDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isRunDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
