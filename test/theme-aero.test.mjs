// theme-aero.css re-inks the app for the Aero theme, and theme-boot.js puts
// the saved theme on <html> before the first paint. Every color the default
// sets must be re-inked, or a dark slate patch shows on the light page, and
// the text colors must stay readable on the surfaces they sit on.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const TOKENS_CSS = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const AERO_CSS = readFileSync(new URL('../theme-aero.css', import.meta.url), 'utf8');
const BOOT_SOURCE = readFileSync(new URL('../theme-boot.js', import.meta.url), 'utf8');
const AERO_ROOT_BLOCK = /:root\[data-theme="aero"\]\s*\{([^}]*)\}/;
const DECLARATION = /--([\w-]+):\s*([^;]+);/g;
const COLOR_VALUE = /#[0-9a-f]{3,8}\b|rgba?\(/i;
const MIN_TEXT_CONTRAST = 4.5;
// Brand buttons keep their own colors whatever the theme.
const KEPT_COLOR_TOKENS = ['apple-fill', 'apple-text'];

function tokensOf(block) {
  return new Map([...block.matchAll(DECLARATION)].map(([, name, value]) => [name, value.trim()]));
}

function colorTokenNames(tokens) {
  return [...tokens].filter(([, value]) => COLOR_VALUE.test(value)).map(([name]) => name);
}

function channelLuminance(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [red, green, blue] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green)
    + 0.0722 * channelLuminance(blue);
}

function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const defaultTokens = tokensOf(TOKENS_CSS);
const aeroTokens = tokensOf(AERO_CSS.match(AERO_ROOT_BLOCK)[1]);

describe('theme-aero.css', () => {
  it('re-inks every color the default theme sets', () => {
    const missing = colorTokenNames(defaultTokens)
      .filter(name => !aeroTokens.has(name) && !KEPT_COLOR_TOKENS.includes(name));
    assert.deepEqual(missing, []);
  });

  it('keeps text readable on the paper, the card and the desk', () => {
    const inks = ['ink', 'ink-faded', 'accent', 'danger', 'danger-text', 'panel-button-ink',
      ...[...aeroTokens.keys()].filter(name => /^(rhyme|scheme)-/.test(name))];
    const surfaces = ['paper', 'paper-card', 'paper-panel', 'desk'];
    for (const ink of inks) {
      for (const surface of surfaces) {
        const ratio = contrast(aeroTokens.get(ink), aeroTokens.get(surface));
        assert.ok(ratio >= MIN_TEXT_CONTRAST, `--${ink} on --${surface}: ${ratio.toFixed(2)}`);
      }
    }
  });
});

function bootIn(savedTheme) {
  const attributes = new Map();
  const bar = { content: '#0a0d13', setAttribute(name, value) { this.content = value; } };
  const store = new Map(savedTheme === undefined ? [] : [['theme', savedTheme]]);
  const window = {};
  const context = {
    window,
    document: {
      documentElement: {
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: name => attributes.delete(name),
      },
      querySelector: () => bar,
    },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
    },
  };
  vm.runInNewContext(BOOT_SOURCE, context);
  return { attributes, bar, store, appTheme: window.appTheme };
}

describe('theme-boot.js', () => {
  it('leaves the default look alone when nothing is saved', () => {
    const page = bootIn(undefined);
    assert.equal(page.attributes.has('data-theme'), false);
    assert.equal(page.appTheme.current(), 'blue-hour');
  });

  it('puts the saved theme on the page and the browser bar', () => {
    const page = bootIn('aero');
    assert.equal(page.attributes.get('data-theme'), 'aero');
    assert.equal(page.bar.content, '#3a9df1');
  });

  it('ignores a saved name it does not know', () => {
    const page = bootIn('neon');
    assert.equal(page.attributes.has('data-theme'), false);
  });

  it('switches back to the default and remembers it', () => {
    const page = bootIn('aero');
    assert.equal(page.appTheme.set('blue-hour'), true);
    assert.equal(page.attributes.has('data-theme'), false);
    assert.equal(page.store.get('theme'), 'blue-hour');
    assert.equal(page.appTheme.set('neon'), false);
    assert.equal(page.appTheme.current(), 'blue-hour');
  });
});
