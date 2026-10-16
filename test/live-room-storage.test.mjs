// The room's own storage: page id, the chunked snapshot, meta, and the
// snapshots kept for past epochs.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { CHUNK_BYTES, KEPT_EPOCHS, RoomStorage } from '../collab/src/room-storage.js';
import { createFakeDurableStorage } from './support/fake-durable-storage.mjs';

const META = { epoch: 'e1', written: { revision: 1, text: 'hi', title: 'Song' }, emptySince: null };

let storage;

beforeEach(() => {
  storage = new RoomStorage(createFakeDurableStorage());
});

describe('RoomStorage', () => {
  it('starts empty', () => {
    assert.equal(storage.loadPageId(), null);
    assert.deepEqual(storage.loadState(), { snapshot: null, meta: null });
  });

  it('keeps the page id', () => {
    storage.savePageId('page-1');
    assert.equal(storage.loadPageId(), 'page-1');
  });

  it('round-trips a snapshot too big for one row, in chunks', () => {
    const update = new Uint8Array(CHUNK_BYTES * 2 + 5).map((_, i) => i % 251);
    storage.saveSnapshot(update, META);
    const { snapshot, meta } = storage.loadState();
    assert.deepEqual(snapshot, update);
    assert.deepEqual(meta, META);
  });

  it('replaces the snapshot rather than adding to it', () => {
    storage.saveSnapshot(new Uint8Array(CHUNK_BYTES + 1), META);
    storage.saveSnapshot(new Uint8Array([7, 8]), META);
    assert.deepEqual(storage.loadState().snapshot, new Uint8Array([7, 8]));
  });

  it('updates meta without touching the snapshot', () => {
    storage.saveSnapshot(new Uint8Array([1]), META);
    storage.saveMeta({ ...META, emptySince: 5 });
    assert.deepEqual(storage.loadState(), { snapshot: new Uint8Array([1]), meta: { ...META, emptySince: 5 } });
  });

  it("clears the working copy but keeps the epoch's final snapshot", () => {
    storage.savePageId('page-1');
    storage.saveSnapshot(new Uint8Array([1]), META);
    storage.clearWorkingCopy('e1', new Uint8Array([9, 9]), 100);
    assert.deepEqual(storage.loadState(), { snapshot: null, meta: null });
    assert.deepEqual(storage.loadEpochSnapshot('e1'), new Uint8Array([9, 9]));
    assert.equal(storage.loadPageId(), 'page-1');
  });

  it(`keeps only the newest ${KEPT_EPOCHS} epochs`, () => {
    for (let i = 0; i <= KEPT_EPOCHS; i += 1) storage.clearWorkingCopy(`e${i}`, new Uint8Array([i]), i);
    assert.equal(storage.loadEpochSnapshot('e0'), null);
    assert.deepEqual(storage.loadEpochSnapshot(`e${KEPT_EPOCHS}`), new Uint8Array([KEPT_EPOCHS]));
  });

  it('deletes everything and stays usable', async () => {
    storage.savePageId('page-1');
    storage.clearWorkingCopy('e1', new Uint8Array([1]), 1);
    await storage.deleteAll();
    assert.equal(storage.loadPageId(), null);
    assert.equal(storage.loadEpochSnapshot('e1'), null);
    storage.savePageId('page-2');
    assert.equal(storage.loadPageId(), 'page-2');
  });
});
