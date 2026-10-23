// The preview: text shown read-only where the editor is, with the editor's
// syllable counts and rhyme letters. It draws into its own element and never
// touches #lyrics, since on a live page anything in the textarea is sent to
// everyone as typing, and saves and the draft read it too. extensions.js
// checks what it is given before calling show().
(function exposePagePreview(root) {
  'use strict';

  const PREVIEW_ID = 'page-preview';
  const EDITOR_ID = 'lyrics';
  const TITLE_ID = 'lyrics-panel-title';
  const AREA_SELECTOR = '.lyrics-area';
  const MAIN_SELECTOR = '.main';
  const PREVIEWING_CLASS = 'is-previewing';
  const CLOSED_EVENT = 'preview-closed';
  const MARK_CLASSES = { added: 'is-added', removed: 'is-removed' };
  const EMPTY_CLASS = 'empty-line';
  const BLANK_MARK = '·';
  const NO_RHYME_MARK = '–';

  // What the last show() was given, or null while the preview is closed.
  let shown = null;

  function previewElement() {
    return document.getElementById(PREVIEW_ID);
  }

  function isOpen() {
    return shown !== null;
  }

  function setEditorHidden(isHidden) {
    const area = document.querySelector(AREA_SELECTOR);
    const title = document.getElementById(TITLE_ID);
    if (area) area.hidden = isHidden;
    if (title) title.hidden = isHidden;
    const main = document.querySelector(MAIN_SELECTOR);
    if (main) main.classList.toggle(PREVIEWING_CLASS, isHidden);
  }

  // Removed lines stay out of the scheme, so only counted lines are marked,
  // blank ones included so the stanzas split where they would in the editor.
  function marksForLines(lines) {
    const counted = lines.filter((line) => line.isCounted).map((line) => line.text);
    const marks = typeof root.previewMarks === 'function' ? root.previewMarks(counted) : [];
    let next = 0;
    return lines.map((line) => (line.isCounted ? marks[next++] || null : null));
  }

  function buildCell(className, text) {
    const cell = document.createElement('span');
    cell.className = className;
    cell.textContent = text;
    return cell;
  }

  // A blank line keeps the editor's spacer dot, which its styles hide.
  function buildBlankMark(className) {
    const cell = buildCell(className, BLANK_MARK);
    cell.classList.add(EMPTY_CLASS);
    return cell;
  }

  function buildCount(line, mark) {
    if (!mark) return buildCell('preview-count', '');
    if (line.text.trim() === '') return buildBlankMark('preview-count');
    return buildCell('preview-count', mark.syllables > 0 ? String(mark.syllables) : '');
  }

  // As the scheme gutter draws them: the letter in its colour, or a dash in
  // pencil for a line that rhymes with nothing.
  function buildLetter(line, mark) {
    if (!mark || mark.letter === null) return buildCell('preview-letter', '');
    if (line.text.trim() === '') return buildBlankMark('preview-letter');
    const letter = buildCell('preview-letter', mark.letter || NO_RHYME_MARK);
    if (mark.color) letter.style.color = mark.color;
    return letter;
  }

  function buildRow(line, mark) {
    const row = document.createElement('div');
    row.className = 'preview-line';
    if (MARK_CLASSES[line.mark]) row.classList.add(MARK_CLASSES[line.mark]);
    row.append(buildCount(line, mark), buildCell('preview-text', line.text),
      buildLetter(line, mark), buildCell('preview-rest', ''));
    return row;
  }

  function buildTitle(title) {
    const heading = buildCell('preview-title', title);
    heading.setAttribute('role', 'heading');
    heading.setAttribute('aria-level', '2');
    return heading;
  }

  function draw() {
    const { title, lines, bar } = shown;
    const marks = marksForLines(lines);
    const sheet = document.createElement('div');
    sheet.className = 'preview-sheet';
    sheet.append(...lines.map((line, index) => buildRow(line, marks[index])));
    const parts = bar ? [bar, buildTitle(title), sheet] : [buildTitle(title), sheet];
    const preview = previewElement();
    if (preview) preview.replaceChildren(...parts);
  }

  function show(input) {
    const preview = previewElement();
    if (!preview) return false;
    shown = input;
    const editor = document.getElementById(EDITOR_ID);
    if (editor) editor.blur();
    setEditorHidden(true);
    preview.hidden = false;
    draw();
    // Counts and letters need the dictionary; it redraws this once it lands.
    if (typeof root.ensureRhymeData === 'function') root.ensureRhymeData();
    return true;
  }

  // Words that arrived while the editor was hidden were never measured.
  function refreshEditor() {
    if (typeof root.updateGutters === 'function') root.updateGutters();
  }

  function close() {
    if (!isOpen()) return;
    shown = null;
    const preview = previewElement();
    if (preview) {
      preview.replaceChildren();
      preview.hidden = true;
    }
    setEditorHidden(false);
    refreshEditor();
    document.dispatchEvent(new Event(CLOSED_EVENT));
  }

  function redraw() {
    if (isOpen()) draw();
  }

  document.addEventListener('page-changed', close);

  root.PagePreview = { show, close, redraw, isOpen };
})(this);
