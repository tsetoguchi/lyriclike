// Marks a first visit before the first paint so the strip the sample verse
// uses is already held open. storage.js shows the sample at the end of the
// page, and adding the strip then pushed the editor down. The test mirrors
// isFirstVisit and the linked-word check in storage.js's startEditor.
(function reserveSampleSpace() {
  'use strict';

  const DRAFT_STORAGE_KEY = 'swag_draft';
  const SAMPLE_SEEN_KEY = 'sample_seen';
  const LINKED_WORD_PARAM = 'rhymes';
  const EXPECTS_SAMPLE_CLASS = 'expects-sample';

  function isFirstVisit() {
    try {
      return localStorage.getItem(DRAFT_STORAGE_KEY) === null
        && localStorage.getItem(SAMPLE_SEEN_KEY) === null;
    } catch {
      return false;
    }
  }

  function hasLinkedWord() {
    return new URLSearchParams(window.location.search).has(LINKED_WORD_PARAM);
  }

  if (isFirstVisit() && !hasLinkedWord()) {
    document.body.classList.add(EXPECTS_SAMPLE_CLASS);
  }
})();
