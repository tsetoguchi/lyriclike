// Live co-editing logic shared by the browser (live.js), the room (collab/)
// and the tests. Nothing here touches the page or the network, and Yjs and
// diff-match-patch come in as arguments, so the same file runs on
// window.LiveDeps in the browser and on collab/node_modules in Node.
(function exposeLiveCore(root) {
  'use strict';

  const HIGH_SURROGATE_FIRST = 0xd800;
  const HIGH_SURROGATE_LAST = 0xdbff;
  const LOW_SURROGATE_FIRST = 0xdc00;
  const LOW_SURROGATE_LAST = 0xdfff;

  function isHighSurrogate(code) {
    return code >= HIGH_SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST;
  }

  function isLowSurrogate(code) {
    return code >= LOW_SURROGATE_FIRST && code <= LOW_SURROGATE_LAST;
  }

  // Whether index falls between the two halves of an emoji or another
  // character outside the basic plane.
  function isMidPair(text, index) {
    return index > 0 && index < text.length
      && isHighSurrogate(text.charCodeAt(index - 1))
      && isLowSurrogate(text.charCodeAt(index));
  }

  function commonPrefixLength(a, b, limit) {
    let length = 0;
    while (length < limit && a[length] === b[length]) length += 1;
    return length;
  }

  function commonSuffixLength(a, b, limit) {
    let length = 0;
    while (length < limit && a[a.length - 1 - length] === b[b.length - 1 - length]) length += 1;
    return length;
  }

  // Typed text ends at the caret, so the unchanged start can reach no
  // further than the caret minus what was added. Without this, a letter typed
  // into "hel|lo" would be placed after the run instead of where it was typed.
  function prefixLimit(oldValue, newValue, caret) {
    const shorter = Math.min(oldValue.length, newValue.length);
    if (caret === undefined) return shorter;
    const added = Math.max(0, newValue.length - oldValue.length);
    return Math.min(shorter, Math.max(0, caret - added));
  }

  // The one contiguous change that turns oldValue into newValue, or null.
  // caret is selectionEnd after the edit.
  function diffTextEdit(oldValue, newValue, caret) {
    if (oldValue === newValue) return null;
    let prefix = commonPrefixLength(oldValue, newValue, prefixLimit(oldValue, newValue, caret));
    if (isMidPair(oldValue, prefix) || isMidPair(newValue, prefix)) prefix -= 1;
    const suffixRoom = Math.min(oldValue.length, newValue.length) - prefix;
    let suffix = commonSuffixLength(oldValue, newValue, suffixRoom);
    if (isMidPair(oldValue, oldValue.length - suffix)
      || isMidPair(newValue, newValue.length - suffix)) suffix -= 1;
    return {
      index: prefix,
      deleteCount: oldValue.length - prefix - suffix,
      insert: newValue.slice(prefix, newValue.length - suffix),
    };
  }

  function applyEdit(ytext, edit, origin) {
    ytext.doc.transact(() => {
      if (edit.deleteCount) ytext.delete(edit.index, edit.deleteCount);
      if (edit.insert) ytext.insert(edit.index, edit.insert);
    }, origin);
  }

  const LiveCore = {
    applyEdit,
    diffTextEdit,
    isMidPair,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = LiveCore;
  } else {
    root.LiveCore = LiveCore;
  }
})(this);
