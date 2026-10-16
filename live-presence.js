// Presence in the browser (plans/live-co-editing.md §5.4): who else is on
// the live page and where their carets are. The room stamps each person's
// name and colour onto what a tab sends (collab/src/presence.js), so a tab
// sends only its selection, as Yjs relative positions, which stay on the
// same letter while others type.
(function exposeLivePresence(root) {
  'use strict';

  const TEXT_FIELD = 'body';
  const ROOM_ORIGIN = 'room';
  // With typing's 5 messages a second and the keepalive, a tab stays well
  // under the room's limit of 20.
  const SEND_EVERY_MS = 300;
  const HUE_COUNT = 360;
  const HASH_MULTIPLIER = 31;
  // The room's colours suit light paper; the card is dark, so the same hue
  // is drawn lighter.
  const SCREEN_SATURATION = '70%';
  const SCREEN_LIGHTNESS = '68%';
  const HUE_PATTERN = /^hsl\((\d+)\s/;
  const WORD_BREAKS = /[\s._-]+/;
  const NO_NAME_INITIAL = '?';
  const EMPTY_VIEW = Object.freeze({ people: Object.freeze([]), carets: Object.freeze([]) });

  // The room's colourFor (collab/src/presence.js), so a tab knows its own
  // colour and can leave its own other tabs out. A test keeps them equal.
  function colourFor(userId) {
    let hash = 0;
    for (const char of String(userId)) hash = (hash * HASH_MULTIPLIER + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % HUE_COUNT} 65% 42%)`;
  }

  function screenColour(colour) {
    const match = HUE_PATTERN.exec(String(colour));
    return match ? `hsl(${match[1]} ${SCREEN_SATURATION} ${SCREEN_LIGHTNESS})` : String(colour);
  }

  // Array.from splits by code point, so an emoji or a CJK letter stays whole.
  function firstLetter(word) {
    return Array.from(word)[0] || '';
  }

  // "Ann Lee" is AL. A person with no name shows as their email, whose
  // part before the @ gives the letters.
  function initialsOf(name) {
    const text = String(name || '').trim();
    const isEmail = text.includes('@') && !/\s/.test(text);
    const words = (isEmail ? text.split('@')[0] : text).split(WORD_BREAKS).filter(Boolean);
    if (!words.length) return NO_NAME_INITIAL;
    const picked = words.length === 1 ? words : [words[0], words[words.length - 1]];
    return picked.map(firstLetter).join('').toLocaleUpperCase();
  }

  // Name and colour together: two people rarely share both.
  function personKey(user) {
    return `${user.name}\n${user.colour}`;
  }

  // This person as the room stamps them: their name, or email with no name.
  function ownKey(me) {
    if (!me || me.id === undefined || me.id === null) return null;
    return personKey({ name: me.name || me.email, colour: colourFor(me.id) });
  }

  function personOf(user) {
    const name = String(user.name);
    return { key: personKey(user), name, initials: initialsOf(name), colour: screenColour(user.colour) };
  }

  // Everyone else: not this tab, and not this person's other tabs.
  function othersIn(states, ownClientID, me) {
    const myKey = ownKey(me);
    return [...states].filter(([clientID, state]) => clientID !== ownClientID
      && Boolean(state && state.user) && personKey(state.user) !== myKey);
  }

  function peopleHere(states, ownClientID, me) {
    const people = new Map();
    for (const [, state] of othersIn(states, ownClientID, me)) {
      const person = personOf(state.user);
      if (!people.has(person.key)) people.set(person.key, person);
    }
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // A position on words this tab has not received yet resolves to nothing;
  // the caret is drawn once they arrive.
  function absoluteIndex(Y, doc, json) {
    try {
      const relative = Y.createRelativePositionFromJSON(json);
      const position = Y.createAbsolutePositionFromRelativePosition(relative, doc);
      return position && position.type === doc.getText(TEXT_FIELD) ? position.index : null;
    } catch {
      return null;
    }
  }

  function caretOf(Y, doc, cursor) {
    if (!cursor || !cursor.anchor || !cursor.head) return null;
    const anchor = absoluteIndex(Y, doc, cursor.anchor);
    const head = absoluteIndex(Y, doc, cursor.head);
    if (anchor === null || head === null) return null;
    return { start: Math.min(anchor, head), end: Math.max(anchor, head), head };
  }

  // One caret per tab. A connection the room never saw close (a phone that
  // slept) lingers beside the tab's new one; the newer comes later in the map.
  function caretsIn(Y, doc, states, ownClientID, me) {
    const byTab = new Map();
    for (const [clientID, state] of othersIn(states, ownClientID, me)) {
      const tab = state.tab === undefined ? `client:${clientID}` : `tab:${state.tab}`;
      const caret = caretOf(Y, doc, state.cursor);
      byTab.delete(tab);
      if (caret) byTab.set(tab, { clientID, ...personOf(state.user), ...caret });
    }
    return [...byTab.values()];
  }

  // The head is where the caret blinks: a selection made backwards has it
  // at the start.
  function encodeCursor(Y, ytext, { start, end, direction }) {
    const isBackward = direction === 'backward';
    const toJSON = index => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, index));
    return { anchor: toJSON(isBackward ? end : start), head: toJSON(isBackward ? start : end) };
  }

  // One per connection: this tab's awareness, what it sends, and the view
  // of everyone else it hands to the page.
  class PresenceChannel {
    // readSelection gives the editor's selection, or null when this tab
    // has no caret to show (not synced yet, or the editor not focused).
    constructor({ deps, clock, send, me, show, readSelection }) {
      Object.assign(this, { deps, clock, send, me, show, readSelection });
      this.doc = null;
      this.sentJson = null;
      this.lastSentAt = -Infinity;
      this.timer = null;
      // Kept across sockets, so others can tell this tab's new connection
      // from one the room has not yet seen close. It names nobody.
      this.tab = globalThis.crypto.randomUUID();
      this.makeAwareness();
    }

    // A fresh awareness, and so a fresh client id, per socket: when a socket
    // closes the room says its id left, at a clock the old id cannot pass.
    makeAwareness() {
      const { awarenessProtocol, Y } = this.deps;
      this.awarenessDoc = new Y.Doc();
      this.awareness = new awarenessProtocol.Awareness(this.awarenessDoc);
      // Its timer re-sends every 15 s, which would wake the room, and drops
      // anyone quiet for 30 s, which would drop a reader. The room's leave
      // message says who has gone (spec §4.3).
      clearInterval(this.awareness._checkInterval);
      this.awareness.on('change', () => this.refresh());
    }

    attach(doc) {
      this.doc = doc;
      this.refresh();
    }

    receive(update) {
      try {
        this.deps.awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ROOM_ORIGIN);
      } catch {
        // An unreadable presence message costs a caret, not the page.
      }
    }

    view() {
      const states = this.awareness.getStates();
      const ownID = this.awareness.clientID;
      return {
        people: peopleHere(states, ownID, this.me),
        carets: this.doc ? caretsIn(this.deps.Y, this.doc, states, ownID, this.me) : [],
      };
    }

    refresh() {
      this.show(this.view());
    }

    // The selection is read when the message goes, after the binding has
    // put the keystroke into the doc, so the position names the right letter.
    selectionMoved() {
      if (this.timer !== null) return;
      const wait = Math.max(0, this.lastSentAt + SEND_EVERY_MS - this.clock.now());
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.sendIfMoved();
      }, wait);
    }

    currentCursor() {
      const selection = this.doc ? this.readSelection() : null;
      return selection ? encodeCursor(this.deps.Y, this.doc.getText(TEXT_FIELD), selection) : null;
    }

    sendIfMoved() {
      const cursor = this.currentCursor();
      if (!cursor || JSON.stringify(cursor) === this.sentJson) return;
      this.publish(cursor);
    }

    // Sent on every (re)join, caret or not, so others see this person
    // before they click into the page.
    announce() {
      this.clearTimer();
      this.publish(this.currentCursor());
    }

    publish(cursor) {
      const { awarenessProtocol, protocol } = this.deps;
      this.awareness.setLocalState({ cursor, tab: this.tab });
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
      if (!this.send(protocol.encodePresence(update))) return;
      this.sentJson = JSON.stringify(cursor);
      this.lastSentAt = this.clock.now();
    }

    // A hidden tab (a phone locked or switched away) takes its caret down,
    // since its socket may die without the room hearing for a long while.
    hide() {
      this.clearTimer();
      this.publish(null);
    }

    // The socket went. Everyone else is forgotten, since nobody would say
    // who left meanwhile; the room's greeting on the next socket refills it.
    restart() {
      this.clearTimer();
      this.dropAwareness();
      this.sentJson = null;
      this.makeAwareness();
      this.refresh();
    }

    dropAwareness() {
      this.awareness.destroy();
      this.awarenessDoc.destroy();
    }

    clearTimer() {
      if (this.timer === null) return;
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }

    destroy() {
      this.clearTimer();
      this.dropAwareness();
      this.show(EMPTY_VIEW);
    }
  }

  const LivePresence = {
    SEND_EVERY_MS, EMPTY_VIEW,
    colourFor, screenColour, initialsOf, peopleHere, caretsIn, encodeCursor, PresenceChannel,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = LivePresence;
  } else {
    root.LivePresence = LivePresence;
  }
})(this);
