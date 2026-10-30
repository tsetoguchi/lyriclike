// Which rhyme lookups app.js reports, and as what. A tap always counts. The
// rhymes the editor shows by itself for the line above count once per line:
// the caret sits on that fresh line through every space and arrow key, and
// each of those runs the same pick again. Nothing here touches the page, so
// all of it is covered by the tests in test/.
(function exposeRhymeLookupCount(root) {
  'use strict';

  const TRIGGER = { TAP: 'tap', LINE_ABOVE: 'line_above' };
  const NOT_COUNTED = '';

  function lineAboveKey({ isLineAbove, word, start }) {
    return isLineAbove ? word + '@' + start : '';
  }

  // Returns the trigger to send with rhyme_lookup, or '' to send nothing.
  function createLookupCounter() {
    let lastLineAbove = '';
    return function lookupTrigger(pick) {
      const key = lineAboveKey(pick);
      if (pick.isPointerPick) {
        lastLineAbove = key;
        return TRIGGER.TAP;
      }
      if (!key || key === lastLineAbove) return NOT_COUNTED;
      lastLineAbove = key;
      return TRIGGER.LINE_ABOVE;
    };
  }

  const RhymeLookupCount = { createLookupCounter };

  if (typeof module === 'object' && module.exports) {
    module.exports = RhymeLookupCount;
  } else {
    root.RhymeLookupCount = RhymeLookupCount;
  }
})(this);
