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
  // The vowel a rhyme part is split at, which no phoneme list of its own holds.
  const STRESSED_VOWEL_COUNT = 1;
  // Where a word with no frequency rank sorts: behind every word that has one.
  const UNRANKED = Number.POSITIVE_INFINITY;
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
  // Inside a line only an exact match counts: "happy/me" is heard, but
  // "money/feel" and "morning/win" are not.
  const MIN_MARK_CROSS_STRENGTH = RHYME_STRENGTH.perfect;
  const FIRST_LABEL_CODE = 'A'.charCodeAt(0);
  const LABEL_COUNT = 26;
  const UNLABELLED = -1;
  const VOWEL_LETTER_RUNS = /[aeiouy]+/gi;
  // Phones and word processors type ’ for an apostrophe; it has to read as '
  // or "you’re" splits into "you" and "re".
  const CURLY_APOSTROPHES = /[‘’]/g;
  const WORD_RUNS_SOURCE = "[a-zA-Z'‘’]+";

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
    return text.toLowerCase().replace(CURLY_APOSTROPHES, "'").replace(/[^a-z']/g, '');
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

  function filterResults(results, filters) {
    for (const { key } of RHYME_TYPES) {
      results[key] = results[key].filter((word) => isListable(word, filters));
    }
  }

  // filters.englishWords and filters.wordRanks may both be null: the editor
  // searches before those lists have arrived rather than making the writer
  // wait for them.
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
    filterResults(results, filters);
    rankResults(index, target, results, filters.wordRanks);
    return results;
  }

  // ── Result ranking ──

  // Every word in a group already rhymes the same way, so what orders them is
  // how close they land. Plain alphabetical order buried the usable matches
  // under whatever happened to start with an "a".

  function countPartSyllables(part) {
    return part.onset.filter(isVowel).length
      + part.coda.filter(isVowel).length + STRESSED_VOWEL_COUNT;
  }

  function countSharedCodaStart(coda1, coda2) {
    const limit = Math.min(coda1.length, coda2.length);
    let shared = 0;
    while (shared < limit && coda1[shared] === coda2[shared]) shared++;
    return shared;
  }

  function countSharedCodaEnd(coda1, coda2) {
    const limit = Math.min(coda1.length, coda2.length);
    let shared = 0;
    while (shared < limit
      && coda1[coda1.length - shared - 1] === coda2[coda2.length - shared - 1]) shared++;
    return shared;
  }

  // "cast" against "mask" shares the S opening its coda; "night" against
  // "iced" shares the T closing it. Either one is a sound the ear catches.
  function countSharedCoda(coda1, coda2) {
    return Math.max(countSharedCodaStart(coda1, coda2), countSharedCodaEnd(coda1, coda2));
  }

  // The categories treat AA and AO as one vowel, which is what lets "heart"
  // list "sort" as a perfect rhyme. Putting exact matches first keeps "start"
  // and "part" ahead of it without dropping it.
  function compareCloseness(entry1, entry2) {
    if (entry1.vowelMiss !== entry2.vowelMiss) return entry1.vowelMiss - entry2.vowelMiss;
    if (entry1.sharedCoda !== entry2.sharedCoda) return entry2.sharedCoda - entry1.sharedCoda;
    if (entry1.syllableGap !== entry2.syllableGap) return entry1.syllableGap - entry2.syllableGap;
    if (entry1.rank !== entry2.rank) return entry1.rank < entry2.rank ? -1 : 1;
    if (entry1.word.length !== entry2.word.length) return entry1.word.length - entry2.word.length;
    if (entry1.word !== entry2.word) return entry1.word < entry2.word ? -1 : 1;
    return 0;
  }

  // ranks may be null: the editor searches before the word list has arrived,
  // and word length stands in for commonness until it does.
  function toClosenessEntry(context, word) {
    const part = context.index.rhymeIndex[word];
    return {
      word,
      vowelMiss: part.vowel === context.target.vowel ? 0 : 1,
      sharedCoda: countSharedCoda(context.target.coda, part.coda),
      syllableGap: Math.abs(context.targetSyllables - countPartSyllables(part)),
      rank: context.ranks ? context.ranks.get(word) ?? UNRANKED : UNRANKED
    };
  }

  function rankByCloseness(context, words) {
    return words
      .map((word) => toClosenessEntry(context, word))
      .sort(compareCloseness)
      .map((entry) => entry.word);
  }

  function toRankingContext(index, target, ranks) {
    return { index, target, ranks: ranks || null, targetSyllables: countPartSyllables(target) };
  }

  function rankResults(index, target, results, ranks) {
    const context = toRankingContext(index, target, ranks);
    for (const { key } of RHYME_TYPES) {
      results[key] = rankByCloseness(context, results[key]);
    }
  }

  // Exposed for the rhyme-page build, which ranks its own word lists with the
  // order the editor uses rather than one of its own.
  function rankRhymeWords(index, targetWord, words, ranks) {
    if (!hasRhymeEntry(index, targetWord)) return [...words];
    return rankByCloseness(toRankingContext(index, index.rhymeIndex[targetWord], ranks), words);
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

  // Lyrics drop letters the dictionary keeps: "runnin'" is "running", and
  // "'round" is "round". A word in single quotes ('goodnight') reads the same.
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
    if (!word.startsWith("'")) return null;
    return lookupPronunciations(index, word.replace(/^'+/, ''));
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
    const words = stripBrackets(line).match(new RegExp(WORD_RUNS_SOURCE, 'g'));
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

  function countCodaVowels(part) {
    return part.coda.filter(isVowel).length;
  }

  // "yeah/rather" share a vowel, but "-ther" is a whole extra syllable, so
  // the two are not heard as a rhyme; "okay/take" add only a consonant.
  function hasSameTailSyllables(part1, part2) {
    if (!part1 || !part2) return true;
    return countCodaVowels(part1) === countCodaVowels(part2);
  }

  // classifyRhyme() calls "sky" against "night" additive and "night" against
  // "sky" subtractive; whether a pair is marked must not depend on which word
  // the writer happened to use first.
  function scoreRhymeEitherOrder(part1, part2) {
    return Math.max(scoreRhyme(part1, part2), scoreRhyme(part2, part1));
  }

  // An unstressed ending is heard against a stressed word only where it lands
  // on the beat, at the end of its line: "happy" / "me" rhymes, but the
  // "-ery" of a mid-line "every" is just a weak syllable ("every" / "sea").
  function scoreMarkCrossRhyme(parts1, parts2, isEnd1, isEnd2) {
    if (parts1.end && !parts2.end && isEnd1) return scoreRhyme(parts1.end, parts2.stressed);
    if (!parts1.end && parts2.end && isEnd2) return scoreRhyme(parts1.stressed, parts2.end);
    return 0;
  }

  // Ending-against-ending is left out: inside a line, two shared suffixes
  // ("starting"/"staying") are not heard as a rhyme the way two line endings are.
  function scoreStressedPronunciations(parts1, parts2, isEnd1, isEnd2) {
    const stressedScore = hasSameTailSyllables(parts1.stressed, parts2.stressed)
      ? scoreRhymeEitherOrder(parts1.stressed, parts2.stressed) : 0;
    const crossScore = scoreMarkCrossRhyme(parts1, parts2, isEnd1, isEnd2);
    return crossScore >= MIN_MARK_CROSS_STRENGTH
      ? Math.max(stressedScore, crossScore) : stressedScore;
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
    return computeRhymeLabels(index, lines).map(toLabelLetter);
  }

  // The same grouping as numbers, which unlike letters never wrap: the marks
  // pass needs "A" and the 27th group, also printed "A", kept apart.
  function computeRhymeLabels(index, lines) {
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
    return labels;
  }

  // ── Internal rhyme marks ──
  // Marks the rhymes inside a line, not just its last word. Design:
  // plans/internal-rhyme-marks.md; the rules as they now stand:
  // plans/internal-rhyme-rules.md. Called once per stanza, mirroring how the
  // caller already calls computeRhymeScheme() per stanza.

  // Additive (3) and above. Pairs are scored in both orders
  // (scoreRhymeEitherOrder()), so subtractive never decides one; assonance
  // and consonance never qualify.
  const MIN_MARK_STRENGTH = 3;
  // Two words form a family only if their lines are this close; a rhyme
  // thirty lines up is not heard as one.
  const MARK_WINDOW_LINES = 4;
  // Per stanza. Ranked by member count, then by summed strength; the rest
  // still get a mark, in faded ink, rather than being silently dropped.
  const MAX_MARKED_FAMILIES = 4;
  // The page's --scheme-N colours. A floating family never takes a colour an
  // end-rhyme family in the same stanza is already drawn in.
  const MARK_COLOR_COUNT = 10;
  const OVERFLOW_FAMILY = -1;
  // app.js draws no word shorter than this (its MIN_WORD_LENGTH), so a mark on
  // "O" or "u" would leave its partner underlined alone.
  const MIN_MARK_LETTERS = 2;

  // A closed grammatical class, not merely common words: "night" and "love"
  // are common too and must stay markable. Contractions are listed without
  // their apostrophe, except where that spelling is a word of its own ("we'll"
  // is not "well") — see isFunctionWord(). Sung fillers are here too: "yeah"
  // against "there" is not a rhyme anyone wrote.
  const FUNCTION_WORDS = new Set([
    'a', 'an', 'the',
    'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'we', 'us', 'our', 'ours', 'ourselves',
    'they', 'them', 'their', 'theirs', 'themselves',
    'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'what', 'which',
    'when', 'where', 'why', 'how', 'then', 'there', 'here',
    'no', 'not', 'all', 'some', 'any', 'each', 'both', 'just', 'too', 'very',
    'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
    'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to',
    'from', 'up', 'down', 'of', 'off', 'over', 'under', 'again', 'further', 'out',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'if', 'because', 'as', 'than',
    'though', 'while', 'unless', 'until',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'can', 'could',
    'aint', 'cant', 'dont', 'im', 'ill', 'gonna', 'wanna', 'em', 'ya', 'imma',
    'youre', 'theyre', 'ive', 'youve', 'weve', 'theyve', 'id', 'youd', 'hed', 'theyd',
    'youll', 'theyll', 'itll', 'hes', 'shes', 'thats', 'theres', 'whats', 'whos',
    'isnt', 'arent', 'wasnt', 'werent', 'doesnt', 'didnt', 'hasnt', 'havent',
    'wouldnt', 'couldnt', 'shouldnt', 'gotta', 'tryna', 'yall', 'cause', 'cuz', 'til',
    "we'll", "he'll", "she'll", "we'd", "she'd", "won't", "let's",
    'oh', 'ooh', 'ah', 'yeah', 'yea', 'hey', 'whoa', 'woah', 'uh', 'huh',
    'mm', 'hmm', 'na', 'la', 'da', 'ay', 'eh', 'yo'
  ]);

  // Checked as written, for the contractions listed with their apostrophe,
  // then stripped, for the rest ("don't" as "dont", "'cause" as "cause").
  function isFunctionWord(word) {
    return FUNCTION_WORDS.has(word) || FUNCTION_WORDS.has(word.replace(/'/g, ''));
  }

  // A function word only takes a mark as the last word of its line, and only
  // when it rhymes with a word nearby ("drown/around/down"); being grouped
  // with the line by the rhyme scheme alone is not enough, or a line ending
  // "yeah" would be underlined against a scheme letter it barely matches.
  // A word too short to draw may still anchor a family but never takes a mark.
  function isUnmarkable(word, isEarned) {
    return word.length < MIN_MARK_LETTERS || (!isEarned && isFunctionWord(word));
  }

  function isUnmarkableCandidate(candidate) {
    return isUnmarkable(candidate.text, candidate.isEnd && candidate.isLinked);
  }

  function findMaskedRanges(line) {
    const pattern = /\[[^\]]*\]|\([^)]*\)/g;
    const ranges = [];
    let match = pattern.exec(line);
    while (match !== null) {
      ranges.push([match.index, match.index + match[0].length]);
      match = pattern.exec(line);
    }
    return ranges;
  }

  function isMasked(ranges, offset) {
    for (const [start, end] of ranges) {
      if (offset >= start && offset < end) return true;
    }
    return false;
  }

  // Every markable word in a line with its offset, skipping bracketed and
  // parenthesised asides the same way getLastWord() does.
  function tokenizeLine(line) {
    const ranges = findMaskedRanges(line);
    const pattern = new RegExp(WORD_RUNS_SOURCE, 'g');
    const words = [];
    let match = pattern.exec(line);
    while (match !== null) {
      if (!isMasked(ranges, match.index)) {
        words.push({
          start: match.index, end: match.index + match[0].length,
          text: normalizeWord(match[0])
        });
      }
      match = pattern.exec(line);
    }
    return words;
  }

  // Split once per word, not once per pair: the pair loop is what runs on
  // every keystroke.
  function splitCandidatePronunciations(index, word) {
    const pronunciations = lookupPronunciations(index, word);
    return pronunciations ? pronunciations.map(splitPronunciation) : null;
  }

  // One candidate per markable word: every line's last word (however it
  // pronounces, even a function word — it may anchor another word's family,
  // see seedFamilies()), plus every other word that is not unmarkable.
  function collectCandidates(index, lines, labels) {
    const candidates = [];
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const words = tokenizeLine(lines[lineIdx]);
      for (let w = 0; w < words.length; w++) {
        const isEnd = w === words.length - 1;
        if (!isEnd && isUnmarkable(words[w].text, false)) continue;
        const hasLabel = isEnd && labels[lineIdx] !== UNLABELLED;
        const labelIndex = hasLabel ? labels[lineIdx] : null;
        candidates.push({
          lineIdx, start: words[w].start, end: words[w].end, text: words[w].text,
          isEnd, labelIndex, isLinked: false,
          splits: splitCandidatePronunciations(index, words[w].text)
        });
      }
    }
    return candidates;
  }

  // ── Pair tests ──

  // The consonants that open the stressed syllable: L for both "light" and
  // "delight", S T for both "stand" and "understand".
  function stressedOnsetCluster(part) {
    let start = part.onset.length;
    while (start > 0 && !isVowel(part.onset[start - 1])) start--;
    return part.onset.slice(start).join(' ');
  }

  function hasSameStressedOpening(part1, part2) {
    if (!part1 || !part2) return false;
    return vowelsMatch(part1.vowel, part2.vowel)
      && stressedOnsetCluster(part1) === stressedOnsetCluster(part2);
  }

  // The same word twice is a refrain, and so is the same stressed syllable
  // under a prefix or suffix ("way/away", "night/tonight", "keep/keeps") —
  // the call classifyRhyme() already makes for "knight/night".
  function isRepeat(a, b) {
    if (a.text === b.text) return true;
    if (!a.splits || !b.splits) return false;
    return a.splits.some((split1) => b.splits.some(
      (split2) => hasSameStressedOpening(split1.stressed, split2.stressed)));
  }

  // The strongest pairing of one pronunciation of each word, with which ones.
  function bestPronunciationMatch(a, b) {
    let best = { strength: 0, first: NOT_FOUND, second: NOT_FOUND };
    a.splits.forEach((split1, first) => {
      b.splits.forEach((split2, second) => {
        const strength = scoreStressedPronunciations(split1, split2, a.isEnd, b.isEnd);
        if (strength > best.strength) best = { strength, first, second };
      });
    });
    return best;
  }

  // null when the pair does not rhyme well enough to mark; otherwise the
  // match, whose strength feeds the ranking in assignFloatingColors().
  function findMarkableMatch(a, b) {
    if (!a.splits || !b.splits) return null;
    const match = bestPronunciationMatch(a, b);
    return match.strength >= MIN_MARK_STRENGTH ? match : null;
  }

  // Words further apart than the window are never compared, so they are
  // neither a rhyme nor a clash.
  function isWithinWindow(a, b) {
    return Math.abs(a.lineIdx - b.lineIdx) <= MARK_WINDOW_LINES;
  }

  // Whether two words may sit in one family: they rhyme, or they are a repeat
  // of one another (which never counts as a clash), or they are too far apart
  // to be heard together.
  function isCompatible(a, b) {
    return !isWithinWindow(a, b) || isRepeat(a, b) || findMarkableMatch(a, b) !== null;
  }

  // ── Families: union-find over candidates ──

  function find(parent, i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function joinRoots(families, rootA, rootB) {
    families.parent[rootA] = rootB;
    families.members.get(rootB).push(...families.members.get(rootA));
    families.members.delete(rootA);
    const anchorA = families.anchorOf.get(rootA);
    if (anchorA === undefined) return;
    families.anchorOf.set(rootB, anchorA);
    families.anchorOf.delete(rootA);
  }

  // Lines sharing a scheme letter start already joined, each family carrying
  // that letter's index as its anchor. computeRhymeLabels() is called
  // unchanged for this, so turning marks on never moves a letter.
  function seedFamilies(candidates) {
    const families = {
      parent: candidates.map((_, i) => i),
      members: new Map(candidates.map((_, i) => [i, [i]])),
      anchorOf: new Map()
    };
    const firstWithLabel = new Map();
    candidates.forEach(({ labelIndex }, i) => {
      if (labelIndex === null) return;
      if (!firstWithLabel.has(labelIndex)) firstWithLabel.set(labelIndex, i);
      const root = find(families.parent, firstWithLabel.get(labelIndex));
      if (root !== i) joinRoots(families, i, root);
      families.anchorOf.set(root, labelIndex);
    });
    return families;
  }

  // A word bridging two different end-rhyme families would make the gutter
  // and the underlines disagree about which lines rhyme.
  function hasConflictingAnchors(families, rootA, rootB) {
    const anchorA = families.anchorOf.get(rootA);
    const anchorB = families.anchorOf.get(rootB);
    return anchorA !== undefined && anchorB !== undefined && anchorA !== anchorB;
  }

  // Chaining is transitive but rhyme is not: way ~ paint and way ~ shade are
  // each a rhyme, paint ~ shade is only assonance. A family is only ever
  // joined to another when every word in one that is close enough to be heard
  // with a word in the other also rhymes with it.
  function areFamiliesCompatible(candidates, membersA, membersB) {
    for (const i of membersA) {
      for (const j of membersB) {
        if (!isCompatible(candidates[i], candidates[j])) return false;
      }
    }
    return true;
  }

  // True when a and b end up in one family, whether or not this call joined them.
  function tryLink(families, candidates, a, b) {
    const rootA = find(families.parent, a);
    const rootB = find(families.parent, b);
    if (rootA === rootB) return true;
    if (hasConflictingAnchors(families, rootA, rootB)) return false;
    const membersA = families.members.get(rootA);
    const membersB = families.members.get(rootB);
    if (!areFamiliesCompatible(candidates, membersA, membersB)) return false;
    joinRoots(families, rootA, rootB);
    return true;
  }

  // A word is said one way, so once it links it keeps that pronunciation —
  // otherwise "re" (ray/ree) would join "say" and "feel" into one family.
  function pinPronunciations(a, b, match) {
    a.splits = [a.splits[match.first]];
    b.splits = [b.splits[match.second]];
  }

  function linkPair(families, candidates, i, j, linkStrength) {
    const a = candidates[i];
    const b = candidates[j];
    const match = findMarkableMatch(a, b);
    if (!match || !tryLink(families, candidates, i, j)) return;
    pinPronunciations(a, b, match);
    a.isLinked = true;
    b.isLinked = true;
    linkStrength[i] = Math.max(linkStrength[i], match.strength);
    linkStrength[j] = Math.max(linkStrength[j], match.strength);
  }

  // Candidates are in line order, so once a pair is further apart than the
  // window every later pair started from the same left side is too.
  function collectMarkablePairs(candidates) {
    const pairs = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (candidates[j].lineIdx - candidates[i].lineIdx > MARK_WINDOW_LINES) break;
        if (isRepeat(candidates[i], candidates[j])) continue;
        const match = findMarkableMatch(candidates[i], candidates[j]);
        if (!match) continue;
        pairs.push({
          i, j, strength: match.strength,
          distance: candidates[j].lineIdx - candidates[i].lineIdx
        });
      }
    }
    return pairs;
  }

  // Strongest rhymes first, then nearest: when a family would have to give up
  // a word to stay consistent, it is the one with the weaker or further link.
  // Array.sort is stable, so equal pairs stay in the order they were read.
  function linkCandidates(candidates, families, linkStrength) {
    const pairs = collectMarkablePairs(candidates)
      .sort((p, q) => q.strength - p.strength || p.distance - q.distance);
    for (const { i, j } of pairs) linkPair(families, candidates, i, j, linkStrength);
  }

  // ── Colours and projection ──

  // A word that can't be marked doesn't count as something to rhyme with — a
  // word whose only partner in the group is a one-letter word is not marked,
  // even though that word may still sit in the group as its anchor. So a
  // group needs at least two distinct markable words to be a family.
  function groupQualifies(members, candidates) {
    const texts = new Set();
    for (const i of members) {
      const c = candidates[i];
      if (!isUnmarkableCandidate(c)) texts.add(c.text);
    }
    return texts.size >= 2;
  }

  function groupFirstAppearance(members, candidates) {
    let best = null;
    for (const i of members) {
      const c = candidates[i];
      if (!best || c.lineIdx < best.lineIdx || (c.lineIdx === best.lineIdx && c.start < best.start)) {
        best = c;
      }
    }
    return best;
  }

  // The smallest colour not already drawn by a *marked* end-rhyme family. A
  // pass-1 label that never turns into a mark (a lone line ending nothing
  // else rhymes with) reserves nothing, which is what keeps floating
  // families' colours from shifting every time an unrelated line is appended.
  // With every colour spoken for, the family is marked as overflow.
  function nextAvailableColorIndex(usedColors, taken) {
    for (let i = 0; i < MARK_COLOR_COUNT; i++) {
      if (usedColors.has(i) || taken.has(i)) continue;
      taken.add(i);
      return i;
    }
    return OVERFLOW_FAMILY;
  }

  // Rank decides which floating families get a colour at all; it does not
  // decide which colour. A family growing by one word could otherwise
  // overtake its neighbour and swap two colours across the whole stanza.
  function assignFloatingColors(floatingGroups, usedColors) {
    const ranked = floatingGroups.slice().sort((a, b) => {
      if (b.rank.memberCount !== a.rank.memberCount) return b.rank.memberCount - a.rank.memberCount;
      return b.rank.summedStrength - a.rank.summedStrength;
    });
    const coloured = ranked.slice(0, MAX_MARKED_FAMILIES);
    const overflow = ranked.slice(MAX_MARKED_FAMILIES);

    const taken = new Set();
    coloured
      .slice()
      .sort((a, b) => a.firstAppearance.lineIdx - b.firstAppearance.lineIdx
        || a.firstAppearance.start - b.firstAppearance.start)
      .forEach((group) => {
        group.family = nextAvailableColorIndex(usedColors, taken);
      });

    overflow.forEach((group) => { group.family = OVERFLOW_FAMILY; });
  }

  // How well a word rhymes with the least good match among the family words it
  // is heard against — a repeat of its own sound does not count. A word with
  // no such partner in range keeps the strength it was linked with.
  function weakestLinkStrength(i, members, candidates, linkStrength) {
    const word = candidates[i];
    let weakest = Infinity;
    for (const j of members) {
      const other = candidates[j];
      if (j === i || !word.splits || !other.splits) continue;
      if (!isWithinWindow(word, other) || isRepeat(word, other)) continue;
      weakest = Math.min(weakest, bestPronunciationMatch(word, other).strength);
    }
    return weakest === Infinity ? linkStrength[i] : weakest;
  }

  // Unmarkable words never take a mark, even as a family's largest member —
  // they may still anchor the family (seedFamilies()) so the words that do
  // rhyme with them keep the right colour. A mark is slant unless the word
  // rhymes perfectly with everything it is heard against.
  function projectGroup(members, candidates, family, linkStrength, marks) {
    for (const i of members) {
      const c = candidates[i];
      if (isUnmarkableCandidate(c)) continue;
      const isSlant = weakestLinkStrength(i, members, candidates, linkStrength) < RHYME_STRENGTH.perfect;
      marks[c.lineIdx].push({ start: c.start, end: c.end, family, isSlant });
    }
  }

  function assignAndProjectMarks(candidates, families, linkStrength, marks) {
    const floatingGroups = [];
    const usedColors = new Set();
    const anchoredQualifying = [];
    for (const [root, members] of families.members) {
      if (!groupQualifies(members, candidates)) continue;
      const anchorLabel = families.anchorOf.get(root);
      if (anchorLabel !== undefined) {
        usedColors.add(anchorLabel % MARK_COLOR_COUNT);
        anchoredQualifying.push({ members, anchorLabel });
        continue;
      }
      const summedStrength = members.reduce((sum, i) => sum + linkStrength[i], 0);
      floatingGroups.push({
        members,
        rank: { memberCount: members.length, summedStrength },
        firstAppearance: groupFirstAppearance(members, candidates)
      });
    }
    for (const { members, anchorLabel } of anchoredQualifying) {
      projectGroup(members, candidates, anchorLabel, linkStrength, marks);
    }
    assignFloatingColors(floatingGroups, usedColors);
    for (const group of floatingGroups) {
      projectGroup(group.members, candidates, group.family, linkStrength, marks);
    }
  }

  // Lines in, marks out ({ start, end, family, isSlant }: isSlant when the word
  // does not rhyme perfectly with every word it is heard against). Offsets are
  // within their line; the caller knows where its lines start. Pass 1 is the rhyme scheme, unchanged, which both
  // supplies the returned labels and seeds the families pass 2 grows from —
  // see seedFamilies() and tryLink(). A mark's family is its own number, which
  // can run past MARK_COLOR_COUNT for end-rhyme families; the page wraps it
  // onto its colours the way the gutter does.
  function groupRhymeMarks(index, lines) {
    const labels = computeRhymeLabels(index, lines);
    const candidates = collectCandidates(index, lines, labels);
    const families = seedFamilies(candidates);
    const linkStrength = new Array(candidates.length).fill(0);
    linkCandidates(candidates, families, linkStrength);
    const marks = lines.map(() => []);
    assignAndProjectMarks(candidates, families, linkStrength, marks);
    return { labels: labels.map(toLabelLetter), marks };
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
    rankRhymeWords,
    countSyllables,
    getStressedSyllable,
    countSyllablesForLine,
    computeRhymeScheme,
    groupRhymeMarks,
    FUNCTION_WORDS,
    OVERFLOW_FAMILY
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = RhymeCore;
  } else {
    root.RhymeCore = RhymeCore;
  }
})(this);
