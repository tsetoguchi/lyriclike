// ── Constants ──
const VOWELS = new Set([
  'AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'
]);
const PLOSIVES = new Set(['B','D','G','P','T','K']);
const FRICATIVES = new Set(['V','DH','Z','ZH','JH','F','TH','S','SH','CH']);
const NASALS = new Set(['M','N','NG']);

const DEBOUNCE_DELAY_MS = 150;
const POLL_INTERVAL_MS = 300;
const PASTE_DELAY_MS = 0;
const MIN_WORD_LENGTH = 2;
const MAX_RESULTS_PER_GROUP = 500;
const MAX_GUTTER_LINES = 2000;
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 1400;
const MAX_HIGHLIGHT_MATCHES = 500;
const SCROLL_THROTTLE_MS = 16;

const RHYME_TYPES = [
  { key: 'perfect', name: 'Perfect', desc: 'Same vowel and ending consonants' },
  { key: 'family', name: 'Family', desc: 'Same vowel, ending consonants in same phonetic family' },
  { key: 'additive', name: 'Additive', desc: 'Same vowel, candidate adds extra consonants' },
  { key: 'subtractive', name: 'Subtractive', desc: 'Same vowel, candidate has fewer consonants' },
  { key: 'assonance', name: 'Assonance', desc: 'Same vowel, unrelated ending consonants' },
  { key: 'consonance', name: 'Consonance', desc: 'Different vowel, same ending consonants' }
];

// ── State ──
let dictionary = null;
let rhymeIndex = null;
let vowelBuckets = null;
let codaBuckets = null;
let englishWords = null;
// English-only filtering is always on. Its button was removed from the UI,
// so this is state rather than a constant only because setEnglishOnly()
// keeps it reachable for a settings page.
let englishOnly = true;
let syllablesVisible = sessionStorage.getItem('syllablesVisible') === '1';
let rhymeSchemeVisible = sessionStorage.getItem('rhymeSchemeVisible') === '1';
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

// ── Phoneme helpers ──

function getFamily(consonant) {
  console.assert(typeof consonant === 'string', 'getFamily: consonant must be a string');
  if (PLOSIVES.has(consonant)) return 'plosive';
  if (FRICATIVES.has(consonant)) return 'fricative';
  if (NASALS.has(consonant)) return 'nasal';
  return null;
}

function stripStress(phoneme) {
  console.assert(typeof phoneme === 'string', 'stripStress: phoneme must be a string');
  return phoneme.replace(/[012]$/, '');
}

function checkVowel(phoneme) {
  console.assert(typeof phoneme === 'string', 'checkVowel: phoneme must be a string');
  return VOWELS.has(stripStress(phoneme));
}

function vowelsMatch(vowel1, vowel2) {
  console.assert(typeof vowel1 === 'string', 'vowelsMatch: vowel1 must be a string');
  console.assert(typeof vowel2 === 'string', 'vowelsMatch: vowel2 must be a string');
  if (vowel1 === vowel2) return true;
  // Cot-caught merger: AA (got/hot) ≈ AO (lost/caught)
  if ((vowel1 === 'AA' || vowel1 === 'AO') && (vowel2 === 'AA' || vowel2 === 'AO')) return true;
  return false;
}

function lookupWord(word) {
  console.assert(typeof word === 'string', 'lookupWord: word must be a string');
  if (typeof word !== 'string') return null;
  if (dictionary[word]) return dictionary[word];
  if (word.endsWith("in'")) {
    const expanded = word.slice(0, -3) + 'ing';
    if (dictionary[expanded]) return dictionary[expanded];
  }
  if (word.endsWith("'")) {
    const trimmed = word.slice(0, -1);
    if (dictionary[trimmed]) return dictionary[trimmed];
  }
  return null;
}

function getStress(phoneme) {
  console.assert(typeof phoneme === 'string', 'getStress: phoneme must be a string');
  const match = phoneme.match(/([012])$/);
  return match ? parseInt(match[1]) : -1;
}

// ── Rhyme part extraction ──

function findStressedVowelIndex(phonemes) {
  console.assert(Array.isArray(phonemes), 'findStressedVowelIndex: phonemes must be an array');
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (checkVowel(phonemes[i]) && getStress(phonemes[i]) === 1) {
      return i;
    }
  }
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (checkVowel(phonemes[i])) {
      return i;
    }
  }
  return -1;
}

function extractRhymePart(phonemes) {
  if (!Array.isArray(phonemes) || phonemes.length === 0) return null;
  const idx = findStressedVowelIndex(phonemes);
  if (idx === -1) return null;
  const onset = phonemes.slice(0, idx).map(stripStress);
  const vowel = stripStress(phonemes[idx]);
  const coda = phonemes.slice(idx + 1).map(stripStress);
  console.assert(typeof vowel === 'string', 'extractRhymePart: vowel must be a string');
  console.assert(Array.isArray(coda), 'extractRhymePart: coda must be an array');
  return { onset, vowel, coda };
}

function extractEndRhymePart(phonemes) {
  console.assert(Array.isArray(phonemes), 'extractEndRhymePart: phonemes must be an array');
  if (!Array.isArray(phonemes) || phonemes.length === 0) return null;
  let lastVowelIdx = -1;
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (checkVowel(phonemes[i])) { lastVowelIdx = i; break; }
  }
  if (lastVowelIdx === -1) return null;
  const stressedIdx = findStressedVowelIndex(phonemes);
  if (lastVowelIdx === stressedIdx) return null;
  const onset = phonemes.slice(0, lastVowelIdx).map(stripStress);
  const vowel = stripStress(phonemes[lastVowelIdx]);
  const coda = phonemes.slice(lastVowelIdx + 1).map(stripStress);
  console.assert(typeof vowel === 'string', 'extractEndRhymePart: vowel must be a string');
  console.assert(Array.isArray(coda), 'extractEndRhymePart: coda must be an array');
  return { onset, vowel, coda };
}

// ── Coda comparison helpers ──

function checkFamilyCoda(coda1, coda2) {
  if (!Array.isArray(coda1) || !Array.isArray(coda2)) return false;
  if (coda1.length === 0 || coda2.length === 0) return false;
  if (coda1.length !== coda2.length) return false;
  let hasFamilySwap = false;
  for (let i = 0; i < coda1.length; i++) {
    if (coda1[i] === coda2[i]) continue;
    const family1 = getFamily(coda1[i]);
    const family2 = getFamily(coda2[i]);
    if (family1 !== null && family1 === family2) {
      hasFamilySwap = true;
    } else {
      return false;
    }
  }
  return hasFamilySwap;
}

function checkCodaContains(longer, shorter) {
  if (!Array.isArray(longer) || !Array.isArray(shorter)) return false;
  if (shorter.length === 0) return true;
  const longerStr = longer.join(' ');
  const shorterStr = shorter.join(' ');
  const prefixMatch = longerStr.startsWith(shorterStr)
    && (longerStr.length === shorterStr.length || longerStr[shorterStr.length] === ' ');
  if (prefixMatch) return true;
  const suffixMatch = longerStr.endsWith(shorterStr)
    && (longerStr.length === shorterStr.length || longerStr[longerStr.length - shorterStr.length - 1] === ' ');
  return suffixMatch;
}

function checkCodaUnrelated(coda1, coda2) {
  if (!Array.isArray(coda1) || !Array.isArray(coda2)) return false;
  for (let i = 0; i < coda1.length; i++) {
    const family1 = getFamily(coda1[i]);
    for (let j = 0; j < coda2.length; j++) {
      if (coda1[i] === coda2[j]) return false;
      const family2 = getFamily(coda2[j]);
      if (family1 && family2 && family1 === family2) return false;
    }
  }
  return true;
}

// ── Rhyme classification ──

function classifyRhyme(target, candidate) {
  if (!target || !candidate) return null;
  console.assert(target.vowel && target.coda, 'classifyRhyme: target must have vowel and coda');
  console.assert(candidate.vowel && candidate.coda, 'classifyRhyme: candidate must have vowel and coda');

  const exactVowelMatch = target.vowel === candidate.vowel;
  const sameVowel = exactVowelMatch || vowelsMatch(target.vowel, candidate.vowel);
  const targetCoda = target.coda;
  const candidateCoda = candidate.coda;
  const targetOnset = target.onset;
  const candidateOnset = candidate.onset;
  const targetCodaStr = targetCoda.join(' ');
  const candidateCodaStr = candidateCoda.join(' ');
  const sameCoda = targetCodaStr === candidateCodaStr;
  const sameOnset = targetOnset.join(' ') === candidateOnset.join(' ');

  if (sameVowel && sameCoda && !sameOnset) return 'perfect';

  if (sameVowel && !sameCoda && !sameOnset && checkFamilyCoda(targetCoda, candidateCoda)) {
    return 'family';
  }

  if (sameVowel && !sameCoda) {
    const candidateLonger = candidateCoda.length > targetCoda.length;
    const targetLonger = targetCoda.length > candidateCoda.length;
    if (candidateLonger && checkCodaContains(candidateCoda, targetCoda)) return 'additive';
    if (targetLonger && checkCodaContains(targetCoda, candidateCoda)) return 'subtractive';
  }

  // Assonance requires exact vowel match — merged vowels (AA/AO) need coda
  // evidence from stronger categories above to avoid false positives
  if (exactVowelMatch && !sameCoda) return 'assonance';

  if (!sameVowel && sameCoda && targetCoda.length > 0) return 'consonance';

  return null;
}

// ── Dictionary loading ──

async function loadDictionary() {
  const resp = await fetch('cmudict.json');
  if (!resp.ok) throw new Error('loadDictionary: failed to fetch cmudict.json');
  dictionary = await resp.json();
  console.assert(dictionary !== null, 'loadDictionary: dictionary must not be null');

  rhymeIndex = {};
  vowelBuckets = {};
  codaBuckets = {};
  const words = Object.keys(dictionary);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const firstPronunciation = dictionary[word][0];
    const rhymePart = extractRhymePart(firstPronunciation);
    if (rhymePart) {
      rhymeIndex[word] = rhymePart;
      const vowel = rhymePart.vowel;
      if (!vowelBuckets[vowel]) vowelBuckets[vowel] = [];
      vowelBuckets[vowel].push(word);
      if (vowel === 'AA' || vowel === 'AO') {
        const other = vowel === 'AA' ? 'AO' : 'AA';
        if (!vowelBuckets[other]) vowelBuckets[other] = [];
        vowelBuckets[other].push(word);
      }
      if (rhymePart.coda.length > 0) {
        const codaKey = rhymePart.coda.join(' ');
        if (!codaBuckets[codaKey]) codaBuckets[codaKey] = [];
        codaBuckets[codaKey].push(word);
      }
    }
  }
}

// ── Rhyme search ──

function findRhymes(targetWord) {
  if (typeof targetWord !== 'string') return null;
  // Fail closed: without the blocklist, results would render unfiltered.
  if (!blocklist) return null;
  targetWord = targetWord.toLowerCase().replace(/[^a-z']/g, '');
  if (!targetWord || !rhymeIndex[targetWord]) return null;
  console.assert(rhymeIndex[targetWord], 'findRhymes: target must exist in index');

  const target = rhymeIndex[targetWord];
  const results = {
    perfect: [], family: [], additive: [],
    subtractive: [], assonance: [], consonance: []
  };

  // Scan vowel bucket for vowel-matching types
  const seen = new Set();
  seen.add(targetWord);
  const vowelWords = vowelBuckets[target.vowel] || [];
  for (let i = 0; i < vowelWords.length; i++) {
    const word = vowelWords[i];
    if (seen.has(word)) continue;
    seen.add(word);
    const type = classifyRhyme(target, rhymeIndex[word]);
    if (type) results[type].push(word);
  }

  // Scan coda bucket for consonance (same coda, different vowel)
  if (target.coda.length > 0) {
    const codaKey = target.coda.join(' ');
    const codaWords = codaBuckets[codaKey] || [];
    for (let i = 0; i < codaWords.length; i++) {
      const word = codaWords[i];
      if (seen.has(word)) continue;
      seen.add(word);
      const type = classifyRhyme(target, rhymeIndex[word]);
      if (type) results[type].push(word);
    }
  }

  for (let i = 0; i < RHYME_TYPES.length; i++) {
    const key = RHYME_TYPES[i].key;
    if (englishOnly && englishWords) {
      results[key] = results[key].filter(function filterEnglish(word) { return englishWords.has(word); });
    }
    results[key] = results[key].filter(function filterBlocked(word) { return !blocklist.has(word); });
    results[key].sort();
  }

  return results;
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
let currentResults = null;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(text) {
  console.assert(typeof text === 'string', 'escapeHtml: text must be a string');
  if (typeof text !== 'string') return '';
  return text.replace(/[&<>"]/g, function replaceChar(char) {
    return HTML_ESCAPES[char];
  });
}

function updateHighlight(word) {
  console.assert(typeof word === 'string', 'updateHighlight: word must be a string');
  if (typeof word !== 'string') return;
  currentHighlightWord = word.toLowerCase().replace(/[^a-z']/g, '');
  const text = textareaEl.value;
  if (!currentHighlightWord || currentHighlightWord.length < MIN_WORD_LENGTH) {
    highlightEl.innerHTML = '';
    return;
  }
  const safeWord = currentHighlightWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(\\b)(' + safeWord + ')(\\b)', 'gi');
  const escaped = escapeHtml(text);
  let matchCount = 0;
  const highlighted = escaped.replace(pattern, function replaceMatch(full, pre, match, post) {
    if (matchCount >= MAX_HIGHLIGHT_MATCHES) return full;
    matchCount++;
    return pre + '<span class="highlight-word">' + match + '</span>' + post;
  });
  highlightEl.innerHTML = highlighted + '\n';
}



// ── Word selection handling ──

function extractWordAtCursor(text, start, end) {
  console.assert(typeof text === 'string', 'extractWordAtCursor: text must be a string');
  console.assert(typeof start === 'number' && typeof end === 'number', 'extractWordAtCursor: start/end must be numbers');
  if (typeof text !== 'string') return '';
  if (start !== end) {
    return text.substring(start, end).trim();
  }
  const before = text.slice(0, start).match(/[a-zA-Z']+$/);
  const after = text.slice(start).match(/^[a-zA-Z']+/);
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

function handleSelection() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function processSelection() {
    const text = textareaEl.value;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;

    let word = extractWordAtCursor(text, start, end);
    if (/\s/.test(word)) return;
    word = word.replace(/[^a-zA-Z']/g, '');
    if (word.length < MIN_WORD_LENGTH) return;
    if (!rhymeIndex) return;

    updateHighlight(word);
    const results = findRhymes(word);
    renderResults(word, results);
    selectedContextEl.textContent = getWordContext(text, start);
    wordBarEl.classList.remove('flash');
    void wordBarEl.offsetWidth;
    wordBarEl.classList.add('flash');
  }, DEBOUNCE_DELAY_MS);
}

// ── Syllable counting ──

function countSyllablesFromDict(word) {
  console.assert(typeof word === 'string', 'countSyllablesFromDict: word must be a string');
  if (!dictionary) return 0;
  const entry = dictionary[word];
  if (!entry) return 0;
  const firstPronunciation = entry[0];
  const count = firstPronunciation.filter(checkVowel).length;
  console.assert(count >= 0, 'countSyllablesFromDict: count must be non-negative');
  return count;
}

function stripBrackets(text) {
  return text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');
}

function countSyllablesFallback(cleaned) {
  console.assert(typeof cleaned === 'string', 'countSyllablesFallback: cleaned must be a string');
  const matches = cleaned.match(/[aeiouy]+/gi);
  return matches ? matches.length : 1;
}

function countSyllablesForLine(line) {
  if (typeof line !== 'string') return 0;
  line = stripBrackets(line);
  const tokens = line.split(/\s+/);
  const words = tokens.filter(function hasLetters(token) {
    const letters = token.replace(/[^a-z']/gi, '');
    return letters.length > 0;
  });
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    const lowered = words[i].toLowerCase();
    const cleaned = lowered.replace(/[^a-z']/g, '');
    if (cleaned.length === 0) continue;
    const dictCount = countSyllablesFromDict(cleaned);
    total += dictCount > 0 ? dictCount : countSyllablesFallback(cleaned);
  }
  console.assert(total >= 0, 'countSyllablesForLine: total must be non-negative');
  return total;
}

function buildSyllableLine(line, height) {
  const trimmed = line.trim();
  // Hidden counts still need spacer divs: every row below one of them sits
  // where the rows above have put it.
  if (!syllablesVisible || trimmed === '') {
    return '<div class="syl-line empty-line" style="height:' + height + 'px">&middot;</div>';
  }
  const count = countSyllablesForLine(trimmed);
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

// ── Rhyme scheme detection ──

// Values live in styles.css :root so the theme owns all color decisions.
const SCHEME_COLORS = [
  'var(--scheme-0)', 'var(--scheme-1)', 'var(--scheme-2)', 'var(--scheme-3)',
  'var(--scheme-4)', 'var(--scheme-5)', 'var(--scheme-6)', 'var(--scheme-7)',
  'var(--scheme-8)', 'var(--scheme-9)'
];

function getLastWord(line) {
  console.assert(typeof line === 'string', 'getLastWord: line must be a string');
  if (typeof line !== 'string') return '';
  const stripped = stripBrackets(line).trim();
  if (!stripped) return '';
  const words = stripped.match(/[a-zA-Z']+/g);
  if (!words || words.length === 0) return '';
  return words[words.length - 1].toLowerCase().replace(/[^a-z']/g, '');
}

const RHYME_STRENGTH = { perfect: 5, family: 4, additive: 3, subtractive: 2, assonance: 1 };
const MIN_CROSS_STRENGTH = 2;

function getAllRhymeParts(phonemes) {
  console.assert(Array.isArray(phonemes), 'getAllRhymeParts: phonemes must be an array');
  const parts = [];
  const stressed = extractRhymePart(phonemes);
  if (stressed) parts.push(stressed);
  const end = extractEndRhymePart(phonemes);
  if (end) parts.push(end);
  return parts;
}

function bestRhymeStrength(word1, word2) {
  console.assert(typeof word1 === 'string', 'bestRhymeStrength: word1 must be a string');
  console.assert(typeof word2 === 'string', 'bestRhymeStrength: word2 must be a string');
  if (!dictionary || !word1 || !word2) return 0;
  if (word1 === word2) return 6;
  const entries1 = lookupWord(word1);
  const entries2 = lookupWord(word2);
  if (!entries1 || !entries2) return 0;
  let best = 0;
  for (let i = 0; i < entries1.length; i++) {
    const stressed1 = extractRhymePart(entries1[i]);
    const end1 = extractEndRhymePart(entries1[i]);
    for (let j = 0; j < entries2.length; j++) {
      const stressed2 = extractRhymePart(entries2[j]);
      const end2 = extractEndRhymePart(entries2[j]);
      // Compare same-type parts: stressed vs stressed, end vs end
      const pairs = [];
      if (stressed1 && stressed2) pairs.push([stressed1, stressed2]);
      if (end1 && end2) pairs.push([end1, end2]);
      for (let k = 0; k < pairs.length; k++) {
        const pair = pairs[k];
        const type = classifyRhyme(pair[0], pair[1]);
        const strength = type ? (RHYME_STRENGTH[type] || 0) : 0;
        if (strength > best) best = strength;
      }
      // Cross-compare: end of polysyllabic word vs stressed of monosyllabic
      const crossPairs = [];
      if (end1 && !end2 && stressed2) crossPairs.push([end1, stressed2]);
      if (!end1 && end2 && stressed1) crossPairs.push([stressed1, end2]);
      for (let k = 0; k < crossPairs.length; k++) {
        const crossPair = crossPairs[k];
        const type = classifyRhyme(crossPair[0], crossPair[1]);
        const strength = type ? (RHYME_STRENGTH[type] || 0) : 0;
        if (strength >= MIN_CROSS_STRENGTH && strength > best) best = strength;
      }
    }
  }
  return best;
}

function computeRhymeScheme(lines) {
  console.assert(Array.isArray(lines), 'computeRhymeScheme: lines must be an array');
  const scheme = [];
  let nextLabel = 0;
  const labelMap = [];
  const lineCount = Math.min(lines.length, MAX_GUTTER_LINES);

  // Build an index of vowel -> [{lineIndex, word, label}] for O(n) lookups
  const vowelIndex = {};

  function addToVowelIndex(vowel, entry) {
    if (!vowelIndex[vowel]) vowelIndex[vowel] = [];
    vowelIndex[vowel].push(entry);
  }

  for (let i = 0; i < lineCount; i++) {
    const word = getLastWord(lines[i]);
    if (!word || lines[i].trim() === '') {
      labelMap.push(-1);
      continue;
    }

    // Find best match from vowel index instead of scanning all previous lines
    let foundLabel = -1;
    let bestStr = 0;
    const entries = lookupWord(word);
    if (entries) {
      const checkedVowels = new Set();
      for (let e = 0; e < entries.length; e++) {
        const parts = getAllRhymeParts(entries[e]);
        for (let p = 0; p < parts.length; p++) {
          const vowel = parts[p].vowel;
          if (checkedVowels.has(vowel)) continue;
          checkedVowels.add(vowel);
          const candidates = vowelIndex[vowel] || [];
          for (let c = 0; c < candidates.length; c++) {
            const strength = bestRhymeStrength(word, candidates[c].word);
            if (strength > bestStr) {
              bestStr = strength;
              foundLabel = candidates[c].label;
            }
          }
          // Also check merged vowels (AA/AO)
          if (vowel === 'AA' || vowel === 'AO') {
            const other = vowel === 'AA' ? 'AO' : 'AA';
            const otherCandidates = vowelIndex[other] || [];
            for (let c = 0; c < otherCandidates.length; c++) {
              const strength = bestRhymeStrength(word, otherCandidates[c].word);
              if (strength > bestStr) {
                bestStr = strength;
                foundLabel = otherCandidates[c].label;
              }
            }
          }
        }
      }
    }

    const label = foundLabel === -1 ? nextLabel++ : foundLabel;
    labelMap.push(label);

    // Add this word to the vowel index for future lines to find
    if (entries) {
      for (let e = 0; e < entries.length; e++) {
        const parts = getAllRhymeParts(entries[e]);
        for (let p = 0; p < parts.length; p++) {
          addToVowelIndex(parts[p].vowel, { word: word, label: label });
        }
      }
    }
  }

  for (let idx = 0; idx < labelMap.length; idx++) {
    if (labelMap[idx] === -1) {
      scheme.push('');
    } else {
      scheme.push(String.fromCharCode(65 + (labelMap[idx] % 26)));
    }
  }

  return scheme;
}

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
  if (!dictionary) return;
  console.assert(rhymeSchemeGutterEl !== null, 'updateRhymeSchemeGutter: gutter element must exist');
  const text = textareaEl.value;
  const allLines = text.split('\n');
  const lineCount = Math.min(allLines.length, MAX_GUTTER_LINES);

  const { stanzas, stanzaStartIndices } = splitIntoStanzas(allLines, lineCount);

  const labels = new Array(lineCount).fill('');
  const labelColors = new Array(lineCount).fill('');

  for (let stanzaIdx = 0; stanzaIdx < stanzas.length; stanzaIdx++) {
    const stanza = stanzas[stanzaIdx];
    const scheme = computeRhymeScheme(stanza);
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
  updateGutters();
  if (currentHighlightWord) updateHighlight(currentHighlightWord);
});

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
    // The notebook pair rides along but stays hidden until sign-in; CSS owns
    // that, so placement does not have to know about auth.
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
    if (!isMobileView()) return;
    const appContent = document.getElementById('app-content');
    if (appContent) appContent.style.height = viewport.height + 'px';

    // The app is already sized to the space the keyboard leaves, so the
    // document behind it never needs to move. iOS scrolls it anyway when it
    // raises the keyboard, which drags the header off the top of the screen
    // and leaves the desk showing under the app.
    window.scrollTo(0, 0);
  }

  viewport.addEventListener('resize', fitAppToVisualViewport);
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
  }
}, POLL_INTERVAL_MS);

// ── Init ──
async function loadWordSet(path, label) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(label + ': failed to fetch ' + path);
  const words = await resp.json();
  console.assert(Array.isArray(words), label + ': words must be an array');
  return new Set(words);
}

async function loadEnglishWords() {
  englishWords = await loadWordSet('english-words.json', 'loadEnglishWords');
}

async function loadBlocklist() {
  blocklist = await loadWordSet('blocklist.json', 'loadBlocklist');
}

// The blocklist gates rhyme results, so it is required at startup. The English
// word list only refines them, so losing it degrades quality without blocking.
Promise.all([loadDictionary(), loadBlocklist()]).then(function onRequiredLoaded() {
  statusEl.textContent = '';
  updateGutters();
}).catch(function onRequiredLoadError(err) {
  statusEl.textContent = 'Failed to load dictionary';
  console.error(err);
});

// Lookups made before the list lands come back unfiltered, so redo the last
// one once it is in.
loadEnglishWords().then(refreshCurrentResults).catch(function onEnglishWordsError(err) {
  console.error(err);
});
