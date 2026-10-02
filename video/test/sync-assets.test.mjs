import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readTheme } from '../scripts/sync-assets.mjs';

const STYLES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles.css');

test('readTheme finds every colour token the videos use in the real stylesheet', () => {
  const theme = readTheme(readFileSync(STYLES_PATH, 'utf8'));
  assert.match(theme.colors.paper, /^#[0-9a-f]{6}$/i);
  assert.match(theme.colors.accent, /^#[0-9a-f]{6}$/i);
  assert.equal(theme.scheme.length, 10);
  for (const color of theme.scheme) assert.match(color, /^#[0-9a-f]{6}$/i);
});

test('readTheme fails loudly when a token is missing', () => {
  assert.throws(() => readTheme(':root {\n  --paper: #000;\n}'), /--paper-card/);
});
