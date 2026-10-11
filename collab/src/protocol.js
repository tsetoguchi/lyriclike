// The room's wire format: y-protocols' sync and awareness messages, framed
// the way y-websocket frames them, plus two of the room's own.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';

export const MESSAGE = Object.freeze({ SYNC: 0, PRESENCE: 1, HELLO: 2, PERSISTED: 3 });

export const SYNC = Object.freeze({
  STEP1: syncProtocol.messageYjsSyncStep1,
  STEP2: syncProtocol.messageYjsSyncStep2,
  UPDATE: syncProtocol.messageYjsUpdate,
});

export const CLOSE = Object.freeze({
  OLD_PROTOCOL: 4001,
  TOO_LARGE: 4002,
  TOO_FAST: 4003,
  UNSHARED: 4004,
  PAGE_DELETED: 4005,
  SIGNED_OUT: 4006,
  ROOM_FULL: 4007,
  TOO_MANY_TABS: 4008,
  BAD_MESSAGE: 4009,
});

// The room and the site deploy separately, so the room accepts the version
// before its own too. On a bump, set OLDEST_PROTOCOL to the old version.
export const PROTOCOL_VERSION = 1;
export const OLDEST_PROTOCOL = 1;

const NO_SNAPSHOT = new Uint8Array(0);

export function isProtocolAccepted(version) {
  return Number.isInteger(version) && version >= OLDEST_PROTOCOL && version <= PROTOCOL_VERSION;
}

function build(type, write) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export function encodeHello(epoch, oldEpochSnapshot) {
  return build(MESSAGE.HELLO, encoder => {
    encoding.writeVarString(encoder, epoch);
    encoding.writeVarUint8Array(encoder, oldEpochSnapshot || NO_SNAPSHOT);
  });
}

export function encodePersisted(snapshot) {
  return build(MESSAGE.PERSISTED, encoder => encoding.writeVarUint8Array(encoder, snapshot));
}

export function encodeSyncStep1(doc) {
  return build(MESSAGE.SYNC, encoder => syncProtocol.writeSyncStep1(encoder, doc));
}

export function encodeSyncStep2(doc, stateVector) {
  return build(MESSAGE.SYNC, encoder => syncProtocol.writeSyncStep2(encoder, doc, stateVector));
}

export function encodeUpdate(update) {
  return build(MESSAGE.SYNC, encoder => syncProtocol.writeUpdate(encoder, update));
}

export function encodePresence(update) {
  return build(MESSAGE.PRESENCE, encoder => encoding.writeVarUint8Array(encoder, update));
}

function readSync(decoder) {
  const syncType = decoding.readVarUint(decoder);
  const payload = decoding.readVarUint8Array(decoder);
  if (syncType === SYNC.STEP1) return { kind: 'state-vector', stateVector: payload };
  if (syncType === SYNC.STEP2 || syncType === SYNC.UPDATE) return { kind: 'update', update: payload };
  return { kind: 'unknown' };
}

// What a client sent, read without applying anything, so the room can check
// sizes first. A message it cannot read is 'unknown', never an exception.
export function readIncoming(bytes) {
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE.SYNC) return readSync(decoder);
    if (type === MESSAGE.PRESENCE) return { kind: 'presence', update: decoding.readVarUint8Array(decoder) };
    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

function readHello(decoder) {
  const epoch = decoding.readVarString(decoder);
  const old = decoding.readVarUint8Array(decoder);
  return { kind: 'hello', epoch, oldEpochSnapshot: old.length ? old : null };
}

// What the room sent: for the browser client and the tests.
export function readRoomMessage(bytes) {
  const decoder = decoding.createDecoder(bytes);
  const type = decoding.readVarUint(decoder);
  if (type === MESSAGE.HELLO) return readHello(decoder);
  if (type === MESSAGE.PERSISTED) return { kind: 'persisted', snapshot: decoding.readVarUint8Array(decoder) };
  if (type === MESSAGE.PRESENCE) return { kind: 'presence', update: decoding.readVarUint8Array(decoder) };
  if (type !== MESSAGE.SYNC) return { kind: 'unknown' };
  const syncType = decoding.readVarUint(decoder);
  return { kind: 'sync', syncType, payload: decoding.readVarUint8Array(decoder) };
}
