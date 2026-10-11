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
  const DIFF_INSERT = 1;
  const DIFF_EQUAL = 0;
  // Words that could not be placed go at the end of the page, after a blank
  // line, so they are easy to spot and never lost.
  const UNPLACED_SEPARATOR = '\n\n';
  // diff-match-patch's default of 0.5 lets a patch land on loosely similar
  // text, and a delete landing there removes a co-writer's words. A skipped
  // delete loses nothing, so a rebase only applies close matches.
  const REBASE_MATCH_THRESHOLD = 0.25;
  const REBASE_DELETE_THRESHOLD = 0.25;

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

  // An insert exactly at the position leaves it in place, so a co-writer's
  // words appear after the caret rather than pushing it along.
  function mapPosition(position, delta) {
    let oldIndex = 0;
    let shift = 0;
    for (const op of delta) {
      if (oldIndex >= position) break;
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

  function mapSelection(selection, delta) {
    return { start: mapPosition(selection.start, delta), end: mapPosition(selection.end, delta) };
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

  function insertedText(patch) {
    return patch.diffs.filter(([op]) => op === DIFF_INSERT).map(([, text]) => text).join('');
  }

  // The caller's matcher is left as it was given.
  function strictPatchApply(dmp, patches, onto) {
    const { Match_Threshold: matchThreshold, Patch_DeleteThreshold: deleteThreshold } = dmp;
    dmp.Match_Threshold = REBASE_MATCH_THRESHOLD;
    dmp.Patch_DeleteThreshold = REBASE_DELETE_THRESHOLD;
    try {
      return dmp.patch_apply(patches, onto);
    } finally {
      dmp.Match_Threshold = matchThreshold;
      dmp.Patch_DeleteThreshold = deleteThreshold;
    }
  }

  function rebase(dmp, base, changed, onto) {
    const patches = dmp.patch_make(base, changed);
    const [patched, applied] = strictPatchApply(dmp, patches, onto);
    // A failed delete loses nothing, so only failed inserts are kept.
    const unplaced = patches.filter((patch, i) => !applied[i]).map(insertedText).filter(Boolean);
    if (!unplaced.length) return { text: patched, unplaced };
    const text = [patched, ...unplaced].join(UNPLACED_SEPARATOR);
    return { text, unplaced };
  }

  // PATCH does not move the revision, so the room's last-written title is
  // the only way to tell which rename is newer.
  function mergeTitle(writtenTitle, roomTitle, outsideTitle) {
    return roomTitle === writtenTitle ? outsideTitle : roomTitle;
  }

  const LiveCore = {
    applyEdit,
    applyEdits,
    diffTextEdit,
    isMidPair,
    mapSelection,
    mergeTitle,
    minimalEdits,
    rebase,
    UNPLACED_SEPARATOR,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = LiveCore;
  } else {
    root.LiveCore = LiveCore;
  }
})(this);
