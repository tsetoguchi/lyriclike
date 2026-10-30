// random-id.js fills in crypto.randomUUID for browsers that lack it, which
// storage.js needs the moment it loads.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { APP_SCRIPTS as SCRIPTS } from './support/app-scripts.mjs';

const SOURCE = readFileSync(new URL('../random-id.js', import.meta.url), 'utf8');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAMPLE_COUNT = 500;

function runIn(cryptoApi) {
  const context = vm.createContext({ crypto: cryptoApi });
  context.globalThis = context;
  vm.runInContext(SOURCE, context);
  return cryptoApi;
}

function oldBrowserCrypto() {
  return { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
}

describe('random-id.js', () => {
  it('adds randomUUID when the browser has none', () => {
    const cryptoApi = runIn(oldBrowserCrypto());
    assert.equal(typeof cryptoApi.randomUUID, 'function');
  });

  it('makes version 4 ids that do not repeat', () => {
    const cryptoApi = runIn(oldBrowserCrypto());
    const ids = Array.from({ length: SAMPLE_COUNT }, () => cryptoApi.randomUUID());
    for (const id of ids) assert.match(id, UUID_V4);
    assert.equal(new Set(ids).size, SAMPLE_COUNT);
  });

  it('leaves a browser that has randomUUID alone', () => {
    const nativeRandomUuid = () => 'native';
    const cryptoApi = runIn({ ...oldBrowserCrypto(), randomUUID: nativeRandomUuid });
    assert.equal(cryptoApi.randomUUID, nativeRandomUuid);
  });

  it('loads before every script that makes ids', () => {
    const callers = SCRIPTS.filter(script =>
      readFileSync(new URL(`../${script}`, import.meta.url), 'utf8').includes('randomUUID'));
    const at = SCRIPTS.indexOf('random-id.js');
    assert.ok(callers.includes('storage.js'));
    for (const caller of callers.filter(script => script !== 'random-id.js')) {
      assert.ok(at > -1 && at < SCRIPTS.indexOf(caller), caller);
    }
  });
});
