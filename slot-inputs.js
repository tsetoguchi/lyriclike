// Checks on what an extension passes to the page slots. Each reader returns
// the cleaned input, or null when it refuses, so a bad call becomes a warning
// and a no-op instead of a throw. The browser loads this as a plain script
// and reads window.SlotInputs; Node loads it with require.
(function exposeSlotInputs(root) {
  'use strict';

  const MAX_LABEL_LENGTH = 40;
  const MAX_TITLE_LENGTH = 300;
  const MAX_BODY_LENGTH = 500000;
  const MAX_TAG_LENGTH = 64;
  const MAX_NOTE_LENGTH = 200;
  const LINE_MARKS = ['added', 'removed'];
  const MARK_REMOVED = 'removed';
  const ICON_PREFIX = '<svg';

  function isObject(value) {
    return typeof value === 'object' && value !== null;
  }

  function isTextWithin(value, maxLength) {
    return typeof value === 'string' && value.length <= maxLength;
  }

  function isLabel(value) {
    return isTextWithin(value, MAX_LABEL_LENGTH) && value.trim().length > 0;
  }

  function isIcon(value) {
    return typeof value === 'string' && value.startsWith(ICON_PREFIX);
  }

  function readAction(action) {
    if (!isObject(action)) return null;
    const { label, icon, onClick } = action;
    if (!isLabel(label) || !isIcon(icon) || typeof onClick !== 'function') return null;
    return { label, icon, onClick };
  }

  function readWords(words) {
    if (!isObject(words)) return null;
    const { title, body } = words;
    const tag = words.tag === undefined || words.tag === null ? null : words.tag;
    if (!isTextWithin(title, MAX_TITLE_LENGTH)) return null;
    if (!isTextWithin(body, MAX_BODY_LENGTH)) return null;
    if (tag !== null && !isTextWithin(tag, MAX_TAG_LENGTH)) return null;
    return { title, body, tag };
  }

  // Removed lines are not counted: no syllables, no rhyme letter, and they
  // stay out of the scheme.
  function previewLines(body, lineMarks = null) {
    return body.split('\n').map((text, index) => {
      const mark = lineMarks ? lineMarks[index] : null;
      return { text, mark, isCounted: mark !== MARK_REMOVED };
    });
  }

  function areLineMarksValid(lineMarks, lineCount) {
    if (lineMarks === undefined || lineMarks === null) return true;
    if (!Array.isArray(lineMarks) || lineMarks.length !== lineCount) return false;
    return lineMarks.every((mark) => mark === null || LINE_MARKS.includes(mark));
  }

  function isBarValid(bar) {
    if (bar === undefined || bar === null) return true;
    return typeof Element !== 'undefined' && bar instanceof Element;
  }

  function readPreview(preview) {
    if (!isObject(preview)) return null;
    const words = readWords({ title: preview.title, body: preview.body });
    if (!words) return null;
    const lineCount = words.body.split('\n').length;
    if (!areLineMarksValid(preview.lineMarks, lineCount)) return null;
    if (!isBarValid(preview.bar)) return null;
    return {
      title: words.title,
      lines: previewLines(words.body, preview.lineMarks),
      bar: preview.bar || null,
    };
  }

  // An empty note is valid: it takes the note away.
  function readNote(text) {
    return isTextWithin(text, MAX_NOTE_LENGTH) ? text : null;
  }

  const SlotInputs = {
    readAction,
    readNote,
    readWords,
    readPreview,
    previewLines,
    MAX_LABEL_LENGTH,
    MAX_TITLE_LENGTH,
    MAX_BODY_LENGTH,
    MAX_TAG_LENGTH,
    MAX_NOTE_LENGTH,
    LINE_MARKS,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = SlotInputs;
  } else {
    root.SlotInputs = SlotInputs;
  }
})(this);
