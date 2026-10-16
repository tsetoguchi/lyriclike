// Presence (y-protocols awareness): the room stamps each state with the
// person's own name and colour, and says when someone leaves.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { awarenessProtocol, Y } from '../collab/src/deps.js';
import { colourFor, decodePresence, leavePresence, stampPresence } from '../collab/src/presence.js';

const ANN = { name: 'Ann', colour: 'hsl(10 65% 42%)' };

function awarenessWith(state) {
  const awareness = new awarenessProtocol.Awareness(new Y.Doc());
  awareness.setLocalState(state);
  return awareness;
}

describe('stampPresence', () => {
  it("replaces the name and colour with the room's and keeps the rest", () => {
    const awareness = awarenessWith({ user: { name: 'Not Ann', colour: 'red' }, cursor: { anchor: 3 } });
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
    const stamped = stampPresence(update, ANN);
    const [entry] = decodePresence(stamped.update);
    assert.deepEqual(entry.state, { user: ANN, cursor: { anchor: 3 } });
    assert.deepEqual(stamped.clients, [{ clientID: awareness.clientID, clock: entry.clock }]);
    awareness.destroy();
  });

  it('leaves a null state null', () => {
    const awareness = awarenessWith(null);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
    assert.equal(decodePresence(stampPresence(update, ANN).update)[0].state, null);
    awareness.destroy();
  });

  it('throws on an unreadable update, for the caller to ignore', () => {
    assert.throws(() => stampPresence(new Uint8Array([5]), ANN));
  });
});

describe('leavePresence', () => {
  it("removes the person from everyone else's awareness", () => {
    const theirs = awarenessWith({ cursor: null });
    const mine = new awarenessProtocol.Awareness(new Y.Doc());
    const joined = stampPresence(
      awarenessProtocol.encodeAwarenessUpdate(theirs, [theirs.clientID]), ANN);
    awarenessProtocol.applyAwarenessUpdate(mine, joined.update, 'room');
    assert.equal(mine.getStates().has(theirs.clientID), true);
    awarenessProtocol.applyAwarenessUpdate(mine, leavePresence(joined.clients), 'room');
    assert.equal(mine.getStates().has(theirs.clientID), false);
    theirs.destroy();
    mine.destroy();
  });
});

describe('colourFor', () => {
  it('gives one person the same colour every time', () => {
    assert.equal(colourFor('user-1'), colourFor('user-1'));
    assert.match(colourFor('user-1'), /^hsl\(\d+ 65% 42%\)$/);
    assert.notEqual(colourFor('user-1'), colourFor('user-2'));
  });
});
