// Presence in the browser, without a room: colours, initials, who is here
// and where carets are (live-presence.js), and the channel that sends this
// tab's caret. Sessions against the room are in live-presence-session.
//
//   cd collab && npm install; cd .. && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodePresence, colourFor as roomColourFor } from '../collab/src/presence.js';
import * as protocol from '../collab/src/protocol.js';
import livePresence from '../live-presence.js';
import { createFakeClock } from './support/fake-clock.mjs';
import { awarenessProtocol, Y } from './support/live-deps.mjs';

const {
  EMPTY_VIEW, PresenceChannel, caretsIn, colourFor, encodeCursor, initialsOf, peopleHere, screenColour,
} = livePresence;

const BO = { name: 'Bo', colour: 'hsl(20 65% 42%)' };
const AL = { name: 'Al', colour: 'hsl(30 65% 42%)' };
const ME = { id: 'ann', name: 'Ann', email: 'ann@example.com' };

function docWith(text) {
  const doc = new Y.Doc();
  doc.getText('body').insert(0, text);
  return doc;
}

function cursorIn(doc, start, end = start, direction = 'forward') {
  return encodeCursor(Y, doc.getText('body'), { start, end, direction });
}

describe('colours', () => {
  it("matches the room's colour for every user id", () => {
    for (const id of ['a', 'user-1', '3f2c9e0a-11aa-4b5c-9d00-abcdef012345', 'ñandú']) {
      assert.equal(colourFor(id), roomColourFor(id));
    }
  });

  it('draws the room colour lighter for the dark card', () => {
    assert.equal(screenColour('hsl(200 65% 42%)'), 'hsl(200 70% 68%)');
    assert.equal(screenColour('red'), 'red');
  });
});

describe('initialsOf', () => {
  it('takes the first and last word of a name', () => {
    assert.equal(initialsOf('Ann Lee'), 'AL');
    assert.equal(initialsOf('Mary Ann van Dyke'), 'MD');
    assert.equal(initialsOf('ann'), 'A');
  });

  it('uses the part before the @ when the name is an email', () => {
    assert.equal(initialsOf('ann.lee@example.com'), 'AL');
    assert.equal(initialsOf('bo@example.com'), 'B');
  });

  it('keeps whole letters: accents, CJK and emoji', () => {
    assert.equal(initialsOf('émile zola'), 'ÉZ');
    assert.equal(initialsOf('Bö 鈴木'), 'B鈴');
    assert.equal(initialsOf('😀 Smile'), '😀S');
  });

  it('gives a question mark for an empty name', () => {
    assert.equal(initialsOf(''), '?');
    assert.equal(initialsOf('@example.com'), '?');
  });
});

describe('peopleHere', () => {
  it('lists each other person once however many tabs, in name order', () => {
    const states = new Map([[1, { user: BO }], [2, { user: BO }], [3, { user: AL }], [4, null], [5, { cursor: null }]]);
    const people = peopleHere(states, 99, ME);
    assert.deepEqual(people.map(person => person.name), ['Al', 'Bo']);
    assert.equal(people[1].initials, 'B');
    assert.equal(people[1].colour, 'hsl(20 70% 68%)');
  });

  it('leaves out this tab and my other tabs', () => {
    const mine = { name: 'Ann', colour: colourFor('ann') };
    const states = new Map([[7, { user: mine }], [8, { user: mine }]]);
    assert.deepEqual(peopleHere(states, 7, ME), []);
  });

  it('knows me by email when I have no name, as the room does', () => {
    const mine = { name: 'ann@example.com', colour: colourFor('ann') };
    assert.deepEqual(peopleHere(new Map([[8, { user: mine }]]), 7, { ...ME, name: null }), []);
  });

  it('keeps two different people who share a name', () => {
    const states = new Map([[1, { user: BO }], [2, { user: { ...BO, colour: 'hsl(99 65% 42%)' } }]]);
    assert.equal(peopleHere(states, 0, ME).length, 2);
  });
});

describe('caretsIn', () => {
  it('finds a caret and a selection, with the head where the caret blinks', () => {
    const doc = docWith('hello world');
    const states = new Map([[1, { user: BO, cursor: cursorIn(doc, 2, 5, 'backward') }]]);
    const [caret] = caretsIn(Y, doc, states, 0, ME);
    assert.deepEqual([caret.clientID, caret.name, caret.start, caret.end, caret.head], [1, 'Bo', 2, 5, 2]);
  });

  it('keeps a caret on its letter when text is added before it', () => {
    const doc = docWith('hello world');
    const states = new Map([[1, { user: BO, cursor: cursorIn(doc, 6) }]]);
    doc.getText('body').insert(0, 'oh ');
    assert.equal(caretsIn(Y, doc, states, 0, ME)[0].head, 9);
  });

  it('skips a caret on words this tab has not received yet', () => {
    const theirs = docWith('hello');
    const mine = new Y.Doc();
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs));
    theirs.getText('body').insert(5, ' there');
    const states = new Map([[1, { user: BO, cursor: cursorIn(theirs, 8) }]]);
    assert.deepEqual(caretsIn(Y, mine, states, 0, ME), []);
  });

  it('skips a state with no caret, and a malformed one', () => {
    const doc = docWith('hello');
    const states = new Map([
      [1, { user: BO, cursor: null }],
      [2, { user: AL, cursor: { anchor: { nonsense: true }, head: 5 } }],
    ]);
    assert.deepEqual(caretsIn(Y, doc, states, 0, ME), []);
  });
});

function makeChannel({ me = ME } = {}) {
  const clock = createFakeClock();
  const harness = { clock, sent: [], views: [], selection: null, isOpen: true };
  harness.channel = new PresenceChannel({
    deps: { Y, awarenessProtocol, protocol }, clock, me,
    send: bytes => {
      if (harness.isOpen) harness.sent.push(bytes);
      return harness.isOpen;
    },
    show: view => harness.views.push(view),
    readSelection: () => harness.selection,
  });
  return harness;
}

// What a presence message the channel sent says about this tab.
function sentState(bytes) {
  const message = protocol.readRoomMessage(bytes);
  return decodePresence(message.update)[0].state;
}

// Another tab's presence, as the room relays it: stamped with a user.
function remoteUpdate(state) {
  const other = new awarenessProtocol.Awareness(new Y.Doc());
  other.setLocalState(state);
  const update = awarenessProtocol.encodeAwarenessUpdate(other, [other.clientID]);
  other.destroy();
  return update;
}

describe('PresenceChannel', () => {
  it("turns off the library's 15-second renewal and 30-second drop", () => {
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    const made = [];
    const cleared = [];
    globalThis.setInterval = (fn, ms) => {
      const handle = realSet(fn, ms);
      made.push(handle);
      return handle;
    };
    globalThis.clearInterval = handle => {
      cleared.push(handle);
      realClear(handle);
    };
    let harness;
    try {
      harness = makeChannel();
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
    assert.ok(made.length > 0 && made.every(handle => cleared.includes(handle)));
    harness.channel.destroy();
  });

  it('announces with no caret when the editor has none', () => {
    const harness = makeChannel();
    harness.channel.attach(docWith('hello'));
    harness.channel.announce();
    assert.deepEqual(sentState(harness.sent[0]), { cursor: null });
    harness.channel.destroy();
  });

  it('reads the selection when the message goes, at most every 300 ms', () => {
    const harness = makeChannel();
    const doc = docWith('hello');
    harness.channel.attach(doc);
    harness.selection = { start: 1, end: 1, direction: 'forward' };
    harness.channel.selectionMoved();
    harness.selection = { start: 2, end: 2, direction: 'forward' };
    harness.clock.advance(0);
    assert.equal(harness.sent.length, 1);
    const cursor = sentState(harness.sent[0]).cursor;
    assert.equal(caretsIn(Y, doc, new Map([[1, { user: BO, cursor }]]), 0, ME)[0].head, 2);
    harness.selection = { start: 3, end: 3, direction: 'forward' };
    harness.channel.selectionMoved();
    harness.clock.advance(299);
    assert.equal(harness.sent.length, 1);
    harness.clock.advance(1);
    assert.equal(harness.sent.length, 2);
    harness.channel.destroy();
  });

  it('sends nothing when the caret did not move, or there is none', () => {
    const harness = makeChannel();
    harness.channel.attach(docWith('hello'));
    harness.selection = { start: 1, end: 1, direction: 'forward' };
    harness.channel.selectionMoved();
    harness.clock.advance(1000);
    harness.channel.selectionMoved();
    harness.clock.advance(1000);
    harness.selection = null;
    harness.channel.selectionMoved();
    harness.clock.advance(1000);
    assert.equal(harness.sent.length, 1);
    harness.channel.destroy();
  });

  it('tries again later when the socket was not open', () => {
    const harness = makeChannel();
    harness.channel.attach(docWith('hello'));
    harness.selection = { start: 1, end: 1, direction: 'forward' };
    harness.isOpen = false;
    harness.channel.selectionMoved();
    harness.clock.advance(1000);
    harness.isOpen = true;
    harness.channel.selectionMoved();
    harness.clock.advance(1000);
    assert.equal(harness.sent.length, 1);
    harness.channel.destroy();
  });

  it('shows who the room says is here, and ignores an unreadable message', () => {
    const harness = makeChannel();
    harness.channel.receive(remoteUpdate({ user: BO, cursor: null }));
    harness.channel.receive(new Uint8Array([9, 9]));
    assert.deepEqual(harness.views.at(-1).people.map(person => person.name), ['Bo']);
    harness.channel.destroy();
  });

  it('forgets everyone on restart, and starts again with a new client id', () => {
    const harness = makeChannel();
    harness.channel.receive(remoteUpdate({ user: BO, cursor: null }));
    const oldID = harness.channel.awareness.clientID;
    harness.channel.restart();
    assert.deepEqual(harness.views.at(-1).people, []);
    assert.notEqual(harness.channel.awareness.clientID, oldID);
    harness.channel.destroy();
  });

  it('shows nothing once destroyed', () => {
    const harness = makeChannel();
    harness.channel.receive(remoteUpdate({ user: BO, cursor: null }));
    harness.channel.destroy();
    assert.equal(harness.views.at(-1), EMPTY_VIEW);
  });
});
