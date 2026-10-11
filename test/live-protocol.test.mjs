// The room's wire format: y-protocols framing plus the room's own hello and
// persisted messages.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MESSAGE, OLDEST_PROTOCOL, PROTOCOL_VERSION, SYNC, encodeHello, encodePersisted, encodePresence,
  encodeSyncStep1, encodeSyncStep2, encodeUpdate, isProtocolAccepted, readIncoming, readRoomMessage,
} from '../collab/src/protocol.js';
import { Y } from './support/live-deps.mjs';

function docWith(text) {
  const doc = new Y.Doc();
  doc.getText('body').insert(0, text);
  return doc;
}

describe('protocol versions', () => {
  it('accepts the current and oldest supported versions only', () => {
    assert.equal(isProtocolAccepted(PROTOCOL_VERSION), true);
    assert.equal(isProtocolAccepted(OLDEST_PROTOCOL), true);
    assert.equal(isProtocolAccepted(OLDEST_PROTOCOL - 1), false);
    assert.equal(isProtocolAccepted(PROTOCOL_VERSION + 1), false);
    assert.equal(isProtocolAccepted(Number.NaN), false);
  });
});

describe('room messages', () => {
  it('round-trips hello with and without an old epoch snapshot', () => {
    assert.deepEqual(readRoomMessage(encodeHello('e1', null)),
      { kind: 'hello', epoch: 'e1', oldEpochSnapshot: null });
    const old = new Uint8Array([1, 2, 3]);
    assert.deepEqual(readRoomMessage(encodeHello('e2', old)),
      { kind: 'hello', epoch: 'e2', oldEpochSnapshot: old });
  });

  it('round-trips persisted', () => {
    const snapshot = Y.encodeSnapshot(Y.snapshot(docWith('saved')));
    assert.deepEqual(readRoomMessage(encodePersisted(snapshot)), { kind: 'persisted', snapshot });
  });

  it('carries sync messages a client can apply', () => {
    const room = docWith('from the room');
    const client = new Y.Doc();
    const step1 = readRoomMessage(encodeSyncStep1(client));
    assert.equal(step1.syncType, SYNC.STEP1);
    const step2 = readRoomMessage(encodeSyncStep2(room, step1.payload));
    assert.equal(step2.syncType, SYNC.STEP2);
    Y.applyUpdate(client, step2.payload);
    assert.equal(client.getText('body').toString(), 'from the room');
  });
});

describe('readIncoming', () => {
  it('tells a state vector from an update', () => {
    const doc = docWith('hi');
    assert.equal(readIncoming(encodeSyncStep1(doc)).kind, 'state-vector');
    const update = Y.encodeStateAsUpdate(doc);
    assert.deepEqual(readIncoming(encodeUpdate(update)), { kind: 'update', update });
    assert.deepEqual(readIncoming(encodeSyncStep2(doc, new Uint8Array([0]))).kind, 'update');
  });

  it('reads presence', () => {
    const update = new Uint8Array([0]);
    assert.deepEqual(readIncoming(encodePresence(update)), { kind: 'presence', update });
  });

  it('calls anything else unknown, without throwing', () => {
    assert.deepEqual(readIncoming(new Uint8Array([MESSAGE.HELLO, 0])), { kind: 'unknown' });
    assert.deepEqual(readIncoming(new Uint8Array([MESSAGE.SYNC, 9, 0])), { kind: 'unknown' });
    assert.deepEqual(readIncoming(new Uint8Array([MESSAGE.SYNC])), { kind: 'unknown' });
  });
});
