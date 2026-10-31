// Opens the syllable gutter as the page is parsed. app.js adds `visible` at
// the end of the page, and the sheet's margin then eased open from 0 to 40px,
// which moved the whole editor sideways after the first paint. The default
// and the storage key must match app.js.
(function openSyllableGutterEarly() {
  'use strict';

  const SYLLABLES_STORAGE_KEY = 'syllablesVisible';
  const SYLLABLES_OFF_VALUE = '0';
  const GUTTER_ID = 'syllable-gutter';
  const VISIBLE_CLASS = 'visible';

  function isSyllablesOn() {
    try {
      return sessionStorage.getItem(SYLLABLES_STORAGE_KEY) !== SYLLABLES_OFF_VALUE;
    } catch {
      return true;
    }
  }

  const gutter = document.getElementById(GUTTER_ID);
  if (gutter && isSyllablesOn()) gutter.classList.add(VISIBLE_CLASS);
})();
