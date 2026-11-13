// keyboard-inset.js measures how much of the screen the on-screen keyboard
// covers, so popups can stop above it.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../keyboard-inset.js', import.meta.url), 'utf8');
const LAYOUT_HEIGHT = 466;

function loadKeyboardInset() {
  const context = { document: {} };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  return context.KeyboardInset;
}

describe('measureKeyboardInset', () => {
  const { measureKeyboardInset } = loadKeyboardInset();

  it('is zero with no keyboard', () => {
    const viewport = { height: LAYOUT_HEIGHT, offsetTop: 0 };
    assert.equal(measureKeyboardInset(viewport, LAYOUT_HEIGHT), 0);
  });

  it('is the height the keyboard covers', () => {
    const viewport = { height: 170, offsetTop: 0 };
    assert.equal(measureKeyboardInset(viewport, LAYOUT_HEIGHT), 296);
  });

  it('leaves out a scrolled-down visual viewport', () => {
    const viewport = { height: 170, offsetTop: 40 };
    assert.equal(measureKeyboardInset(viewport, LAYOUT_HEIGHT), 256);
  });

  it('is never below zero', () => {
    const viewport = { height: 500, offsetTop: 0 };
    assert.equal(measureKeyboardInset(viewport, LAYOUT_HEIGHT), 0);
  });
});
