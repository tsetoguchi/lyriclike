// The live page's local copy in IndexedDB (live-store.js), against
// fake-indexeddb: what goes in comes back, binary parts and all.
//
//   cd collab && npm install; cd .. && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import liveStore from '../live-store.js';
import { IDBFactory } from './support/fake-indexeddb.mjs';

const { LiveStore, NO_STORE, createLiveStore } = liveStore;

const RECORD = {
  id: 'page-1',
  epoch: 'epoch-1',
  savedAt: 7,
  working: new Uint8Array([1, 2, 3]),
  confirmed: new Uint8Array([4]),
  pending: [new Uint8Array([5]), new Uint8Array([6, 7])],
};

let store;

beforeEach(() => {
  store = new LiveStore(new IDBFactory());
});

describe('the copy store', () => {
  it('keeps a record, binary parts and all', async () => {
    await store.save(RECORD);
    assert.deepEqual(await store.load('page-1'), RECORD);
  });

  it('gives null for a page it has no copy of', async () => {
    assert.equal(await store.load('nothing'), null);
  });

  it('removes one copy, and clears them all', async () => {
    await store.save(RECORD);
    await store.save({ ...RECORD, id: 'page-2' });
    await store.remove('page-1');
    assert.equal(await store.load('page-1'), null);
    assert.ok(await store.load('page-2'));
    await store.clear();
    assert.equal(await store.load('page-2'), null);
  });

  it('runs calls in the order they were made', async () => {
    const removing = store.remove('page-1');
    const saving = store.save(RECORD);
    await Promise.all([removing, saving]);
    assert.ok(await store.load('page-1'), 'the later save wins');
    const saving2 = store.save(RECORD);
    const removing2 = store.remove('page-1');
    await Promise.all([saving2, removing2]);
    assert.equal(await store.load('page-1'), null, 'the later remove wins');
  });

  it('opens a new connection when the browser closed the old one', async () => {
    const db = await store.database();
    db.close();
    await store.save(RECORD);
    assert.deepEqual(await store.load('page-1'), RECORD);
  });
});

describe('without IndexedDB', () => {
  it('keeps nothing and never fails', async () => {
    const none = createLiveStore({});
    assert.equal(none, NO_STORE);
    await none.save(RECORD);
    assert.equal(await none.load('page-1'), null);
    await none.remove('page-1');
    await none.clear();
  });

  it('keeps nothing where reading indexedDB throws', () => {
    const blocked = { get indexedDB() { throw new Error('blocked'); } };
    assert.equal(createLiveStore(blocked), NO_STORE);
  });

  it('uses IndexedDB where there is one', () => {
    assert.ok(createLiveStore({ indexedDB: new IDBFactory() }) instanceof LiveStore);
  });
});
