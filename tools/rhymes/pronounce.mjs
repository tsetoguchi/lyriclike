// Spells a CMU pronunciation in IPA for the rhyme pages, the way a
// learner's dictionary prints it: General American vowels, plain "r" and
// "g", and a stress mark before the syllable that carries the stress.

const VOWELS = {
  AA: 'ɑ', AE: 'æ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', EY: 'eɪ',
  IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u'
};
// These two change with stress: "but" /bʌt/ but "about" /əˈbaʊt/.
const STRESSED_VOWELS = { AH: 'ʌ', ER: 'ɝ' };
const UNSTRESSED_VOWELS = { AH: 'ə', ER: 'ɚ' };
const CONSONANTS = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'g', HH: 'h', JH: 'dʒ',
  K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's',
  SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ'
};
// Consonant clusters English lets a syllable start with. Between two
// vowels, the next syllable takes the longest of these it can, so "extra"
// splits as ek-stra and the stress mark lands before "str".
const ONSET_CLUSTERS = new Set([
  'P L', 'P R', 'B L', 'B R', 'T R', 'T W', 'D R', 'D W', 'K L', 'K R', 'K W',
  'G L', 'G R', 'G W', 'F L', 'F R', 'TH R', 'TH W', 'SH R', 'S P', 'S T',
  'S K', 'S M', 'S N', 'S L', 'S W', 'S F', 'P Y', 'B Y', 'K Y', 'G Y',
  'F Y', 'V Y', 'M Y', 'HH Y', 'S P L', 'S P R', 'S T R', 'S K R', 'S K W',
  'S K L', 'S P Y', 'S K Y'
]);
const PRIMARY_STRESS = '1';
const SECONDARY_STRESS = '2';

function splitPhoneme(phoneme) {
  const match = /^([A-Z]+)([012])?$/.exec(phoneme);
  return { base: match[1], stress: match[2] };
}

function isVowel(phoneme) {
  return splitPhoneme(phoneme).stress !== undefined;
}

function isOnset(consonants) {
  if (consonants.length === 0) return true;
  if (consonants.length === 1) return consonants[0] !== 'NG';
  return ONSET_CLUSTERS.has(consonants.join(' '));
}

// Where the syllable of each vowel begins, as an index into phonemes.
function syllableStarts(phonemes) {
  const vowelAt = phonemes.map((phoneme, i) => (isVowel(phoneme) ? i : -1)).filter((i) => i >= 0);
  return vowelAt.map((vowel, n) => {
    if (n === 0) return 0;
    const between = phonemes.slice(vowelAt[n - 1] + 1, vowel);
    let take = between.length;
    while (!isOnset(between.slice(between.length - take))) take--;
    return vowel - take;
  });
}

function spellPhoneme(phoneme) {
  const { base, stress } = splitPhoneme(phoneme);
  if (stress === undefined) return CONSONANTS[base];
  const stressed = stress === PRIMARY_STRESS || stress === SECONDARY_STRESS;
  return (stressed ? STRESSED_VOWELS[base] : UNSTRESSED_VOWELS[base]) || VOWELS[base];
}

function stressMark(vowel) {
  const { stress } = splitPhoneme(vowel);
  if (stress === PRIMARY_STRESS) return 'ˈ';
  if (stress === SECONDARY_STRESS) return 'ˌ';
  return '';
}

// ["AY0", "D", "IY1", "AH0"] → "aɪˈdiə". A one-syllable word gets no mark.
export function toIpa(phonemes) {
  const starts = syllableStarts(phonemes);
  const vowels = phonemes.filter(isVowel);
  const marks = new Map(starts.length > 1 ? starts.map((start, n) => [start, stressMark(vowels[n])]) : []);
  return phonemes.map((phoneme, i) => (marks.get(i) || '') + spellPhoneme(phoneme)).join('');
}
