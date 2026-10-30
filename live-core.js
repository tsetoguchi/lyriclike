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
  // diff-match-patch's operation codes.
  const DIFF_DELETE = -1;
  const DIFF_EQUAL = 0;
  // The merge's scratch documents. Fixed client ids keep the result the same
  // on every machine.
  const MERGE_FIELD = 'body';
  const MERGE_ONTO_CLIENT = 1;
  const MERGE_CHANGED_CLIENT = 2;
  const MERGE_BASE_CLIENT = 3;
  // Word-level diffs work on each word with the spaces after it, so a word
  // that survives a merge brings its own space and never runs into the next.
  // Spaces at the very start of a text are a unit of their own.
  const WORD_OR_SPACE = /\S+\s*|\s+/g;
  // Each distinct token becomes one code unit. The surrogate block is skipped
  // so no code unit is half a pair.
  const FIRST_TOKEN_CODE = 1;
  const SURROGATE_BLOCK_START = 0xd800;
  const SURROGATE_BLOCK_SIZE = 0x800;
  const LAST_TOKEN_CODE = 0xffff;

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

  // Enter at the end of a line could go before or after its line break and
  // make the same text. Before it, a co-writer typing at that line's end
  // ties with it in Yjs, and their next letters can land on the new line.
  function isEnterBeforeLineBreak(oldValue, edit) {
    return edit.deleteCount === 0 && /^\n+$/.test(edit.insert) && oldValue[edit.index] === '\n';
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
    const edit = {
      index: prefix,
      deleteCount: oldValue.length - prefix - suffix,
      insert: newValue.slice(prefix, newValue.length - suffix),
    };
    if (isEnterBeforeLineBreak(oldValue, edit)) edit.index += 1;
    return edit;
  }

  function applyEdit(ytext, edit, origin) {
    ytext.doc.transact(() => {
      if (edit.deleteCount) ytext.delete(edit.index, edit.deleteCount);
      if (edit.insert) ytext.insert(edit.index, edit.insert);
    }, origin);
  }

  // An insert exactly at the position leaves it in place, unless
  // isPushedByInsert, when it moves past the insert.
  function mapPosition(position, delta, isPushedByInsert) {
    let oldIndex = 0;
    let shift = 0;
    for (const op of delta) {
      if (oldIndex > position || (oldIndex === position && !isPushedByInsert)) break;
      if (op.retain) {
        oldIndex += op.retain;
      } else if (op.insert) {
        shift += op.insert.length;
      } else {
        shift -= Math.min(op.delete, position - oldIndex);
        oldIndex += op.delete;
      }
    }
    return position + shift;
  }

  // A caret moves past a co-writer's words typed right at it: left in front,
  // Enter would split their line and carry their words onto the new one. A
  // selection never grows over them: its start moves past words typed at the
  // start, or typing over the selection would delete the co-writer's words too.
  function mapSelection(selection, delta) {
    const isRange = selection.start !== selection.end;
    return {
      start: mapPosition(selection.start, delta, true),
      end: mapPosition(selection.end, delta, !isRange),
    };
  }

  // Groups diff-match-patch output into runs of kept text and replaced spans.
  // A delete next to an insert is one span.
  function diffRuns(diffs) {
    const runs = [];
    for (const [op, text] of diffs) {
      if (op === DIFF_EQUAL) {
        runs.push({ kept: text });
        continue;
      }
      let span = runs[runs.length - 1];
      if (!span || span.kept !== undefined) {
        span = { deleted: '', inserted: '' };
        runs.push(span);
      }
      if (op === DIFF_DELETE) span.deleted += text;
      else span.inserted += text;
    }
    return runs;
  }

  // diff-match-patch works in code units and can cut an emoji in half. Yjs
  // sends text as UTF-8, where a lone half becomes U+FFFD on every other
  // screen, so the half in the kept text moves into the span beside it.
  function keepPairsWhole(runs) {
    runs.forEach((run, i) => {
      if (!run.kept) return;
      const next = runs[i + 1];
      if (next && isHighSurrogate(run.kept.charCodeAt(run.kept.length - 1))) {
        const half = run.kept.slice(-1);
        run.kept = run.kept.slice(0, -1);
        next.deleted = half + next.deleted;
        next.inserted = half + next.inserted;
      }
      const previous = runs[i - 1];
      if (previous && run.kept && isLowSurrogate(run.kept.charCodeAt(0))) {
        const half = run.kept[0];
        run.kept = run.kept.slice(1);
        previous.deleted += half;
        previous.inserted += half;
      }
    });
    return runs;
  }

  // Each change as its own small edit, never one span from the first change
  // to the last: that span would delete and re-insert a co-writer's words in
  // between, undoing any of their deletes there.
  function minimalEdits(dmp, fromText, toText) {
    const diffs = dmp.diff_main(fromText, toText);
    dmp.diff_cleanupSemantic(diffs);
    return editsFromDiffs(diffs);
  }

  function tokenCode(index) {
    const code = FIRST_TOKEN_CODE + index;
    return code >= SURROGATE_BLOCK_START ? code + SURROGATE_BLOCK_SIZE : code;
  }

  function tokenIndex(code) {
    const isAboveBlock = code >= SURROGATE_BLOCK_START + SURROGATE_BLOCK_SIZE;
    return (isAboveBlock ? code - SURROGATE_BLOCK_SIZE : code) - FIRST_TOKEN_CODE;
  }

  // Each text as one code unit per word or run of spaces, plus the table to
  // turn codes back into text. Null when there are too many distinct tokens
  // to give each its own code unit.
  function encodeTokens(fromText, toText) {
    const codes = new Map();
    const table = [];
    const encode = text => (text.match(WORD_OR_SPACE) || []).map(token => {
      if (!codes.has(token)) {
        codes.set(token, String.fromCharCode(tokenCode(table.length)));
        table.push(token);
      }
      return codes.get(token);
    }).join('');
    const encoded = [encode(fromText), encode(toText)];
    if (tokenCode(table.length) > LAST_TOKEN_CODE) return null;
    const decode = chars => Array.from(chars, c => table[tokenIndex(c.charCodeAt(0))]).join('');
    return { encoded, decode };
  }

  // Like minimalEdits, but a word is kept or replaced whole. A merge needs
  // this: a letter-level diff can take a letter of a co-writer's new word for
  // an old one, and the other side's delete of the old text then cuts it out.
  function wordEdits(dmp, fromText, toText) {
    const tokens = encodeTokens(fromText, toText);
    if (!tokens) return minimalEdits(dmp, fromText, toText);
    const diffs = dmp.diff_main(tokens.encoded[0], tokens.encoded[1], false);
    dmp.diff_cleanupSemantic(diffs);
    return editsFromDiffs(diffs.map(([op, chars]) => [op, tokens.decode(chars)]));
  }

  function editsFromDiffs(diffs) {
    const edits = [];
    let index = 0;
    for (const run of keepPairsWhole(diffRuns(diffs))) {
      if (run.kept !== undefined) {
        index += run.kept.length;
        continue;
      }
      edits.push({ index, deleteCount: run.deleted.length, insert: run.inserted });
      index += run.inserted.length;
    }
    return edits;
  }

  function applyEdits(ytext, edits, origin) {
    ytext.doc.transact(() => {
      for (const edit of edits) {
        if (edit.deleteCount) ytext.delete(edit.index, edit.deleteCount);
        if (edit.insert) ytext.insert(edit.index, edit.insert);
      }
    }, origin);
  }

  // Two copies of base, each given one side's change, merged by Yjs. Yjs can
  // only delete the base letters a side deleted, never letters the other side
  // added, so no co-writer's words can vanish in a merge, and nothing is left
  // over to place. Where both sides wrote at one spot, the co-writer's words
  // (onto) come first: Yjs puts the lower client id first.
  function forkOf(Y, baseUpdate, clientId) {
    const doc = new Y.Doc();
    doc.clientID = clientId;
    Y.applyUpdate(doc, baseUpdate);
    return doc;
  }

  function rebase(Y, dmp, base, changed, onto) {
    const baseDoc = new Y.Doc();
    baseDoc.clientID = MERGE_BASE_CLIENT;
    baseDoc.getText(MERGE_FIELD).insert(0, base);
    const baseUpdate = Y.encodeStateAsUpdate(baseDoc);
    const theirs = forkOf(Y, baseUpdate, MERGE_ONTO_CLIENT);
    const mine = forkOf(Y, baseUpdate, MERGE_CHANGED_CLIENT);
    applyEdits(theirs.getText(MERGE_FIELD), wordEdits(dmp, base, onto), null);
    applyEdits(mine.getText(MERGE_FIELD), wordEdits(dmp, base, changed), null);
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(theirs)));
    return theirs.getText(MERGE_FIELD).toString();
  }

  // PATCH does not move the revision, so the room's last-written title is
  // the only way to tell which rename is newer.
  function mergeTitle(writtenTitle, roomTitle, outsideTitle) {
    return roomTitle === writtenTitle ? outsideTitle : roomTitle;
  }

  function areInsertsSaved(Y, update, stateVector) {
    for (const [client, clock] of Y.parseUpdateMeta(update).to) {
      if ((stateVector.get(client) || 0) < clock) return false;
    }
    return true;
  }

  // Delete sets come back sorted and merged, so a saved range sits inside a
  // single entry.
  function isRangeDeleted(savedItems, range) {
    return (savedItems || []).some(item =>
      item.clock <= range.clock && range.clock + range.len <= item.clock + item.len);
  }

  function areDeletesSaved(Y, update, deleteSet) {
    for (const [client, ranges] of Y.decodeUpdate(update).ds.clients) {
      const savedItems = deleteSet.clients.get(client);
      if (!ranges.every(range => isRangeDeleted(savedItems, range))) return false;
    }
    return true;
  }

  // A state vector counts inserts only, so a delete-only update would look
  // saved at once without the delete set check.
  function isUpdateSaved(Y, update, savedSnapshot) {
    const { sv, ds } = Y.decodeSnapshot(savedSnapshot);
    return areInsertsSaved(Y, update, sv) && areDeletesSaved(Y, update, ds);
  }

  const LiveCore = {
    applyEdit,
    applyEdits,
    diffTextEdit,
    isMidPair,
    isUpdateSaved,
    mapSelection,
    mergeTitle,
    minimalEdits,
    rebase,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = LiveCore;
  } else {
    root.LiveCore = LiveCore;
  }
})(globalThis);
