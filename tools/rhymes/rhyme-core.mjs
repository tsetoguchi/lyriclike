// Rhyme detection for the static rhyme pages, ported from app.js
// (phoneme helpers through findRhymes). app.js is deliberately left untouched
// for now, so the two copies must agree: check-parity.mjs runs both against
// the same words and fails on any difference. Change them together.

const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'
]);
const PLOSIVES = new Set(['B', 'D', 'G', 'P', 'T', 'K']);
const FRICATIVES = new Set(['V', 'DH', 'Z', 'ZH', 'JH', 'F', 'TH', 'S', 'SH', 'CH']);
const NASALS = new Set(['M', 'N', 'NG']);
const PRIMARY_STRESS = 1;

export const RHYME_TYPES = [
  { key: 'perfect', name: 'Perfect', desc: 'Same vowel and ending consonants' },
  { key: 'family', name: 'Family', desc: 'Same vowel, ending consonants in same phonetic family' },
  { key: 'additive', name: 'Additive', desc: 'Same vowel, candidate adds extra consonants' },
  { key: 'subtractive', name: 'Subtractive', desc: 'Same vowel, candidate has fewer consonants' },
  { key: 'assonance', name: 'Assonance', desc: 'Same vowel, unrelated ending consonants' },
  { key: 'consonance', name: 'Consonance', desc: 'Different vowel, same ending consonants' }
];

// ── Phoneme helpers ──

function getFamily(consonant) {
  if (PLOSIVES.has(consonant)) return 'plosive';
  if (FRICATIVES.has(consonant)) return 'fricative';
  if (NASALS.has(consonant)) return 'nasal';
  return null;
}

function stripStress(phoneme) {
  return phoneme.replace(/[012]$/, '');
}

export function isVowel(phoneme) {
  return VOWELS.has(stripStress(phoneme));
}

function vowelsMatch(vowel1, vowel2) {
  if (vowel1 === vowel2) return true;
  // Cot-caught merger: AA (got/hot) ≈ AO (lost/caught)
  return (vowel1 === 'AA' || vowel1 === 'AO') && (vowel2 === 'AA' || vowel2 === 'AO');
}

function getStress(phoneme) {
  const match = phoneme.match(/([012])$/);
  return match ? parseInt(match[1], 10) : -1;
}

// ── Rhyme part extraction ──

function findStressedVowelIndex(phonemes) {
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowel(phonemes[i]) && getStress(phonemes[i]) === PRIMARY_STRESS) return i;
  }
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowel(phonemes[i])) return i;
  }
  return -1;
}

function extractRhymePart(phonemes) {
  if (!Array.isArray(phonemes) || phonemes.length === 0) return null;
  const idx = findStressedVowelIndex(phonemes);
  if (idx === -1) return null;
  return {
    onset: phonemes.slice(0, idx).map(stripStress),
    vowel: stripStress(phonemes[idx]),
    coda: phonemes.slice(idx + 1).map(stripStress)
  };
}

// ── Coda comparison helpers ──

function checkFamilyCoda(coda1, coda2) {
  if (coda1.length === 0 || coda2.length === 0) return false;
  if (coda1.length !== coda2.length) return false;
  let hasFamilySwap = false;
  for (let i = 0; i < coda1.length; i++) {
    if (coda1[i] === coda2[i]) continue;
    const family1 = getFamily(coda1[i]);
    if (family1 === null || family1 !== getFamily(coda2[i])) return false;
    hasFamilySwap = true;
  }
  return hasFamilySwap;
}

function checkCodaContains(longer, shorter) {
  if (shorter.length === 0) return true;
  const longerStr = longer.join(' ');
  const shorterStr = shorter.join(' ');
  const prefixMatch = longerStr.startsWith(shorterStr)
    && (longerStr.length === shorterStr.length || longerStr[shorterStr.length] === ' ');
  if (prefixMatch) return true;
  return longerStr.endsWith(shorterStr)
    && (longerStr.length === shorterStr.length
      || longerStr[longerStr.length - shorterStr.length - 1] === ' ');
}

// ── Rhyme classification ──

function classifyRhyme(target, candidate) {
  if (!target || !candidate) return null;
  const exactVowelMatch = target.vowel === candidate.vowel;
  const sameVowel = exactVowelMatch || vowelsMatch(target.vowel, candidate.vowel);
  const sameCoda = target.coda.join(' ') === candidate.coda.join(' ');
  const sameOnset = target.onset.join(' ') === candidate.onset.join(' ');

  if (sameVowel && sameCoda && !sameOnset) return 'perfect';
  if (sameVowel && !sameCoda && !sameOnset && checkFamilyCoda(target.coda, candidate.coda)) {
    return 'family';
  }
  if (sameVowel && !sameCoda) {
    const candidateLonger = candidate.coda.length > target.coda.length;
    const targetLonger = target.coda.length > candidate.coda.length;
    if (candidateLonger && checkCodaContains(candidate.coda, target.coda)) return 'additive';
    if (targetLonger && checkCodaContains(target.coda, candidate.coda)) return 'subtractive';
  }
  // Assonance requires exact vowel match — merged vowels (AA/AO) need coda
  // evidence from stronger categories above to avoid false positives
  if (exactVowelMatch && !sameCoda) return 'assonance';
  if (!sameVowel && sameCoda && target.coda.length > 0) return 'consonance';
  return null;
}

// ── Index ──

function pushToBucket(buckets, key, word) {
  if (!buckets[key]) buckets[key] = [];
  buckets[key].push(word);
}

function indexWord(index, word) {
  const rhymePart = extractRhymePart(index.dictionary[word][0]);
  if (!rhymePart) return;
  index.rhymeIndex[word] = rhymePart;
  pushToBucket(index.vowelBuckets, rhymePart.vowel, word);
  if (rhymePart.vowel === 'AA') pushToBucket(index.vowelBuckets, 'AO', word);
  if (rhymePart.vowel === 'AO') pushToBucket(index.vowelBuckets, 'AA', word);
  if (rhymePart.coda.length > 0) pushToBucket(index.codaBuckets, rhymePart.coda.join(' '), word);
}

export function buildRhymeIndex(dictionary) {
  const index = { dictionary, rhymeIndex: {}, vowelBuckets: {}, codaBuckets: {} };
  for (const word of Object.keys(dictionary)) indexWord(index, word);
  return index;
}

export function hasRhymeEntry(index, word) {
  return Object.hasOwn(index.rhymeIndex, word);
}

// ── Rhyme search ──

function classifyBucket(index, target, words, seen, results) {
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    const type = classifyRhyme(target, index.rhymeIndex[word]);
    if (type) results[type].push(word);
  }
}

function filterAndSort(results, filters) {
  for (const { key } of RHYME_TYPES) {
    results[key] = results[key]
      .filter((word) => filters.englishWords.has(word) && !filters.blocklist.has(word))
      .sort();
  }
}

export function findRhymes(index, targetWord, filters) {
  if (!hasRhymeEntry(index, targetWord)) return null;
  const target = index.rhymeIndex[targetWord];
  const results = Object.fromEntries(RHYME_TYPES.map(({ key }) => [key, []]));
  const seen = new Set([targetWord]);

  classifyBucket(index, target, index.vowelBuckets[target.vowel] || [], seen, results);
  if (target.coda.length > 0) {
    const codaWords = index.codaBuckets[target.coda.join(' ')] || [];
    classifyBucket(index, target, codaWords, seen, results);
  }
  filterAndSort(results, filters);
  return results;
}

// ── Pronunciation facts ──

export function getPronunciation(index, word) {
  return index.dictionary[word][0];
}

export function countSyllables(index, word) {
  return getPronunciation(index, word).filter(isVowel).length;
}

// Which syllable carries the stress, counting from 1.
export function getStressedSyllable(index, word) {
  const phonemes = getPronunciation(index, word);
  const stressedIdx = findStressedVowelIndex(phonemes);
  return phonemes.slice(0, stressedIdx + 1).filter(isVowel).length;
}
