import { test } from 'node:test';
import assert from 'node:assert/strict';

import { censorDisplay } from '../src/censor.ts';

const CENSOR = { bitches: 'b*tches' };

test('a listed word is swapped for its censored form', () => {
  assert.equal(censorDisplay('bitches', CENSOR), 'b*tches');
});

test('the swap keeps a capital first letter or all capitals', () => {
  assert.equal(censorDisplay('Bitches', CENSOR), 'B*tches');
  assert.equal(censorDisplay('BITCHES', CENSOR), 'B*TCHES');
});

test('words that are not listed are left alone', () => {
  assert.equal(censorDisplay('baddest', CENSOR), 'baddest');
  assert.equal(censorDisplay('L.A.', CENSOR), 'L.A.');
});

test('with nothing to censor every word is left alone', () => {
  assert.equal(censorDisplay('bitches', {}), 'bitches');
});
