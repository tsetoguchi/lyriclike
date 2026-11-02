// Once a signed-out writer has a couple of lines of their own, a "Keep this
// page" button shows under the verse, where the sample's "Start your own"
// sits. It shows once while they write and once more when they come back to
// the draft on a later visit, and never blocks the pad. sample-start.js
// places the button and auth.js owns the sign-in box; this file only decides
// when to ask.
// Holds how many times this device has been asked. Devices from before the
// count was kept hold '1', which reads as one.
const NUDGE_SHOWN_KEY = 'save_nudge_seen';
const NUDGE_THIS_VISIT_KEY = 'save_nudge_this_visit';
// Once while writing, and once on a return, when they've shown they come
// back to their words.
const MAX_SHOWS = 2;
// Enough to be writing something, not just trying the editor out.
const LINES_BEFORE_NUDGE = 2;
// Picking a rhyme for a line is already writing with intent.
const LINES_AFTER_RHYME = 1;
const SIGN_IN_ENTRY = 'save_nudge';
const TRIGGER = { LINES: 'lines', RHYME: 'rhyme', RETURN: 'return' };

const lyricsEl = document.getElementById('lyrics');
const noticeEl = document.getElementById('page-notice');
const sampleClearEl = document.getElementById('sample-clear');
const keepButtonEl =document.getElementById('save-keep');

// Storage that cannot be read counts as asked out, so nobody is asked on
// every keystroke.
function timesShown() {
  try {
    return Number.parseInt(localStorage.getItem(NUDGE_SHOWN_KEY), 10) || 0;
  } catch {
    return MAX_SHOWS;
  }
}

// A reload stays in the same visit; a new tab or a later day does not.
function wasShownThisVisit() {
  try {
    return sessionStorage.getItem(NUDGE_THIS_VISIT_KEY) !== null;
  } catch {
    return true;
  }
}

function markNudgeShown() {
  try {
    localStorage.setItem(NUDGE_SHOWN_KEY, String(timesShown() + 1));
    sessionStorage.setItem(NUDGE_THIS_VISIT_KEY, '1');
  } catch {}
}

function countWrittenLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

// currentUser is undefined until the sign-in check answers, and null only
// when it says nobody is signed in. Another notice is left alone.
function isNudgeDue(minLines) {
  if (window.currentUser !== null || !keepButtonEl.hidden) return false;
  // "Start your own" can outlast the edited sample; the nudge never replaces it.
  if (!sampleClearEl.hidden) return false;
  if (timesShown() >= MAX_SHOWS || wasShownThisVisit()) return false;
  if (!noticeEl.hidden || window.OpenPage.isSampleShowing()) return false;
  return countWrittenLines(lyricsEl.value) >= minLines;
}

function hideSaveNudge() {
  keepButtonEl.hidden = true;
}

function keepPage() {
  hideSaveNudge();
  openSignIn(SIGN_IN_ENTRY);
}

function showSaveNudge(trigger) {
  markNudgeShown();
  trackEvent('save_nudge_shown', { trigger });
  keepButtonEl.hidden = false;
}

function showIfDue(minLines, trigger) {
  if (isNudgeDue(minLines)) showSaveNudge(trigger);
}

// The draft is back on the pad before the sign-in check answers, so a
// signed-out answer is when a returning writer is first seen.
function onAuthChecked() {
  if (window.currentUser) hideSaveNudge();
  else showIfDue(LINES_BEFORE_NUDGE, TRIGGER.RETURN);
}

// Only typing counts: loading a page or the sample fires input too, and
// either one means the button no longer belongs to the lines under it.
lyricsEl.addEventListener('input', (event) => {
  if (!event.isTrusted) hideSaveNudge();
  else showIfDue(LINES_BEFORE_NUDGE, TRIGGER.LINES);
});
document.addEventListener('rhyme-inserted', () => {
  showIfDue(LINES_AFTER_RHYME, TRIGGER.RHYME);
});
keepButtonEl.addEventListener('click', keepPage);
document.addEventListener('auth-checked', onAuthChecked);
// As a module this runs after every classic script, and the sign-in check
// may have answered before then.
if (window.currentUser !== undefined) onAuthChecked();
