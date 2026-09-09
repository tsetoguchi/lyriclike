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
let englishOnly = sessionStorage.getItem('englishOnly') === '1';
let syllablesVisible = sessionStorage.getItem('syllablesVisible') === '1';
let rhymeSchemeVisible = sessionStorage.getItem('rhymeSchemeVisible') === '1';
let blocklist = null;
let debounceTimer = null;
let lastTextValue = '';
// The word the rhymes tab was last auto-opened for. A repeat tap on that
// same word stays in the editor so the word can be edited; see
// hasEarnedTabSwitch().
let autoSwitchedWord = null;

// ── DOM references ──
const textareaEl = document.getElementById('lyrics');
const gutterEl = document.getElementById('syllable-gutter');
const toggleBtn = document.getElementById('syllable-toggle');
const statusEl = document.getElementById('status');
const selectedWordEl = document.getElementById('selected-word');
const resultsEl = document.getElementById('rhyme-results');
const englishToggleEl = document.getElementById('english-toggle');
const resizeHandleEl = document.getElementById('resize-handle');
const rhymesPanelEl = document.getElementById('rhymes-panel');
const highlightEl = document.getElementById('lyrics-highlight');
const mobileTabsEl = document.getElementById('mobile-tabs');
const mainEl = document.querySelector('.main');
const selectedContextEl = document.getElementById('selected-context');
const wordBarEl = document.querySelector('.selected-word-bar');
const rhymeSchemeGutterEl = document.getElementById('rhyme-scheme-gutter');
const rhymeSchemeToggleEl = document.getElementById('rhyme-scheme-toggle');

// ── Restore session state ──
if (englishOnly) englishToggleEl.classList.add('active');
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

function buildGroupHtml(key, name, desc, words) {
  console.assert(typeof key === 'string', 'buildGroupHtml: key must be a string');
  console.assert(typeof name === 'string', 'buildGroupHtml: name must be a string');
  console.assert(Array.isArray(words), 'buildGroupHtml: words must be an array');

  const isEmpty = words.length === 0;
  const openClass = key === 'perfect' ? ' open' : '';
  const visible = words.slice(0, MAX_RESULTS_PER_GROUP);
  const hasMore = words.length > MAX_RESULTS_PER_GROUP;
  const bodyContent = isEmpty
    ? '<span class="no-rhymes">No rhymes found</span>'
    : visible.map(word => `<span class="rhyme-word color-${key}">${word}</span>`).join('');
  const showMoreBtn = hasMore
    ? `<button class="show-more-btn" data-type="${key}" data-page="1" data-total="${words.length}">Show more (${words.length - MAX_RESULTS_PER_GROUP} remaining)</button>`
    : '';

  return `<div class="rhyme-group${openClass}" data-type="${key}">
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
    <div class="rhyme-group-body">${bodyContent}${showMoreBtn}</div>
  </div>`;
}

function renderResults(word, results) {
  if (typeof word !== 'string') return;
  selectedWordEl.textContent = word;
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

function escapeHtml(text) {
  console.assert(typeof text === 'string', 'escapeHtml: text must be a string');
  if (typeof text !== 'string') return '';
  const ampEscaped = text.replace(/&/g, '&amp;');
  const ltEscaped = ampEscaped.replace(/</g, '&lt;');
  const result = ltEscaped.replace(/>/g, '&gt;');
  console.assert(typeof result === 'string', 'escapeHtml: result must be a string');
  return result;
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

function syncHighlightScroll() {
  highlightEl.scrollTop = textareaEl.scrollTop;
  highlightEl.scrollLeft = textareaEl.scrollLeft;
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

function handleSelection(switchTab) {
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
    if (switchTab && results && hasEarnedTabSwitch(word, start !== end)) {
      autoSwitchedWord = word.toLowerCase();
      switchMobileTab('rhymes');
    }
  }, DEBOUNCE_DELAY_MS);
}

// A tap on a word opens the rhymes tab, but only the first time for that word.
// Tapping the same word again leaves the caret in the editor, which is what
// makes a word reachable for editing — otherwise every tap would bounce the
// writer out of the lyrics. A deliberate selection (double-tap / long-press)
// always switches, so a re-lookup of the current word is still one gesture.
function hasEarnedTabSwitch(word, isDeliberateSelection) {
  if (!isMobileView()) return false;
  return isDeliberateSelection || word.toLowerCase() !== autoSwitchedWord;
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
  // Hidden counts still need spacer divs: the gutter's ruled background
  // only scrolls in sync with the textarea if its content overflows too.
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
  gutterEl.innerHTML = parts.join('');
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
  // Render all lines at once with span markers to avoid rounding drift
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const escaped = escapeHtml(lines[i]) || '\u200b';
    html += '<span data-ln="' + i + '">\u200b</span>';
    if (i < lines.length - 1) {
      html += escaped + '\n';
    } else {
      html += escaped;
    }
  }
  lineMeasureEl.innerHTML = html;
  const markers = lineMeasureEl.querySelectorAll('span[data-ln]');
  const heights = [];
  for (let j = 0; j < markers.length; j++) {
    const top = markers[j].offsetTop;
    const nextTop = (j < markers.length - 1) ? markers[j + 1].offsetTop : lineMeasureEl.scrollHeight;
    heights.push(nextTop - top);
  }
  lineMeasureEl.innerHTML = '';
  cachedLineHeights = heights;
  cachedLineHeightsText = textKey;
  cachedLineHeightsWidth = currentWidth;
  return heights;
}

function syncGutterScroll() {
  gutterEl.scrollTop = textareaEl.scrollTop;
  rhymeSchemeGutterEl.scrollTop = textareaEl.scrollTop;
  syncHighlightScroll();
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
  rhymeSchemeGutterEl.innerHTML = parts.join('');
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
  rhymeSchemeGutterEl.classList.toggle('visible', rhymeSchemeVisible);
  invalidateLineHeightCache();
  if (rhymeSchemeVisible) requestAnimationFrame(function() { updateRhymeSchemeGutter(); syncGutterScroll(); });
}

function toggleSyllables() {
  syllablesVisible = !syllablesVisible;
  sessionStorage.setItem('syllablesVisible', syllablesVisible ? '1' : '0');
  toggleBtn.classList.toggle('active', syllablesVisible);
  gutterEl.classList.toggle('visible', syllablesVisible);
  invalidateLineHeightCache();
  requestAnimationFrame(function() { updateSyllableGutter(); syncGutterScroll(); });
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
  updateSyllableGutter();
  updateRhymeSchemeGutter();
}

// ── Event binding (no inline handlers) ──

toggleBtn.addEventListener('click', toggleSyllables);
rhymeSchemeToggleEl.addEventListener('click', toggleRhymeScheme);
englishToggleEl.addEventListener('click', function toggleEnglish() {
  englishOnly = !englishOnly;
  sessionStorage.setItem('englishOnly', englishOnly ? '1' : '0');
  englishToggleEl.classList.toggle('active', englishOnly);
  if (currentHighlightWord) {
    const results = findRhymes(currentHighlightWord);
    renderResults(currentHighlightWord, results);
  }
});
textareaEl.addEventListener('mouseup', function() { handleSelection(true); });
textareaEl.addEventListener('touchend', function() { handleSelection(true); });
textareaEl.addEventListener('keyup', function() { handleSelection(false); });
function updateGutters() {
  updateSyllableGutter();
  updateRhymeSchemeGutter();
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
let scrollRAF = null;
textareaEl.addEventListener('scroll', function handleScroll() {
  syncGutterScroll();
  syncHighlightScroll();
  if (scrollRAF) cancelAnimationFrame(scrollRAF);
  scrollRAF = requestAnimationFrame(function rafScroll() {
    syncGutterScroll();
    syncHighlightScroll();
    scrollRAF = null;
  });
});

resultsEl.addEventListener('click', function handleResultsClick(event) {
  const clicked = event.target;

  // Group toggle
  const header = clicked.closest('.rhyme-group-header');
  if (header) {
    const group = header.parentElement;
    if (group) group.classList.toggle('open');
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

  fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word))
    .then(function(resp) {
      if (!resp.ok) throw new Error('not found');
      return resp.json();
    })
    .then(function(data) {
      popup.innerHTML = renderDefinition(data[0]);
    })
    .catch(function() {
      popup.innerHTML = '<div class="def-error">No definition found for "' + word + '"</div>';
    });
}

function renderDefinition(entry) {
  var html = '<div class="def-word">' + entry.word + '</div>';
  if (entry.phonetic) {
    html += '<div class="def-phonetic">' + entry.phonetic + '</div>';
  } else if (entry.phonetics && entry.phonetics.length > 0) {
    for (var p = 0; p < entry.phonetics.length; p++) {
      if (entry.phonetics[p].text) {
        html += '<div class="def-phonetic">' + entry.phonetics[p].text + '</div>';
        break;
      }
    }
  }

  var meanings = entry.meanings || [];
  var maxMeanings = 3;
  var count = 0;
  for (var i = 0; i < meanings.length && count < maxMeanings; i++) {
    var m = meanings[i];
    html += '<div class="def-pos">' + m.partOfSpeech + '</div>';
    var defs = m.definitions || [];
    for (var j = 0; j < defs.length && count < maxMeanings; j++) {
      html += '<div class="def-meaning">' + defs[j].definition + '</div>';
      if (defs[j].example) {
        html += '<div class="def-example">"' + defs[j].example + '"</div>';
      }
      count++;
    }
  }

  return html;
}

resizeHandleEl.addEventListener('mousedown', handleResizeStart);
document.addEventListener('mousemove', handleResizeMove);
document.addEventListener('mouseup', handleResizeEnd);

// ── Mobile tabs ──

const MOBILE_BREAKPOINT = 768;

function isMobileView() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
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
  mainEl.classList.remove('show-lyrics', 'show-rhymes');
  mainEl.classList.add('show-' + tab);
  var lyricsPanel = document.querySelector('.lyrics-panel');
  var incoming = tab === 'lyrics' ? lyricsPanel : rhymesPanelEl;
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

// ── Keyboard-aware resize on mobile ──

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', function handleViewportResize() {
    if (!isMobileView()) return;
    var appContent = document.getElementById('app-content');
    if (appContent) appContent.style.height = window.visualViewport.height + 'px';
  });
}

textareaEl.addEventListener('focus', function handleFocus() {
  if (!isMobileView()) return;
  setTimeout(function() {
    textareaEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 300);
});

// ── First-run guidance ──

const RHYME_HINT_TOUCH = 'Tap any word to see what rhymes with it.';
const RHYME_HINT_POINTER = 'Click any word to see what rhymes with it.';
const EMPTY_RESULTS_TOUCH = 'Tap a word in your lyrics<br>to see what rhymes with it';
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

// Initialize mobile view with lyrics tab
if (isMobileView()) {
  switchMobileTab('lyrics');
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
  updateSyllableGutter();
  if (rhymeSchemeVisible) updateRhymeSchemeGutter();
}).catch(function onRequiredLoadError(err) {
  statusEl.textContent = 'Failed to load dictionary';
  console.error(err);
});

loadEnglishWords().catch(function onEnglishWordsError(err) {
  console.error(err);
});
