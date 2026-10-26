// Once a signed-out writer has a few lines of their own, one quiet line under
// the title says where the page lives and how to keep it. It shows once per
// device and never blocks the pad. storage.js owns the notice strip and
// auth.js the sign-in box; this file only decides when to ask.
(function defineSaveNudge() {
  'use strict';

  const NUDGE_SEEN_KEY = 'save_nudge_seen';
  // Enough to be writing something, not just trying the editor out.
  const LINES_BEFORE_NUDGE = 3;
  const NUDGE_TEXT = 'This page is only saved in this browser. '
    + 'Sign up free and it goes in your notebook, on any device.';
  const NUDGE_ACTION = 'Keep this page';
  const SIGN_IN_ENTRY = 'save_nudge';

  const lyricsEl = document.getElementById('lyrics');
  const noticeEl = document.getElementById('page-notice');

  // Storage that cannot be read counts as seen, so nobody is asked on every
  // keystroke.
  function hasSeenNudge() {
    try {
      return localStorage.getItem(NUDGE_SEEN_KEY) !== null;
    } catch {
      return true;
    }
  }

  function markNudgeSeen() {
    try { localStorage.setItem(NUDGE_SEEN_KEY, '1'); } catch {}
  }

  function countWrittenLines(text) {
    return text.split('\n').filter((line) => line.trim() !== '').length;
  }

  // currentUser is undefined until the sign-in check answers, and null only
  // when it says nobody is signed in. Another notice is left alone.
  function isNudgeDue() {
    if (window.currentUser !== null || hasSeenNudge()) return false;
    if (!noticeEl.hidden || isSampleShowing()) return false;
    return countWrittenLines(lyricsEl.value) >= LINES_BEFORE_NUDGE;
  }

  function keepPage() {
    hideNotice();
    openSignIn(SIGN_IN_ENTRY);
  }

  function showSaveNudge() {
    markNudgeSeen();
    trackEvent('save_nudge_shown');
    showNotice(NUDGE_TEXT, [{ label: NUDGE_ACTION, onClick: keepPage }]);
  }

  // Only typing counts: loading a page or the sample fires input too.
  lyricsEl.addEventListener('input', (event) => {
    if (event.isTrusted && isNudgeDue()) showSaveNudge();
  });
})();
