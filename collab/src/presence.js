// Presence rides on y-protocols awareness updates: a count, then for each
// client its id, a clock and its state as JSON. The room rewrites the name
// and colour in every state, so nobody can appear as someone else.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

const HUE_COUNT = 360;
const HASH_MULTIPLIER = 31;

export function decodePresence(update) {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const clientID = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder));
    entries.push({ clientID, clock, state });
  }
  return entries;
}

function encodeEntries(entries) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const { clientID, clock, state } of entries) {
    encoding.writeVarUint(encoder, clientID);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify(state));
  }
  return encoding.toUint8Array(encoder);
}

export function stampPresence(update, { name, colour }) {
  const entries = decodePresence(update).map(entry => ({
    ...entry,
    state: entry.state === null ? null : { ...entry.state, user: { name, colour } },
  }));
  return {
    update: encodeEntries(entries),
    clients: entries.map(({ clientID, clock }) => ({ clientID, clock })),
  };
}

// One clock past the last state, with no state, is how awareness says a
// client has gone.
export function leavePresence(clients) {
  return encodeEntries(clients.map(({ clientID, clock }) => ({ clientID, clock: clock + 1, state: null })));
}

// From the user id, so a person keeps one colour on every screen and visit.
export function colourFor(userId) {
  let hash = 0;
  for (const char of String(userId)) hash = (hash * HASH_MULTIPLIER + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % HUE_COUNT} 65% 42%)`;
}
