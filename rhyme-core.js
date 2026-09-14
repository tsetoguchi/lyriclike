// Rhyme detection shared by the editor and the rhyme-page build. The browser
// loads this as a plain script before app.js and reads window.RhymeCore; Node
// loads it with require. Nothing here touches the page, so all of it is covered
// by the tests in test/.
(function exposeRhymeCore(root) {
  'use strict';

  const VOWELS = new Set([
    'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER',
    'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'
  ]);
  const PLOSIVES = new Set(['B', 'D', 'G', 'P', 'T', 'K']);
  const FRICATIVES = new Set(['V', 'DH', 'Z', 'ZH', 'JH', 'F', 'TH', 'S', 'SH', 'CH']);
  const NASALS = new Set(['M', 'N', 'NG']);
  // Cot-caught merger: AA (got/hot) ≈ AO (lost/caught)
  const MERGED_VOWELS = new Map([['AA', 'AO'], ['AO', 'AA']]);
  const PRIMARY_STRESS = 1;
  const NO_STRESS_MARK = -1;
  const NOT_FOUND = -1;

  const RHYME_TYPES = [
    { key: 'perfect', name: 'Perfect', desc: 'Same vowel and ending consonants' },
    {
      key: 'family', name: 'Family',
      desc: 'Same vowel, ending consonants in same phonetic family'
    },
    {
      key: 'additive', name: 'Additive',
      desc: 'Same vowel, candidate adds extra consonants'
    },
    {
      key: 'subtractive', name: 'Subtractive',
      desc: 'Same vowel, candidate has fewer consonants'
    },
    {
      key: 'assonance', name: 'Assonance',
      desc: 'Same vowel, unrelated ending consonants'
    },
    {
      key: 'consonance', name: 'Consonance',
      desc: 'Different vowel, same ending consonants'
    }
  ];

  // Consonance is too loose to tie two lines together, so it scores nothing.
  const RHYME_STRENGTH = { perfect: 5, family: 4, additive: 3, subtractive: 2, assonance: 1 };
  const SAME_WORD_STRENGTH = 6;
  // A word's unstressed ending against another's stressed syllable is weaker
  // evidence, so assonance alone does not pair the lines.
  const MIN_CROSS_STRENGTH = 2;
  const FIRST_LABEL_CODE = 'A'.charCodeAt(0);
  const LABEL_COUNT = 26;
  const UNLABELLED = -1;
  const VOWEL_LETTER_RUNS = /[aeiouy]+/gi;

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

  function isVowel(phoneme) {
    return VOWELS.has(stripStress(phoneme));
  }

  function vowelsMatch(vowel1, vowel2) {
    return vowel1 === vowel2 || MERGED_VOWELS.get(vowel1) === vowel2;
  }

  function getStress(phoneme) {
    const match = phoneme.match(/([012])$/);
    return match ? parseInt(match[1], 10) : NO_STRESS_MARK;
  }

  // ── Rhyme part extraction ──

  function findStressedVowelIndex(phonemes) {
    for (let i = phonemes.length - 1; i >= 0; i--) {
      if (isVowel(phonemes[i]) && getStress(phonemes[i]) === PRIMARY_STRESS) return i;
    }
    return findLastVowelIndex(phonemes);
  }

  function findLastVowelIndex(phonemes) {
    for (let i = phonemes.length - 1; i >= 0; i--) {
      if (isVowel(phonemes[i])) return i;
    }
    return NOT_FOUND;
  }

  function splitAtVowel(phonemes, vowelIdx) {
    return {
      onset: phonemes.slice(0, vowelIdx).map(stripStress),
      vowel: stripStress(phonemes[vowelIdx]),
      coda: phonemes.slice(vowelIdx + 1).map(stripStress)
    };
  }

  function extractRhymePart(phonemes) {
    if (!Array.isArray(phonemes) || phonemes.length === 0) return null;
    const vowelIdx = findStressedVowelIndex(phonemes);
    return vowelIdx === NOT_FOUND ? null : splitAtVowel(phonemes, vowelIdx);
  }

  // The final syllable when it is not the stressed one. "happy" ends on an
  // unstressed "-py", which is what lets it rhyme with "me".
  function extractEndRhymePart(phonemes) {
    if (!Array.isArray(phonemes) || phonemes.length === 0) return null;
    const lastVowelIdx = findLastVowelIndex(phonemes);
    if (lastVowelIdx === NOT_FOUND) return null;
    if (lastVowelIdx === findStressedVowelIndex(phonemes)) return null;
    return splitAtVowel(phonemes, lastVowelIdx);
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
    if (MERGED_VOWELS.has(rhymePart.vowel)) {
      pushToBucket(index.vowelBuckets, MERGED_VOWELS.get(rhymePart.vowel), word);
    }
    if (rhymePart.coda.length > 0) {
      pushToBucket(index.codaBuckets, rhymePart.coda.join(' '), word);
    }
  }

  function buildRhymeIndex(dictionary) {
    const index = { dictionary, rhymeIndex: {}, vowelBuckets: {}, codaBuckets: {} };
    for (const word of Object.keys(dictionary)) indexWord(index, word);
    return index;
  }

  // Object.hasOwn is newer than some iPhones still in use.
  function hasOwnKey(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function hasRhymeEntry(index, word) {
    return hasOwnKey(index.rhymeIndex, word);
  }

  // ── Rhyme search ──

  function normalizeWord(text) {
    return text.toLowerCase().replace(/[^a-z']/g, '');
  }

  function classifyBucket(index, target, words, seen, results) {
    for (const word of words) {
      if (seen.has(word)) continue;
      seen.add(word);
      const type = classifyRhyme(target, index.rhymeIndex[word]);
      if (type) results[type].push(word);
    }
  }

  function isListable(word, filters) {
    if (filters.blocklist.has(word)) return false;
    return !filters.englishWords || filters.englishWords.has(word);
  }

  function filterAndSort(results, filters) {
    for (const { key } of RHYME_TYPES) {
      results[key] = results[key].filter((word) => isListable(word, filters)).sort();
    }
  }

  // filters.englishWords may be null: the editor searches before that list has
  // arrived rather than making the writer wait for it.
  function findRhymes(index, targetWord, filters) {
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

  function hasPronunciation(index, word) {
    return hasOwnKey(index.dictionary, word);
  }

  function getPronunciation(index, word) {
    return index.dictionary[word][0];
  }

  function countSyllables(index, word) {
    return getPronunciation(index, word).filter(isVowel).length;
  }

  // Which syllable carries the stress, counting from 1.
  function getStressedSyllable(index, word) {
    const phonemes = getPronunciation(index, word);
    const stressedIdx = findStressedVowelIndex(phonemes);
    return phonemes.slice(0, stressedIdx + 1).filter(isVowel).length;
  }

  // Lyrics drop letters the dictionary keeps: "runnin'" is "running".
  function lookupPronunciations(index, word) {
    if (hasPronunciation(index, word)) return index.dictionary[word];
    if (word.endsWith("in'")) {
      const expanded = word.slice(0, -3) + 'ing';
      if (hasPronunciation(index, expanded)) return index.dictionary[expanded];
    }
    if (word.endsWith("'")) {
      const trimmed = word.slice(0, -1);
      if (hasPronunciation(index, trimmed)) return index.dictionary[trimmed];
    }
    return null;
  }

  // ── Syllable counting ──

  function stripBrackets(text) {
    return text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');
  }

  function guessSyllables(word) {
    const vowelRuns = word.match(VOWEL_LETTER_RUNS);
    return vowelRuns ? vowelRuns.length : 1;
  }

  function countWordSyllables(index, word) {
    const dictCount = index && hasPronunciation(index, word) ? countSyllables(index, word) : 0;
    return dictCount > 0 ? dictCount : guessSyllables(word);
  }

  // index may be null while the dictionary loads; every word is guessed then.
  function countSyllablesForLine(index, line) {
    if (typeof line !== 'string') return 0;
    let total = 0;
    for (const token of stripBrackets(line).split(/\s+/)) {
      const word = normalizeWord(token);
      if (word.length > 0) total += countWordSyllables(index, word);
    }
    return total;
  }

  // ── Rhyme scheme ──

  function getLastWord(line) {
    const words = stripBrackets(line).match(/[a-zA-Z']+/g);
    return words ? normalizeWord(words[words.length - 1]) : '';
  }

  function listRhymeParts(pronunciations) {
    const parts = [];
    for (const phonemes of pronunciations) {
      const stressed = extractRhymePart(phonemes);
      const end = extractEndRhymePart(phonemes);
      if (stressed) parts.push(stressed);
      if (end) parts.push(end);
    }
    return parts;
  }

  function scoreRhyme(part1, part2) {
    const type = classifyRhyme(part1, part2);
    return type ? RHYME_STRENGTH[type] || 0 : 0;
  }

  // Only when exactly one word has an unstressed ending: "happy" against "me".
  function scoreCrossRhyme(parts1, parts2) {
    if (parts1.end && !parts2.end) return scoreRhyme(parts1.end, parts2.stressed);
    if (!parts1.end && parts2.end) return scoreRhyme(parts1.stressed, parts2.end);
    return 0;
  }

  function scorePronunciations(parts1, parts2) {
    const sameTypeScore = Math.max(
      scoreRhyme(parts1.stressed, parts2.stressed),
      scoreRhyme(parts1.end, parts2.end)
    );
    const crossScore = scoreCrossRhyme(parts1, parts2);
    return crossScore >= MIN_CROSS_STRENGTH ? Math.max(sameTypeScore, crossScore) : sameTypeScore;
  }

  function splitPronunciation(phonemes) {
    return { stressed: extractRhymePart(phonemes), end: extractEndRhymePart(phonemes) };
  }

  function bestRhymeStrength(index, word1, word2) {
    if (!word1 || !word2) return 0;
    if (word1 === word2) return SAME_WORD_STRENGTH;
    const entries1 = lookupPronunciations(index, word1);
    const entries2 = lookupPronunciations(index, word2);
    if (!entries1 || !entries2) return 0;
    const splits2 = entries2.map(splitPronunciation);
    let best = 0;
    for (const phonemes of entries1) {
      const split1 = splitPronunciation(phonemes);
      for (const split2 of splits2) best = Math.max(best, scorePronunciations(split1, split2));
    }
    return best;
  }

  function candidateVowels(vowel) {
    return MERGED_VOWELS.has(vowel) ? [vowel, MERGED_VOWELS.get(vowel)] : [vowel];
  }

  function collectRhymeVowels(pronunciations) {
    const vowels = [];
    for (const part of listRhymeParts(pronunciations)) {
      if (!vowels.includes(part.vowel)) vowels.push(part.vowel);
    }
    return vowels;
  }

  // A later line only takes the group over when it rhymes strictly better, so
  // ties go to the line heard first.
  function pickStrongerEnding(index, word, candidates, best) {
    let stronger = best;
    for (const candidate of candidates) {
      const strength = bestRhymeStrength(index, word, candidate.word);
      if (strength > stronger.strength) stronger = { strength, label: candidate.label };
    }
    return stronger;
  }

  function findBestLabel(index, word, pronunciations, earlierEndings) {
    let best = { strength: 0, label: UNLABELLED };
    for (const vowel of collectRhymeVowels(pronunciations)) {
      for (const bucketVowel of candidateVowels(vowel)) {
        const candidates = earlierEndings.get(bucketVowel) || [];
        best = pickStrongerEnding(index, word, candidates, best);
      }
    }
    return best.label;
  }

  function recordEnding(earlierEndings, pronunciations, ending) {
    for (const part of listRhymeParts(pronunciations)) {
      if (!earlierEndings.has(part.vowel)) earlierEndings.set(part.vowel, []);
      earlierEndings.get(part.vowel).push(ending);
    }
  }

  function toLabelLetter(label) {
    if (label === UNLABELLED) return '';
    return String.fromCharCode(FIRST_LABEL_CODE + (label % LABEL_COUNT));
  }

  // One letter per line ("A", "B", ...) grouping lines whose last words rhyme;
  // lines with no word get ''. Words the dictionary lacks start a new group.
  function computeRhymeScheme(index, lines) {
    const earlierEndings = new Map();
    const labels = [];
    let nextLabel = 0;
    for (const line of lines) {
      const word = getLastWord(line);
      if (!word) {
        labels.push(UNLABELLED);
        continue;
      }
      const pronunciations = lookupPronunciations(index, word) || [];
      const matched = findBestLabel(index, word, pronunciations, earlierEndings);
      const label = matched === UNLABELLED ? nextLabel++ : matched;
      labels.push(label);
      recordEnding(earlierEndings, pronunciations, { word, label });
    }
    return labels.map(toLabelLetter);
  }

  const RhymeCore = {
    RHYME_TYPES,
    normalizeWord,
    extractRhymePart,
    extractEndRhymePart,
    classifyRhyme,
    buildRhymeIndex,
    hasRhymeEntry,
    findRhymes,
    countSyllables,
    getStressedSyllable,
    countSyllablesForLine,
    computeRhymeScheme
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = RhymeCore;
  } else {
    root.RhymeCore = RhymeCore;
  }
})(this);
