// A function declared inside a top-level block can lose sight of the block's
// own const on older Safari. iOS 15.6 threw "Can't find variable: viewport"
// from app.js this way, so the app's scripts keep such functions top-level.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { APP_SCRIPTS as SCRIPTS } from './support/app-scripts.mjs';

const BLOCK_START = /^(?:if|for|while|try|else)\b|^\{|^\} else/;
const BLOCK_END = /^\}/;
const NESTED_FUNCTION = /^\s+(?:async\s+)?function\s+(\w+)/;

// Names of functions declared one level inside a block that opens at the
// start of a line. Functions inside other functions are fine and not matched,
// since their enclosing line starts with `function` or a name.
function blockFunctionNames(source) {
  const names = [];
  let isInBlock = false;
  for (const line of source.split('\n')) {
    if (BLOCK_START.test(line)) isInBlock = true;
    else if (BLOCK_END.test(line)) isInBlock = false;
    const match = isInBlock && line.match(NESTED_FUNCTION);
    if (match) names.push(match[1]);
  }
  return names;
}

describe('functions declared in blocks', () => {
  it('finds a function inside an if block', () => {
    const source = 'if (x) {\n  const y = 1;\n  function z() { return y; }\n}\n';
    assert.deepEqual(blockFunctionNames(source), ['z']);
  });

  it('ignores functions inside functions', () => {
    const source = 'function outer() {\n  function inner() {}\n}\n';
    assert.deepEqual(blockFunctionNames(source), []);
  });

  for (const script of SCRIPTS) {
    it(`${script} declares no function inside a top-level block`, () => {
      const source = readFileSync(new URL(`../${script}`, import.meta.url), 'utf8');
      assert.deepEqual(blockFunctionNames(source), []);
    });
  }
});
