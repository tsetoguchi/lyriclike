// The verse a first-time visitor sees in the editor. A separate file so the
// guide's test can load it: storage.js touches the page as soon as it runs.
(function defineSampleVerse(root) {
  'use strict';

  // ABAB, so the letters show the pattern.
  const SAMPLE_VERSE = [
    'I left the porch light on for you',
    'The way I did the year before',
    'The tea is cold, the sky is blue',
    'And still I listen for the door',
  ].join('\n');
  // The word the rhymes panel opens on: the first line's last word.
  const SAMPLE_PICKED_WORD = 'you';

  const sampleVerse = { SAMPLE_VERSE, SAMPLE_PICKED_WORD };

  if (typeof module === 'object' && module.exports) {
    module.exports = sampleVerse;
  } else {
    root.SAMPLE_VERSE = SAMPLE_VERSE;
    root.SAMPLE_PICKED_WORD = SAMPLE_PICKED_WORD;
  }
})(this);
