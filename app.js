// ── Constants ──
const DEBOUNCE_DELAY_MS = 150;
const POLL_INTERVAL_MS = 300;
const PASTE_DELAY_MS = 0;
const MIN_WORD_LENGTH = 2;
const MAX_RESULTS_PER_GROUP = 500;
const MAX_GUTTER_LINES = 2000;
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 1400;
const SCROLL_THROTTLE_MS = 16;
const RHYME_DATA_LOADING_MESSAGE = 'Loading dictionary...';
const RHYME_DATA_ERROR_MESSAGE = 'Failed to load dictionary';
const RHYMES_PENDING_MESSAGE = 'Loading rhymes...';

const RHYME_TYPES = RhymeCore.RHYME_TYPES;

// ── State ──
// Null until cmudict.json has loaded, which is how the code below tells
// whether rhyme data is available yet.
let rhymeIndex = null;
let englishWords = null;
// Word -> position in english-words.json, which is ordered commonest first.
// Null until that list lands; rhyme ranking falls back to word length.
let wordRanks = null;
// English-only filtering is always on. Its button was removed from the UI,
// so this is state rather than a constant only because setEnglishOnly()
// keeps it reachable for a settings page.
let englishOnly = true;
let syllablesVisible = sessionStorage.getItem('syllablesVisible') === '1';
let rhymeSchemeVisible = sessionStorage.getItem('rhymeSchemeVisible') === '1';
let internalRhymesVisible = sessionStorage.getItem('internalRhymesVisible') === '1';
let blocklist = null;
let debounceTimer = null;
let lastTextValue = '';
let lastMeasuredWidth = 0;

// ── DOM references ──
const textareaEl = document.getElementById('lyrics');
const gutterEl = document.getElementById('syllable-gutter');
const toggleBtn = document.getElementById('syllable-toggle');
const statusEl = document.getElementById('status');
const selectedWordEl = document.getElementById('selected-word');
const resultsEl = document.getElementById('rhyme-results');
const resizeHandleEl = document.getElementById('resize-handle');
const rhymesPanelEl = document.getElementById('rhymes-panel');
const highlightEl = document.getElementById('lyrics-highlight');
const mobileTabsEl = document.getElementById('mobile-tabs');
const mainEl = document.querySelector('.main');
const selectedContextEl = document.getElementById('selected-context');
const wordBarEl = document.querySelector('.selected-word-bar');
const rhymeSchemeGutterEl = document.getElementById('rhyme-scheme-gutter');
const rhymeSchemeToggleEl = document.getElementById('rhyme-scheme-toggle');
const internalRhymeToggleEl = document.getElementById('internal-rhyme-toggle');
const lyricsAreaEl = document.querySelector('.lyrics-area');
const tabRhymeWordEl = document.getElementById('tab-rhyme-word');
const bottomNavEl = document.getElementById('bottom-nav');
const notebookBtn = document.getElementById('notebook-btn');
const createBtn = document.getElementById('create-btn');
const headerEl = document.querySelector('header');
const headerRightEl = document.querySelector('.header-right');
const userAreaEl = document.getElementById('user-area');

// ── Restore session state ──
if (syllablesVisible) {
  toggleBtn.classList.add('active');
  gutterEl.classList.add('visible');
}
if (rhymeSchemeVisible) {
  rhymeSchemeToggleEl.classList.add('active');
  rhymeSchemeGutterEl.classList.add('visible');
}
if (internalRhymesVisible) {
  internalRhymeToggleEl.classList.add('active');
}

// ── Dictionary loading ──

// cmudict.json is several megabytes, so it is fetched on the first sign that a
// writer wants rhymes rather than at startup. Every reader of `rhymeIndex`
// already tolerates a null, and onRhymeDataReady() re-renders what was waiting.
let rhymeDataPromise = null;

function ensureRhymeData() {
  if (rhymeDataPromise) return rhymeDataPromise;

  statusEl.textContent = RHYME_DATA_LOADING_MESSAGE;

  // Lookups made before the list lands come back unfiltered, so redo the last
  // one once it is in. It only refines results, so it never gates them.
  loadEnglishWords().then(refreshCurrentResults).catch(function onEnglishWordsError(err) {
    console.error(err);
  });

  // The blocklist gates rhyme results, so it is required alongside the
  // dictionary rather than after it.
  rhymeDataPromise = Promise.all([loadDictionary(), loadBlocklist()])
    .then(onRhymeDataReady)
    .catch(onRhymeDataError);

  return rhymeDataPromise;
}

function onRhymeDataReady() {
  statusEl.textContent = '';
  updateGutters();
  refreshCurrentResults();
  // Internal marks may have been waiting on the dictionary; the text itself
  // has not changed, so renderHighlight() needs telling it is dirty anyway.
  invalidateInternalRhymeMarks();
  renderHighlight();
}

// Clearing the promise lets the next interaction retry, which matters now that
// loading is triggered by the writer rather than once at startup.
function onRhymeDataError(err) {
  rhymeDataPromise = null;
  statusEl.textContent = RHYME_DATA_ERROR_MESSAGE;
  console.error(err);
}

async function loadDictionary() {
  const resp = await fetch('cmudict.json');
  if (!resp.ok) throw new Error('loadDictionary: failed to fetch cmudict.json');
  rhymeIndex = RhymeCore.buildRhymeIndex(await resp.json());
}

// ── Rhyme search ──

function findRhymes(targetWord) {
  if (typeof targetWord !== 'string') return null;
  // Fail closed: without the blocklist, results would render unfiltered.
  if (!blocklist) return null;
  // Fail closed the same way while the index is still loading.
  if (!rhymeIndex) return null;
  const filters = {
    englishWords: englishOnly ? englishWords : null,
    blocklist: blocklist,
    wordRanks: wordRanks
  };
  return RhymeCore.findRhymes(rhymeIndex, RhymeCore.normalizeWord(targetWord), filters);
}

// ── Results rendering ──

function buildGroupBodyHtml(key, words) {
  if (words.length === 0) return '<span class="no-rhymes">No rhymes found</span>';

  const visible = words.slice(0, MAX_RESULTS_PER_GROUP);
  let html = visible.map(word => `<span class="rhyme-word color-${key}">${word}</span>`).join('');

  if (words.length > MAX_RESULTS_PER_GROUP) {
    const remaining = words.length - MAX_RESULTS_PER_GROUP;
    html += `<button class="show-more-btn" data-type="${key}" data-page="1" data-total="${words.length}">Show more (${remaining} remaining)</button>`;
  }
  return html;
}

// Groups render as headers only. Filling every body up front put thousands of
// chips in the panel — five of the six groups invisible behind a collapsed
// header — which is what made the panel paint its way down the screen on open.
// A body is filled the first time its group is opened; see populateGroupBody().
function buildGroupHtml(key, name, desc, words) {
  console.assert(typeof key === 'string', 'buildGroupHtml: key must be a string');
  console.assert(typeof name === 'string', 'buildGroupHtml: name must be a string');
  console.assert(Array.isArray(words), 'buildGroupHtml: words must be an array');

  return `<div class="rhyme-group" data-type="${key}">
    <div class="rhyme-group-header">
      <span class="name">
        <span class="dot dot-${key}"></span>
        ${name}
      </span>
      <span class="header-right">
        <span class="count">${words.length}</span>
        <span class="chevron">&#9654;</span>
      </span>
    </div>
    <div class="description">${desc}</div>
    <div class="rhyme-group-body"></div>
  </div>`;
}

function populateGroupBody(group) {
  if (group.dataset.populated === '1') return;

  const words = currentResults ? currentResults[group.dataset.type] : null;
  const body = group.querySelector('.rhyme-group-body');
  if (!body) return;

  body.innerHTML = buildGroupBodyHtml(group.dataset.type, words || []);
  group.dataset.populated = '1';
}

function renderResults(word, results) {
  if (typeof word !== 'string') return;
  selectedWordEl.textContent = word;
  // The tab names the word it is holding, so the rhymes are visibly one tap
  // away without anything switching underneath the writer.
  tabRhymeWordEl.textContent = word;
  currentResults = results;

  if (!results) {
    resultsEl.innerHTML = '<div class="empty-state">Word not found in dictionary</div>';
    return;
  }

  let html = '';
  for (let i = 0; i < RHYME_TYPES.length; i++) {
    const { key, name, desc } = RHYME_TYPES[i];
    const words = results[key];
    html += buildGroupHtml(key, name, desc, words);
  }

  resultsEl.innerHTML = html || '<div class="empty-state">No rhymes found</div>';
}

// ── Word highlight overlay ──

let currentHighlightWord = '';
let pickedBounds = null;
let highlightedText = '';
let currentResults = null;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(text) {
  console.assert(typeof text === 'string', 'escapeHtml: text must be a string');
  if (typeof text !== 'string') return '';
  return text.replace(/[&<>"]/g, function replaceChar(char) {
    return HTML_ESCAPES[char];
  });
}

// Only the clicked occurrence of the word is coloured, so its place in the
// text is kept as well as the word. Picking toggles classes rather than
// redrawing, so no word's colour transition is cut off.
function pickHighlightWord(word, bounds, isPointerPick) {
  console.assert(typeof word === 'string', 'pickHighlightWord: word must be a string');
  if (typeof word !== 'string') return;
  renderHighlight();
  currentHighlightWord = RhymeCore.normalizeWord(word);
  const isWholeWord = bounds !== null &&
    isWholeWordAt(highlightedText, bounds, currentHighlightWord);
  pickedBounds = isWholeWord ? bounds : null;
  markPickedWord();
  // Amber means "this word"; focus means "this sound" — a keyboard pick (the
  // caret moving while typing) must never trigger it, or the layer would wash
  // to faint ink on almost every keystroke-pause. See updateRhymeFocus().
  if (isPointerPick) updateRhymeFocus();
}

// { family, stanza } of the traced family, or null. Kept apart from the DOM
// because renderHighlight() rebuilds every span on each edit.
let focusedMark = null;

// Picking a word with no family clears the focus, so clicking plain text is
// how the writer gets back to the resting layer.
function updateRhymeFocus() {
  const selector = pickedBounds ? '.lyric-word[data-start="' + pickedBounds.start + '"]' : null;
  const picked = selector ? highlightEl.querySelector(selector) : null;
  focusedMark = picked ? readMarkFocus(picked) : null;
  applyRhymeFocus();
}

// Colour slots are numbered per stanza, so the stanza is matched too — slot 0
// in the verse is an unrelated sound from slot 0 in the chorus.
function applyRhymeFocus() {
  for (const el of highlightEl.querySelectorAll('.is-focus-mark')) {
    el.classList.remove('is-focus-mark');
  }
  if (!focusedMark) {
    delete highlightEl.dataset.focus;
    return;
  }
  highlightEl.dataset.focus = '';
  const selector = '.mark-' + focusedMark.family + '[data-stanza="' + focusedMark.stanza + '"]';
  for (const el of highlightEl.querySelectorAll(selector)) el.classList.add('is-focus-mark');
}

function readMarkFocus(wordEl) {
  const family = readMarkColorSlot(wordEl);
  return family === null ? null : { family, stanza: wordEl.dataset.stanza };
}

// Reads the colour slot straight off the span's own class rather than
// recomputing marks a second time. Overflow marks have no slot of their own
// to focus toward — every overflow word shares one class — so picking one
// behaves like picking a word with no family.
function readMarkColorSlot(wordEl) {
  for (const className of wordEl.classList) {
    const match = /^mark-(\d+)$/.exec(className);
    if (match) return match[1];
  }
  return null;
}

function pickedBoundsForSelection(text, start, end) {
  let position = start;
  while (position < end && !WORD_CHAR.test(text[position])) position++;
  return wordBoundsAt(text, position);
}

function wordBoundsAt(text, offset) {
  let start = offset;
  let end = offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  if (end - start < MIN_WORD_LENGTH) return null;
  return { start: start, end: end };
}

// Set whenever the marks need recomputing without the text itself having
// changed — the toggle flipping, or the dictionary landing while it was on.
let internalRhymeMarksDirty = false;

function invalidateInternalRhymeMarks() {
  internalRhymeMarksDirty = true;
}

// The textarea's own letters are transparent, so this layer draws every one of
// them. It is rebuilt only when the text changes (or the marks need it);
// hovering and picking toggle classes on the word elements it holds.
function renderHighlight() {
  const text = textareaEl.value;
  if (text === highlightedText && highlightEl.firstChild && !internalRhymeMarksDirty) return;
  internalRhymeMarksDirty = false;
  followTextEdit(text);
  highlightEl.innerHTML = wordsToHtml(text, buildInternalRhymeMarkMap(text)) + '\n';
  hoveredWordEl = null;
  markPickedWord();
  applyRhymeFocus();
}

// Each word long enough to rhyme becomes its own element, found again by the
// offset it starts at. `marks`, when given, maps that same offset to the
// { family, stanza } internal-rhyme underlines should draw it in.
function wordsToHtml(text, marks) {
  const pattern = new RegExp(WORD_CHAR.source + '+', 'g');
  let html = '';
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[0].length >= MIN_WORD_LENGTH) {
      const word = escapeHtml(match[0]);
      html += escapeHtml(text.slice(lastIndex, match.index));
      const mark = marks ? marks.get(match.index) : undefined;
      const markClass = mark === undefined ? '' : markClassFor(mark.family);
      const stanzaAttr = mark === undefined ? '' : ' data-stanza="' + mark.stanza + '"';
      html += '<span class="lyric-word' + markClass + '"' + stanzaAttr +
        ' data-start="' + match.index + '">' + word + '</span>';
      lastIndex = match.index + match[0].length;
    }
    match = pattern.exec(text);
  }
  return html + escapeHtml(text.slice(lastIndex));
}

// A class, not an inline style="--mark: …" — colour values live in
// styles.css :root, so the theme owns them (app.js:596 already states this
// rule for the gutter's SCHEME_COLORS).
function markClassFor(family) {
  if (family === RhymeCore.OVERFLOW_FAMILY) return ' rhyme-mark mark-overflow';
  return ' rhyme-mark mark-' + (family % SCHEME_COLORS.length);
}

function markPickedWord() {
  const previous = highlightEl.querySelector('.highlight-word');
  if (previous) previous.classList.remove('highlight-word');
  if (!pickedBounds) return;
  const selector = '.lyric-word[data-start="' + pickedBounds.start + '"]';
  const picked = highlightEl.querySelector(selector);
  if (picked) picked.classList.add('highlight-word');
}

// Moves the picked word along with any edit before it. An edit that reaches
// the word itself unpicks it.
function followTextEdit(text) {
  const shifted = shiftBoundsForEdit(pickedBounds, highlightedText, text);
  const isStillPicked = shifted !== null &&
    isWholeWordAt(text, shifted, currentHighlightWord);
  pickedBounds = isStillPicked ? shifted : null;
  highlightedText = text;
}

// Finds the single stretch of text that changed by trimming what the old and
// new text share at each end.
function shiftBoundsForEdit(bounds, oldText, newText) {
  if (!bounds || oldText === newText) return bounds;
  const prefix = commonPrefixLength(oldText, newText);
  const suffix = commonSuffixLength(oldText, newText, prefix);
  if (bounds.end <= prefix) return bounds;
  if (bounds.start < oldText.length - suffix) return null;
  const delta = newText.length - oldText.length;
  return { start: bounds.start + delta, end: bounds.end + delta };
}

function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a[length] === b[length]) length++;
  return length;
}

function commonSuffixLength(a, b, prefix) {
  const limit = Math.min(a.length, b.length) - prefix;
  let length = 0;
  while (length < limit && a[a.length - 1 - length] === b[b.length - 1 - length]) {
    length++;
  }
  return length;
}

function isWholeWordAt(text, bounds, word) {
  if (!word || bounds.end > text.length) return false;
  const isBoundedBefore = bounds.start === 0 || !WORD_CHAR.test(text[bounds.start - 1]);
  const isBoundedAfter = bounds.end === text.length || !WORD_CHAR.test(text[bounds.end]);
  const isSameWord = RhymeCore.normalizeWord(text.slice(bounds.start, bounds.end)) === word;
  return isBoundedBefore && isBoundedAfter && isSameWord;
}

// ── Word hover (desktop) ──

const HOVER_QUERY = window.matchMedia('(hover: hover) and (pointer: fine)');
// ’ included so "you’re" is one word, as in rhyme-core.js.
const WORD_CHAR = /[a-zA-Z'‘’]/;

let hoveredWordEl = null;
let hoverFrame = 0;

function canHoverWords() {
  return HOVER_QUERY.matches && !isMobileView();
}

// The textarea sits on top and answers every hit test, so it steps aside for
// one synchronous query while the layer beneath, laid out identically, says
// which word is under the pointer.
function wordElAtPoint(x, y) {
  textareaEl.style.pointerEvents = 'none';
  highlightEl.style.pointerEvents = 'auto';
  const hit = document.elementFromPoint(x, y);
  textareaEl.style.pointerEvents = '';
  highlightEl.style.pointerEvents = '';
  const isWord = hit !== null && hit.classList.contains('lyric-word') &&
    highlightEl.contains(hit);
  return isWord ? hit : null;
}

// Only classes change, so the word left behind keeps fading out on its own
// while the next one fades in.
function setHoveredWord(wordEl) {
  if (wordEl === hoveredWordEl) return;
  if (hoveredWordEl) hoveredWordEl.classList.remove('is-hovered');
  hoveredWordEl = wordEl;
  if (wordEl) wordEl.classList.add('is-hovered');
}

function clearHoveredWord() {
  cancelAnimationFrame(hoverFrame);
  setHoveredWord(null);
}

// Pointer moves arrive faster than frames; only the latest position in each
// frame is looked up.
function handleEditorPointerMove(event) {
  if (!canHoverWords() || event.buttons !== 0) {
    clearHoveredWord();
    return;
  }
  const x = event.clientX;
  const y = event.clientY;
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(function lookUpHoveredWord() {
    setHoveredWord(wordElAtPoint(x, y));
  });
}

// ── Word selection handling ──

function extractWordAtCursor(text, start, end) {
  console.assert(typeof text === 'string', 'extractWordAtCursor: text must be a string');
  console.assert(typeof start === 'number' && typeof end === 'number', 'extractWordAtCursor: start/end must be numbers');
  if (typeof text !== 'string') return '';
  if (start !== end) {
    return text.substring(start, end).trim();
  }
  const before = text.slice(0, start).match(new RegExp(WORD_CHAR.source + '+$'));
  const after = text.slice(start).match(new RegExp('^' + WORD_CHAR.source + '+'));
  const prefix = before ? before[0] : '';
  const suffix = after ? after[0] : '';
  return prefix + suffix;
}

function getWordContext(text, cursorPos) {
  var lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
  var lineEnd = text.indexOf('\n', cursorPos);
  if (lineEnd === -1) lineEnd = text.length;
  return text.substring(lineStart, lineEnd).trim();
}

function flashWordBar() {
  wordBarEl.classList.remove('flash');
  void wordBarEl.offsetWidth;
  wordBarEl.classList.add('flash');
}

// The panel holds the word while the dictionary is still in flight, so a tap
// is never silently dropped; onRhymeDataReady() fills the rhymes in after.
function showPendingRhymes(word) {
  selectedWordEl.textContent = word;
  tabRhymeWordEl.textContent = word;
  resultsEl.innerHTML = '<div class="empty-state">' + RHYMES_PENDING_MESSAGE + '</div>';
}

// pickHighlightWord() has no way to know what triggered it once this is
// debounced, so the event type is read now, synchronously, and carried
// through the closure to where the pick actually happens.
function handleSelection(event) {
  const isPointerPick = event.type === 'mouseup' || event.type === 'touchend';
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function processSelection() {
    const text = textareaEl.value;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;

    let word = extractWordAtCursor(text, start, end);
    if (/\s/.test(word)) return;
    word = word.replace(/[^a-zA-Z'‘’]/g, '');
    if (word.length < MIN_WORD_LENGTH) return;

    pickHighlightWord(word, pickedBoundsForSelection(text, start, end), isPointerPick);
    selectedContextEl.textContent = getWordContext(text, start);
    flashWordBar();

    // Reaching for a word is the clearest signal that the rhymes are wanted.
    if (!rhymeIndex) {
      showPendingRhymes(word);
      ensureRhymeData();
      return;
    }

    renderResults(word, findRhymes(word));
  }, DEBOUNCE_DELAY_MS);
}

// ── Syllable counting ──

function buildSyllableLine(line, height) {
  const trimmed = line.trim();
  // Hidden counts still need spacer divs: every row below one of them sits
  // where the rows above have put it.
  if (!syllablesVisible || trimmed === '') {
    return '<div class="syl-line empty-line" style="height:' + height + 'px">&middot;</div>';
  }
  const count = RhymeCore.countSyllablesForLine(rhymeIndex, trimmed);
  return '<div class="syl-line" style="height:' + height + 'px">' + (count > 0 ? count : '&nbsp;') + '</div>';
}

function updateSyllableGutter() {
  const lines = textareaEl.value.split('\n');
  const lineCount = Math.min(lines.length, MAX_GUTTER_LINES);
  const heights = measureLineHeights(lines.slice(0, lineCount));
  const parts = [];
  for (let i = 0; i < lineCount; i++) {
    parts.push(buildSyllableLine(lines[i], heights[i]));
  }
  gutterEl.innerHTML = '<div class="gutter-inner">' + parts.join('') + '</div>';
}

const lineMeasureEl = document.getElementById('line-measure');

let cachedLineHeights = null;
let cachedLineHeightsText = null;
let cachedLineHeightsWidth = null;

function measureLineHeights(lines) {
  console.assert(Array.isArray(lines), 'measureLineHeights: lines must be an array');
  const currentWidth = textareaEl.clientWidth;
  const textKey = lines.join('\n');
  if (cachedLineHeights && cachedLineHeightsText === textKey && cachedLineHeightsWidth === currentWidth) {
    return cachedLineHeights;
  }
  lineMeasureEl.style.width = currentWidth + 'px';
  // Render all lines at once with span markers to avoid rounding drift. A
  // trailing marker closes the last line: measuring it against scrollHeight
  // instead reports a short final row, because scrollHeight stops at the
  // text rather than at the end of its line box.
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    html += '<span data-ln="' + i + '">\u200b</span>';
    html += (escapeHtml(lines[i]) || '\u200b') + '\n';
  }
  html += '<span data-ln="end">\u200b</span>';
  lineMeasureEl.innerHTML = html;
  const markers = lineMeasureEl.querySelectorAll('span[data-ln]');
  const heights = [];
  for (let j = 0; j < markers.length - 1; j++) {
    heights.push(markers[j + 1].offsetTop - markers[j].offsetTop);
  }
  lineMeasureEl.innerHTML = '';
  cachedLineHeights = heights;
  cachedLineHeightsText = textKey;
  cachedLineHeightsWidth = currentWidth;
  return heights;
}

// The editor area is the only thing that scrolls, so the gutters and the
// highlight overlay move with the text by construction. Sizing the textarea to
// its content is what keeps it that way: it must never scroll on its own.
function resizeEditorToContent() {
  // A hidden panel measures zero, which would collapse the editor.
  if (textareaEl.offsetParent === null) return;

  // Reading the content height means collapsing the textarea to it first, and
  // that collapses the scroll container around it too: the page briefly gets
  // shorter than its own scroll offset, so the browser clamps the offset to
  // the new bottom. Chrome remembers where the offset was meant to be and puts
  // it back once the height returns; Safari keeps the clamped value, then
  // scrolls the caret back into view — which is the view jumping a line on
  // every letter typed at the bottom of a lyric. Hold the offset ourselves so
  // it does not depend on which browser is asked.
  const scrollTop = lyricsAreaEl.scrollTop;

  textareaEl.style.height = 'auto';
  const contentHeight = textareaEl.scrollHeight;
  // A short lyric still has to fill the pad, or the writing surface stops
  // mid-page while the gutters beside it run on. The floor is measured
  // rather than declared: a percentage min-height resolves against the
  // wrapper, whose own height is content-driven, so it never applies.
  textareaEl.style.height = Math.max(contentHeight, lyricsAreaEl.clientHeight) + 'px';

  lyricsAreaEl.scrollTop = scrollTop;
}

// Where the caret's line sits inside the editor, measured from the top of the
// scrolling content. Reuses the same per-line heights the gutters are drawn
// from, so the line this scrolls to is the line the marks are beside.
function caretLineBounds() {
  const lines = textareaEl.value.split('\n');
  const caretLine = textareaEl.value.slice(0, textareaEl.selectionStart).split('\n').length - 1;
  const heights = measureLineHeights(lines);

  let top = parseFloat(getComputedStyle(textareaEl).paddingTop) || 0;
  for (let i = 0; i < caretLine && i < heights.length; i++) {
    top += heights[i];
  }
  return { top: top, bottom: top + (heights[caretLine] || 0) };
}

// How much of the editor's floor the tool bar is standing on. It floats over
// the writing rather than beside it, so a line scrolled to the very bottom of
// the editor is still hidden.
function bottomNavObstruction() {
  const isHidden = bottomNavEl.classList.contains('ducked') ||
    bottomNavEl.classList.contains('off-screen');
  return isHidden ? 0 : bottomNavEl.offsetHeight;
}

// The keyboard takes half the screen, and the line the writer just tapped can
// be left under it — or under the tool bar sitting at the bottom of what is
// left. Neither the browser nor the bar knows about the other, so put the
// caret's line back on screen once the space it has to fit in is known.
function revealCaretLine() {
  if (!isMobileView()) return;
  if (document.activeElement !== textareaEl) return;
  if (!canMeasureEditor()) return;

  const line = caretLineBounds();
  const obstruction = bottomNavObstruction();
  const viewTop = lyricsAreaEl.scrollTop;
  const viewBottom = viewTop + lyricsAreaEl.clientHeight - obstruction;

  if (line.bottom > viewBottom) {
    lyricsAreaEl.scrollTop = line.bottom - lyricsAreaEl.clientHeight + obstruction;
  } else if (line.top < viewTop) {
    lyricsAreaEl.scrollTop = line.top;
  }
}

// ── Rhyme scheme detection ──

// Values live in styles.css :root so the theme owns all color decisions.
const SCHEME_COLORS = [
  'var(--scheme-0)', 'var(--scheme-1)', 'var(--scheme-2)', 'var(--scheme-3)',
  'var(--scheme-4)', 'var(--scheme-5)', 'var(--scheme-6)', 'var(--scheme-7)',
  'var(--scheme-8)', 'var(--scheme-9)'
];

function splitIntoStanzas(allLines, lineCount) {
  const stanzas = [];
  const stanzaStartIndices = [];
  let currentStanza = [];
  let currentStart = 0;

  for (let i = 0; i < lineCount; i++) {
    if (allLines[i].trim() === '') {
      if (currentStanza.length > 0) {
        stanzas.push(currentStanza);
        stanzaStartIndices.push(currentStart);
        currentStanza = [];
      }
    } else {
      if (currentStanza.length === 0) currentStart = i;
      currentStanza.push(allLines[i]);
    }
  }
  if (currentStanza.length > 0) {
    stanzas.push(currentStanza);
    stanzaStartIndices.push(currentStart);
  }

  return { stanzas, stanzaStartIndices };
}

function updateRhymeSchemeGutter() {
  if (!rhymeSchemeVisible) return;
  // Dictionary may still be loading; onLoaded() re-renders when it lands.
  if (!rhymeIndex) return;
  console.assert(rhymeSchemeGutterEl !== null, 'updateRhymeSchemeGutter: gutter element must exist');
  const text = textareaEl.value;
  const allLines = text.split('\n');
  const lineCount = Math.min(allLines.length, MAX_GUTTER_LINES);

  const { stanzas, stanzaStartIndices } = splitIntoStanzas(allLines, lineCount);

  const labels = new Array(lineCount).fill('');
  const labelColors = new Array(lineCount).fill('');

  for (let stanzaIdx = 0; stanzaIdx < stanzas.length; stanzaIdx++) {
    const stanza = stanzas[stanzaIdx];
    const scheme = RhymeCore.computeRhymeScheme(rhymeIndex, stanza);
    const startIdx = stanzaStartIndices[stanzaIdx];

    let stanzaLineIdx = 0;
    for (let lineIdx = startIdx; lineIdx < lineCount && stanzaLineIdx < stanza.length; lineIdx++) {
      if (allLines[lineIdx].trim() !== '') {
        labels[lineIdx] = scheme[stanzaLineIdx];
        if (scheme[stanzaLineIdx]) {
          const labelIndex = scheme[stanzaLineIdx].charCodeAt(0) - 65;
          labelColors[lineIdx] = SCHEME_COLORS[labelIndex % SCHEME_COLORS.length];
        }
        stanzaLineIdx++;
      }
    }
  }

  const heights = measureLineHeights(allLines.slice(0, lineCount));
  const parts = [];
  for (let i = 0; i < lineCount; i++) {
    const lineHeight = heights[i];
    if (allLines[i].trim() === '') {
      parts.push('<div class="scheme-line empty-line" style="height:' + lineHeight + 'px">&middot;</div>');
    } else {
      parts.push('<div class="scheme-line" style="height:' + lineHeight + 'px;color:' + (labelColors[i] || 'var(--ink-faded)') + '">' + (labels[i] || '&ndash;') + '</div>');
    }
  }
  rhymeSchemeGutterEl.innerHTML = '<div class="gutter-inner">' + parts.join('') + '</div>';
}

// The character offset each line starts at within the whole text, so a mark
// expressed in a stanza's line-local offsets (what groupRhymeMarks() returns)
// can be placed against the same global offsets wordsToHtml() keys its spans
// by.
function lineStartOffsets(allLines) {
  const offsets = [];
  let offset = 0;
  for (const line of allLines) {
    offsets.push(offset);
    offset += line.length + 1; // account for the '\n' split() dropped
  }
  return offsets;
}

// Map<globalOffset, { family, stanza }> for every internal-rhyme mark in the text,
// or null when there is nothing to draw. Computed per stanza, like the
// scheme gutter, since groupRhymeMarks() only ever sees one stanza at a time.
function buildInternalRhymeMarkMap(text) {
  if (!internalRhymesVisible || !rhymeIndex || isMobileView()) return null;
  const allLines = text.split('\n');
  const lineCount = Math.min(allLines.length, MAX_GUTTER_LINES);
  const { stanzas, stanzaStartIndices } = splitIntoStanzas(allLines, lineCount);
  const starts = lineStartOffsets(allLines);

  const map = new Map();
  for (let s = 0; s < stanzas.length; s++) {
    const { marks } = RhymeCore.groupRhymeMarks(rhymeIndex, stanzas[s]);
    const startIdx = stanzaStartIndices[s];
    for (let lineIdx = 0; lineIdx < marks.length; lineIdx++) {
      const lineStart = starts[startIdx + lineIdx];
      for (const mark of marks[lineIdx]) {
        map.set(lineStart + mark.start, { family: mark.family, stanza: s });
      }
    }
  }
  return map;
}

function invalidateLineHeightCache() {
  cachedLineHeights = null;
  cachedLineHeightsText = null;
  cachedLineHeightsWidth = null;
}

function toggleRhymeScheme() {
  rhymeSchemeVisible = !rhymeSchemeVisible;
  sessionStorage.setItem('rhymeSchemeVisible', rhymeSchemeVisible ? '1' : '0');
  rhymeSchemeToggleEl.classList.toggle('active', rhymeSchemeVisible);
  // Showing or hiding either margin changes the editor's width, so the text
  // re-wraps for both of them; openGutter() re-measures both.
  openGutter(rhymeSchemeGutterEl, rhymeSchemeVisible);
}

// A margin opens and closes at once, so the editor's new width is settled by
// the time the class lands. Reading it back measures the lines against the
// width that actually holds.
function openGutter(gutterElement, isVisible) {
  // The rhyme scheme margin cannot be drawn without the dictionary, and the
  // syllable margin only approximates its counts until it arrives.
  if (isVisible) ensureRhymeData();
  gutterElement.classList.toggle('visible', isVisible);
  invalidateLineHeightCache();
  updateGutters();
}

function toggleSyllables() {
  syllablesVisible = !syllablesVisible;
  sessionStorage.setItem('syllablesVisible', syllablesVisible ? '1' : '0');
  toggleBtn.classList.toggle('active', syllablesVisible);
  openGutter(gutterEl, syllablesVisible);
}

// Marks draw inside #lyrics-highlight itself rather than a margin, so there is
// no gutter to open — only the dirty flag that makes renderHighlight() redraw
// with the same text.
function toggleInternalRhymes() {
  internalRhymesVisible = !internalRhymesVisible;
  sessionStorage.setItem('internalRhymesVisible', internalRhymesVisible ? '1' : '0');
  internalRhymeToggleEl.classList.toggle('active', internalRhymesVisible);
  if (internalRhymesVisible) ensureRhymeData();
  invalidateInternalRhymeMarks();
  renderHighlight();
}

// The bottom nav has no room for a fifth column (§8 of the plan), so the
// feature is desktop/tablet only. Called only on an actual transition into
// mobile — see its guard in placeControlsForViewport() — so this never fights
// a click on the toggle at that width; there is none, since CSS hides it.
function disableInternalRhymesForMobile() {
  if (!internalRhymesVisible) return;
  internalRhymesVisible = false;
  sessionStorage.setItem('internalRhymesVisible', '0');
  internalRhymeToggleEl.classList.remove('active');
  invalidateInternalRhymeMarks();
  renderHighlight();
}

// ── Resize handle ──

let isResizing = false;

function handleResizeStart(event) {
  event.preventDefault();
  isResizing = true;
  resizeHandleEl.classList.add('active');
  const bodyStyle = document.body.style;
  bodyStyle.cursor = 'col-resize';
  bodyStyle.userSelect = 'none';
}

function handleResizeMove(event) {
  if (!isResizing) return;
  if (!event) return;
  // The panel's right edge (inside its desk margin) stays fixed during
  // the drag, so it anchors the width math to the pointer exactly.
  const panelRight = rhymesPanelEl.getBoundingClientRect().right;
  const newWidth = panelRight - event.clientX;
  const clampedWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newWidth));
  rhymesPanelEl.style.width = clampedWidth + 'px';
}

function handleResizeEnd() {
  if (!isResizing) return;
  isResizing = false;
  resizeHandleEl.classList.remove('active');
  const bodyStyle = document.body.style;
  bodyStyle.cursor = '';
  bodyStyle.userSelect = '';
  invalidateLineHeightCache();
  updateGutters();
}

// ── English-only filtering ──

function refreshCurrentResults() {
  if (!currentHighlightWord) return;
  // The English word list can land before the dictionary does. Rendering now
  // would replace the pending message with a false "not found"; the rhymes go
  // in when onRhymeDataReady() calls this again with an index to search.
  if (!rhymeIndex) return;
  renderResults(currentHighlightWord, findRhymes(currentHighlightWord));
}

// No control exposes this yet. It stays so a settings page can turn the filter
// off without the filtering itself having to be rebuilt.
function setEnglishOnly(isEnabled) {
  console.assert(typeof isEnabled === 'boolean', 'setEnglishOnly: isEnabled must be a boolean');
  englishOnly = isEnabled;
  refreshCurrentResults();
}

// ── Event binding (no inline handlers) ──

toggleBtn.addEventListener('click', toggleSyllables);
rhymeSchemeToggleEl.addEventListener('click', toggleRhymeScheme);
internalRhymeToggleEl.addEventListener('click', toggleInternalRhymes);
textareaEl.addEventListener('mouseup', handleSelection);
textareaEl.addEventListener('touchend', handleSelection);
textareaEl.addEventListener('keyup', handleSelection);
// An editor with no layout — a hidden panel, a viewport mid-rotation —
// measures every line as nothing, and rows of no height stack every mark on
// the same line. The last good measurement is better than that, so leave it.
function canMeasureEditor() {
  return textareaEl.offsetParent !== null && textareaEl.clientWidth > 0;
}

function updateGutters() {
  if (!canMeasureEditor()) return;
  resizeEditorToContent();
  updateSyllableGutter();
  updateRhymeSchemeGutter();
}

// Only a change of width re-wraps the lines, and the width is only worth
// reading once the editor has one. This is what picks the marks back up after
// a rotation, or after the panel that holds them has been away.
function remeasureIfWidthChanged() {
  if (!canMeasureEditor()) return;
  const width = textareaEl.clientWidth;
  if (width === lastMeasuredWidth) return;
  lastMeasuredWidth = width;
  invalidateLineHeightCache();
  updateGutters();
}
textareaEl.addEventListener('input', function handleInput() {
  // Writing is the other signal that the rhyme data is wanted. It arrives in
  // the background while the writer keeps typing.
  ensureRhymeData();
  updateGutters();
  renderHighlight();
});
textareaEl.addEventListener('mousemove', handleEditorPointerMove);
textareaEl.addEventListener('mouseleave', clearHoveredWord);
lyricsAreaEl.addEventListener('scroll', clearHoveredWord, { passive: true });
// A browser can restore the textarea's text on reload without an input
// event, and nothing would draw those letters until the next edit.
renderHighlight();

// Line heights cached before the editor webfont finishes loading are
// measured with the fallback font; re-measure once fonts settle.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(function remeasureAfterFontLoad() {
    invalidateLineHeightCache();
    updateGutters();
  });
}
lyricsAreaEl.addEventListener('scroll', handleEditorScrollForNav, { passive: true });

resultsEl.addEventListener('click', function handleResultsClick(event) {
  const clicked = event.target;

  // Group toggle
  const header = clicked.closest('.rhyme-group-header');
  if (header) {
    const group = header.parentElement;
    if (!group) return;
    if (!group.classList.contains('open')) populateGroupBody(group);
    group.classList.toggle('open');
    return;
  }

  // Show more pagination
  const showMoreBtn = clicked.closest('.show-more-btn');
  if (showMoreBtn && currentResults) {
    var type = showMoreBtn.dataset.type;
    var page = parseInt(showMoreBtn.dataset.page);
    var allWords = currentResults[type];
    var start = (page) * MAX_RESULTS_PER_GROUP;
    var end = start + MAX_RESULTS_PER_GROUP;
    var nextWords = allWords.slice(start, end);
    var remaining = allWords.length - end;

    var fragment = document.createDocumentFragment();
    for (var w = 0; w < nextWords.length; w++) {
      var span = document.createElement('span');
      span.className = 'rhyme-word color-' + type;
      span.textContent = nextWords[w];
      fragment.appendChild(span);
    }

    var body = showMoreBtn.parentElement;
    body.insertBefore(fragment, showMoreBtn);

    if (remaining > 0) {
      showMoreBtn.dataset.page = page + 1;
      showMoreBtn.textContent = 'Show more (' + remaining + ' remaining)';
    } else {
      showMoreBtn.remove();
    }
    return;
  }

  // Word definition
  const wordEl = clicked.closest('.rhyme-word');
  if (wordEl) {
    showDefinition(wordEl.textContent.trim(), wordEl);
  }
});

// ── Definition popup ──

const DEFINITION_ENDPOINT = '/api/define/';
const DEFINITION_TIMEOUT_MS = 8000;
const DEFINITION_UNAVAILABLE_TEXT = 'Definitions are unavailable right now. Try again in a moment.';
const MAX_DEFINITIONS_SHOWN = 3;
const HTTP_NOT_FOUND = 404;

function closeDefinition() {
  var overlay = document.querySelector('.def-overlay');
  var popup = document.querySelector('.def-popup');
  if (overlay) overlay.remove();
  if (popup) popup.remove();
}

function showDefinition(word, anchorEl) {
  closeDefinition();

  var overlay = document.createElement('div');
  overlay.className = 'def-overlay';
  overlay.addEventListener('click', closeDefinition);
  document.body.appendChild(overlay);

  var popup = document.createElement('div');
  popup.className = 'def-popup';
  popup.innerHTML = '<div class="def-loading">Loading...</div>';
  document.body.appendChild(popup);

  // Position popup (desktop only, mobile uses bottom sheet via CSS)
  if (!isMobileView() && anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var popupWidth = 320;
    var left = rect.left;
    var top = rect.bottom + 8;
    if (left + popupWidth > window.innerWidth - 16) {
      left = window.innerWidth - popupWidth - 16;
    }
    if (top + 280 > window.innerHeight - 16) {
      top = rect.top - 288;
    }
    popup.style.left = Math.max(8, left) + 'px';
    popup.style.top = Math.max(8, top) + 'px';
  }

  fetchDefinition(word)
    .then(function renderIntoPopup(entry) {
      popup.innerHTML = entry
        ? renderDefinition(entry)
        : '<div class="def-error">No definition found for "' + escapeHtml(word) + '"</div>';
    })
    .catch(function showLookupFailure() {
      popup.innerHTML = '<div class="def-error">' + DEFINITION_UNAVAILABLE_TEXT + '</div>';
    });
}

// Resolves to a definition entry, or null when the word genuinely has no
// entry. Rejects only when the lookup itself failed, so an outage is never
// reported to the user as a missing word.
function fetchDefinition(word) {
  const url = DEFINITION_ENDPOINT + encodeURIComponent(word);
  return fetch(url, { signal: AbortSignal.timeout(DEFINITION_TIMEOUT_MS) })
    .then(function readDefinitionResponse(resp) {
      if (resp.ok) return resp.json();
      if (resp.status === HTTP_NOT_FOUND) return null;
      throw new Error('definition lookup failed with status ' + resp.status);
    });
}

function renderDefinition(entry) {
  var html = '<div class="def-word">' + escapeHtml(entry.word) + '</div>';
  if (entry.phonetic) {
    html += '<div class="def-phonetic">' + escapeHtml(entry.phonetic) + '</div>';
  }

  var meanings = entry.meanings || [];
  var shown = 0;
  for (var i = 0; i < meanings.length && shown < MAX_DEFINITIONS_SHOWN; i++) {
    var rendered = renderMeaning(meanings[i], MAX_DEFINITIONS_SHOWN - shown);
    if (rendered.count === 0) continue;
    html += '<div class="def-pos">' + escapeHtml(meanings[i].partOfSpeech) + '</div>';
    html += rendered.html;
    shown += rendered.count;
  }

  return html;
}

function renderMeaning(meaning, remaining) {
  var definitions = (meaning.definitions || []).slice(0, remaining);
  var html = '';
  for (var i = 0; i < definitions.length; i++) {
    html += '<div class="def-meaning">' + escapeHtml(definitions[i].definition) + '</div>';
    if (definitions[i].example) {
      html += '<div class="def-example">"' + escapeHtml(definitions[i].example) + '"</div>';
    }
  }
  return { html: html, count: definitions.length };
}

resizeHandleEl.addEventListener('mousedown', handleResizeStart);
document.addEventListener('mousemove', handleResizeMove);
document.addEventListener('mouseup', handleResizeEnd);

// ── Mobile tabs ──

const MOBILE_BREAKPOINT = 768;
const LYRICS_TAB = 'lyrics';

function isMobileView() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

// Hiding the editor while iOS is still building a selection leaves the OS
// hunting for somewhere to put it, and it lands on the header — the page
// title ends up selected with drag handles. Collapsing and dropping focus
// while the textarea is still on screen ends the gesture cleanly.
function endEditorSelection() {
  const caret = textareaEl.selectionStart;
  textareaEl.setSelectionRange(caret, caret);
  textareaEl.blur();
}

function switchMobileTab(tab) {
  console.assert(typeof tab === 'string', 'switchMobileTab: tab must be a string');
  if (typeof tab !== 'string') return;
  const tabButtons = mobileTabsEl.querySelectorAll('.mobile-tab');
  for (let i = 0; i < tabButtons.length; i++) {
    const button = tabButtons[i];
    const buttonTab = button.dataset.tab;
    button.classList.toggle('active', buttonTab === tab);
  }
  // Swap immediately and fade the incoming panel in; a delayed swap
  // shows a blank desk, and a lingering inline opacity:0 would hide
  // the rhymes panel after a mobile-to-desktop resize.
  setBottomNavOffScreen(tab !== LYRICS_TAB);
  if (tab !== LYRICS_TAB) endEditorSelection();

  mainEl.classList.remove('show-lyrics', 'show-rhymes');
  mainEl.classList.add('show-' + tab);
  var lyricsPanel = document.querySelector('.lyrics-panel');
  var incoming = tab === LYRICS_TAB ? lyricsPanel : rhymesPanelEl;
  incoming.style.opacity = '0';
  void incoming.offsetWidth;
  incoming.style.opacity = '1';
}

mobileTabsEl.addEventListener('click', function handleTabClick(event) {
  const clicked = event.target;
  const tabButton = clicked.closest('.mobile-tab');
  if (!tabButton) return;
  switchMobileTab(tabButton.dataset.tab);
});

// ── Bottom navigation (mobile) ──

let controlsAreInBottomNav = false;

// The controls are moved rather than duplicated, so their ids stay unique and
// the listeners bound at startup keep working in either position.
function placeControlsForViewport() {
  const wantsBottomNav = isMobileView();
  if (wantsBottomNav === controlsAreInBottomNav) return;

  if (wantsBottomNav) {
    disableInternalRhymesForMobile();
    // Create rides along but stays hidden until sign-in; CSS owns that, so
    // placement does not have to know about auth.
    bottomNavEl.append(toggleBtn, rhymeSchemeToggleEl, notebookBtn, createBtn);
    headerEl.insertBefore(userAreaEl, headerEl.firstElementChild);
  } else {
    headerEl.insertBefore(toggleBtn, headerRightEl);
    headerEl.insertBefore(rhymeSchemeToggleEl, headerRightEl);
    headerEl.insertBefore(notebookBtn, headerRightEl);
    headerEl.insertBefore(createBtn, headerRightEl);
    headerRightEl.appendChild(userAreaEl);
  }
  controlsAreInBottomNav = wantsBottomNav;
}

function setBottomNavDucked(isDucked) {
  bottomNavEl.classList.toggle('ducked', isDucked);
}

function setBottomNavOffScreen(isOffScreen) {
  bottomNavEl.classList.toggle('off-screen', isOffScreen);
}

// The bar belongs to the top of the page and nowhere else. Reading the scroll
// direction instead looked the same until the keyboard arrived: iOS shrinks
// the editor, the clamped scrollTop reads as an upward scroll, and the bar
// came back over the writing and stayed there. Position cannot be argued with.
function handleEditorScrollForNav() {
  setBottomNavDucked(lyricsAreaEl.scrollTop > 0);
}

// The bar floats over the editor, so the editor has to know how much of its
// own floor is spoken for. Measured rather than declared: the height depends
// on whether a label wraps and on the home-indicator inset. Desktop hides the
// bar outright, so it measures zero there without asking about the viewport.
function publishBottomNavHeight() {
  document.documentElement.style.setProperty(
    '--bottom-nav-height', bottomNavEl.offsetHeight + 'px');
  resizeEditorToContent();
}

// ── Keyboard-aware resize on mobile ──

if (window.visualViewport) {
  const viewport = window.visualViewport;

  function fitAppToVisualViewport() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;
    // A window widened past the mobile breakpoint would otherwise keep the
    // narrow height it was last fitted to, and leave the desk showing below.
    if (!isMobileView()) {
      appContent.style.height = '';
      return;
    }
    appContent.style.height = viewport.height + 'px';

    // The app is already sized to the space the keyboard leaves, so the
    // document behind it never needs to move. iOS scrolls it anyway when it
    // raises the keyboard, which drags the header off the top of the screen
    // and leaves the desk showing under the app.
    window.scrollTo(0, 0);
  }

  // Only a resize changes how much room the writing has. Scrolling the visual
  // viewport does not, so it re-fits without disturbing where the writer is.
  function handleViewportResize() {
    fitAppToVisualViewport();
    requestAnimationFrame(revealCaretLine);
  }

  viewport.addEventListener('resize', handleViewportResize);
  viewport.addEventListener('scroll', fitAppToVisualViewport);
}

// ── First-run guidance ──

const RHYME_HINT_TOUCH = 'Tap a word, then open Rhymes to see what it rhymes with.';
const RHYME_HINT_POINTER = 'Click any word to see what rhymes with it.';
const EMPTY_RESULTS_TOUCH = 'Tap a word in your lyrics<br>and its rhymes appear here';
const EMPTY_RESULTS_POINTER = 'Click a word in your lyrics<br>to see what rhymes with it';

// The tap/click wording follows the pointer, not the viewport width: a narrow
// desktop window is still a mouse, and a wide tablet is still a finger.
function isTouchPrimary() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

// The intro line lives in index.html so the pad reads correctly before this
// runs; only the rhyme hint is appended here, where the pointer is known.
function showFirstRunGuidance() {
  const isTouch = isTouchPrimary();
  textareaEl.placeholder += '\n\n' + (isTouch ? RHYME_HINT_TOUCH : RHYME_HINT_POINTER);

  const emptyState = resultsEl.querySelector('.empty-state');
  if (emptyState) {
    emptyState.innerHTML = isTouch ? EMPTY_RESULTS_TOUCH : EMPTY_RESULTS_POINTER;
  }
}

showFirstRunGuidance();

// Back to what a new visitor sees: no picked word, no quoted lyric line, and
// the pointer to click a word.
function resetRhymesPanel() {
  currentHighlightWord = '';
  pickedBounds = null;
  currentResults = null;
  selectedWordEl.textContent = '';
  selectedContextEl.textContent = '';
  tabRhymeWordEl.textContent = '';
  const pointer = isTouchPrimary() ? EMPTY_RESULTS_TOUCH : EMPTY_RESULTS_POINTER;
  resultsEl.innerHTML = '<div class="empty-state">' + pointer + '</div>';
  markPickedWord();
  focusedMark = null;
  applyRhymeFocus();
}

window.resetRhymesPanel = resetRhymesPanel;

let resizeRAF = null;

function handleWindowResize() {
  placeControlsForViewport();
  publishBottomNavHeight();
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(function remeasureAfterResize() {
    remeasureIfWidthChanged();
    resizeRAF = null;
  });
}

placeControlsForViewport();
publishBottomNavHeight();
window.addEventListener('resize', handleWindowResize);

// Moving the controls in or out of the bar changes its height, and so does
// signing in, which adds a third and fourth column of labels to wrap.
if (window.ResizeObserver) {
  new ResizeObserver(publishBottomNavHeight).observe(bottomNavEl);
}

// Signing in changes the header's height and the keyboard changes the visible
// viewport; neither fires a window resize, and both change the floor the
// editor has to reach.
if (window.ResizeObserver) {
  new ResizeObserver(function onEditorAreaResize() {
    resizeEditorToContent();
    remeasureIfWidthChanged();
  }).observe(lyricsAreaEl);
}

// Initialize mobile view with lyrics tab
if (isMobileView()) {
  switchMobileTab(LYRICS_TAB);
}

setInterval(function pollTextChanges() {
  if (textareaEl.value !== lastTextValue) {
    lastTextValue = textareaEl.value;
    updateGutters();
    renderHighlight();
  }
}, POLL_INTERVAL_MS);

// ── Init ──
async function fetchWordArray(path, label) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(label + ': failed to fetch ' + path);
  const words = await resp.json();
  console.assert(Array.isArray(words), label + ': words must be an array');
  return words;
}

async function loadWordSet(path, label) {
  return new Set(await fetchWordArray(path, label));
}

// The list's order is its frequency ranking, so a word's index is its rank.
function buildWordRanks(words) {
  const ranks = new Map();
  for (let rank = 0; rank < words.length; rank++) {
    if (!ranks.has(words[rank])) ranks.set(words[rank], rank);
  }
  return ranks;
}

// Ranking is wanted whether or not the English filter is on, so the ranks are
// built here rather than beside the filter that shares the file.
async function loadEnglishWords() {
  const words = await fetchWordArray('english-words.json', 'loadEnglishWords');
  englishWords = new Set(words);
  wordRanks = buildWordRanks(words);
}

async function loadBlocklist() {
  blocklist = await loadWordSet('blocklist.json', 'loadBlocklist');
}

// A margin left open earlier in the session is already asking for the data, so
// it is fetched now rather than on the next interaction. A first visit to an
// empty pad fetches nothing until the writer reaches for it. A restored draft
// arrives through storage.js, which dispatches an input event of its own.
if (syllablesVisible || rhymeSchemeVisible || internalRhymesVisible) ensureRhymeData();
