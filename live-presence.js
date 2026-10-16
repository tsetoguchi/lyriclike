// Presence in the browser (plans/live-co-editing.md §5.4): who else is on
// the live page and where their carets are. The room stamps each person's
// name and colour onto what a tab sends (collab/src/presence.js), so a tab
// sends only its selection, as Yjs relative positions, which stay on the
// same letter while others type.
(function exposeLivePresence(root) {
  'use strict';

  const TEXT_FIELD = 'body';
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

  function caretsIn(Y, doc, states, ownClientID, me) {
    const carets = [];
    for (const [clientID, state] of othersIn(states, ownClientID, me)) {
      const caret = caretOf(Y, doc, state.cursor);
      if (caret) carets.push({ clientID, ...personOf(state.user), ...caret });
    }
    return carets;
  }

  // The head is where the caret blinks: a selection made backwards has it
  // at the start.
  function encodeCursor(Y, ytext, { start, end, direction }) {
    const isBackward = direction === 'backward';
    const toJSON = index => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, index));
    return { anchor: toJSON(isBackward ? end : start), head: toJSON(isBackward ? start : end) };
  }

  const LivePresence = {
    SEND_EVERY_MS, EMPTY_VIEW,
    colourFor, screenColour, initialsOf, peopleHere, caretsIn, encodeCursor,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = LivePresence;
  } else {
    root.LivePresence = LivePresence;
  }
})(this);
