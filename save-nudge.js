// Once a signed-out writer has a few lines of their own, a "Keep this page"
// button shows under the verse, where the sample's "Start your own" sits. It
// shows once per device and never blocks the pad. sample-start.js places the
// button and auth.js owns the sign-in box; this file only decides when to ask.
(function defineSaveNudge() {
  'use strict';

  const NUDGE_SEEN_KEY = 'save_nudge_seen';
  // Enough to be writing something, not just trying the editor out.
  const LINES_BEFORE_NUDGE = 3;
  const SIGN_IN_ENTRY = 'save_nudge';

  const lyricsEl = document.getElementById('lyrics');
  const noticeEl = document.getElementById('page-notice');
  const keepButtonEl = document.getElementById('save-keep');

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
    if (!noticeEl.hidden || window.OpenPage.isSampleShowing()) return false;
    return countWrittenLines(lyricsEl.value) >= LINES_BEFORE_NUDGE;
  }

  function hideSaveNudge() {
    keepButtonEl.hidden = true;
  }

  function keepPage() {
    hideSaveNudge();
    openSignIn(SIGN_IN_ENTRY);
  }

  function showSaveNudge() {
    markNudgeSeen();
    trackEvent('save_nudge_shown');
    keepButtonEl.hidden = false;
  }

  // Only typing counts: loading a page or the sample fires input too, and
  // either one means the button no longer belongs to the lines under it.
  lyricsEl.addEventListener('input', (event) => {
    if (!event.isTrusted) hideSaveNudge();
    else if (isNudgeDue()) showSaveNudge();
  });
  keepButtonEl.addEventListener('click', keepPage);
  document.addEventListener('auth-checked', () => {
    if (window.currentUser) hideSaveNudge();
  });
})();
