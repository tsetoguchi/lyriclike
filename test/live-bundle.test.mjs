// The browser's copy of Yjs and the room's wire format: built reproducibly,
// committed, and never stale.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import live from '../live.js';
import { buildLiveDeps, liveDepsFileName } from '../tools/build-live-deps.mjs';

const normalized = text => text.replace(/\r\n/g, '\n');

describe('the live bundle', () => {
  it('is committed under the name live.js asks for', () => {
    assert.equal(live.LIVE_DEPS_SRC, `/vendor/${liveDepsFileName()}`);
  });

  it('matches a fresh build, so it is never stale', async () => {
    const committed = readFileSync(new URL(`../vendor/${liveDepsFileName()}`, import.meta.url), 'utf8');
    assert.equal(normalized(committed), normalized(await buildLiveDeps()));
  });

  it('sets window.LiveDeps with Yjs and the wire format', async () => {
    // What a browser page has that the bundle touches when it starts.
    const sandbox = {
      window: {}, crypto: globalThis.crypto, console, TextEncoder, TextDecoder,
      setTimeout, clearTimeout, setInterval, clearInterval,
    };
    sandbox.self = sandbox.window;
    vm.runInNewContext(`${await buildLiveDeps()}\nwindow.LiveDeps = LiveDeps;`, sandbox);
    const { Y, protocol, DiffMatchPatch } = sandbox.window.LiveDeps;
    assert.equal(typeof Y.Doc, 'function');
    assert.equal(protocol.PROTOCOL_VERSION, 1);
    assert.equal(typeof DiffMatchPatch, 'function');
  });
});
