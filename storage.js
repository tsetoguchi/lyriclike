const HTTP_UNAUTHORIZED = 401;
const DEFAULT_TITLE = 'Untitled';
const DRAFT_STORAGE_KEY = 'swag_draft';
// Set once a visitor has cleared the sample verse or written over it.
const SAMPLE_SEEN_KEY = 'sample_seen';
// Set once a visitor has picked a word in the sample, so the hint that asked
// them to stays gone after a reload brings the sample back.
const SAMPLE_HINT_SEEN_KEY = 'sample_hint_seen';
// Set once this device has reported its first typed word to analytics.
const FIRST_WRITE_KEY = 'first_write_tracked';
// Set once this device has reported its first save to an account.
const FIRST_SAVE_KEY = 'first_save_tracked';
// SAMPLE_VERSE and SAMPLE_PICKED_WORD, shown to a first-time visitor so the
// counts and rhyme letters are on screen before they have written anything,
// come from sample-verse.js.
// The sample's name, shown while it is up and never saved. It lives here, not
// in sample-verse.js, because the notebook names pages with it on every visit
// and a cached older copy of that file would leave it undefined.
const SAMPLE_TITLE = 'Nobody Home';
// A rhyme page links here as /?rhymes=word to open the editor on that word.
const LINKED_WORD_PARAM = 'rhymes';
const LINKED_WORD_PATTERN = /^[a-z][a-z']{0,39}$/;
const FOCUS_DELAY_MS = 50;
const CLOSE_DELAY_MS = 250;
const LYRIC_TITLE_LABEL = 'Title';
const NEW_LYRIC_HEADING = 'Create page';
const DELETE_LYRIC_HEADING = 'Delete page';
const LEAVE_LYRIC_HEADING = 'Leave page';
const SHARED_GROUP_LABEL = 'Shared with me';
const RENAME_HEADING = 'Rename page';
const LOADING_MESSAGE = 'Loading...';
const EMPTY_NOTEBOOK_MESSAGE = 'You have no pages';
const SIGNED_OUT_MESSAGE = 'Log in to see your notebook';
const PLACEHOLDER_TITLE = 'Untitled page';
// Whether the docked sidebar was last left open, per device.
const SIDEBAR_STORAGE_KEY = 'sidebar_open';
// Wide enough for the sidebar, the sheet and the rhymes panel side by side.
// Narrower, the sidebar slides over the page instead of pushing it.
const SIDEBAR_DOCK_QUERY = window.matchMedia('(min-width: 1200px)');
const LOAD_FAILED_MESSAGE = 'Could not open your notebook';
const CREATE_ACCOUNT_MESSAGE =
  'Your notebook saves every page you write, so you can pick it up again on '
  + 'any device.';

const CONFLICT_MESSAGE = 'Someone else changed this page.';
// A page nobody else has can only have moved on in this person's other tab
// or device.
const OWN_CONFLICT_MESSAGE = 'This page was changed in another tab or device.';
const NO_LIVE_SESSION_MESSAGE = 'Reload the page to edit it.';
const PAUSED_MESSAGE = 'Live editing is paused. You can read this page.';
const PAUSED_COPY_MESSAGE = 'Live editing is paused, so your newest words are saved as a new page.';
const LOST_ACCESS_MESSAGE =
  'You no longer have access to this page. Your text is saved as a new page.';
const UNAVAILABLE_MESSAGE = "This page isn't available to this account.";
const COPY_SUFFIX = ' (my copy)';
const MAX_TITLE_LENGTH = 300;
// HTTP_NOT_FOUND comes from app.js: the scripts share one global scope.
const HTTP_CONFLICT = 409;
const HTTP_FORBIDDEN = 403;
const HTTP_OVER_LIMIT = 402;
const HTTP_OK = 200;
const REPLACE_NOT_READY = 'not-ready';
const LIMIT_KIND_PAGES = 'pages';
const LIMIT_ANSWER_DELETE = 'delete';
const PAGE_LIMIT_STATUS = 'Not saved: page limit';
const LEAVE_BLOCKED_HEADING = 'Leave this page?';
const LEAVE_BLOCKED_MESSAGE =
  "This page isn't saved because you're at the page limit. Leave it anyway?";
// A 4001 from a live room reloads the page; a stale cache must not loop it.
const RELOAD_GUARD_KEY = 'live_reloaded_at';
const RELOAD_GUARD_MS = 60 * 1000;
// Leaving a live page waits for its room to save the newest words.
const UNSAVED_LEAVE_MESSAGE =
  "Your newest words on this page aren't saved yet, so it stays open. Try again in a moment.";
// A live draft whose page could not be fetched at load tries again this often.
const REOPEN_RETRY_MS = 5000;
const SIGN_OUT_HEADING = 'Log out';
const UNSAVED_SIGN_OUT_MESSAGE =
  "Your newest words on this page aren't saved yet, most likely because you're offline. "
  + "If you log out now, they're lost.";
// The room saves at most every 5 seconds, so signing out waits for one save
// and a little more.
const SIGN_OUT_WAIT_MS = 8000;
// A fetch started by pressing a row is only used by a click that follows
// soon after; older than this, its page may have changed since.
const PREFETCH_MAX_AGE_MS = 3000;
const TOUCH_POINTER = 'touch';

let currentLyricId = crypto.randomUUID();
let currentTitle = 'Untitled';
let lastSavedBody = '';
let saveTimer = null;
// The server's count of saves for the open page, sent with each save so one
// that lost a race is refused instead of erasing the other. null means the
// page is not on the server yet, and its first save creates it.
let currentRevision = null;
// One save at a time: a second save sent before the first answers would carry
// the same revision and be refused against the first. It waits here instead.
let saveInFlight = null;
let saveQueued = false;
let queuedForce = false;
// The body of a save that got no answer. It may have landed, so a 409 that
// carries exactly this body is our own save, not someone else's.
let unansweredBody = null;
// What the server holds when a save was refused, until the writer picks
// whose version to keep. Saving waits while it is set.
let pendingConflict = null;
// The next save is a "Keep mine", saving over their words on purpose. The
// save says so, so the server can tell it from an ordinary one.
let isKeepMineSave = false;
// A new page the server refused at the page limit. Its words stay in the
// draft, and saving waits until a page is deleted.
let blockedPageId = null;
// Whose the open page is and how many people have it. Sharing (sharing.js)
// reads it for the Share button, the "Shared by" line and the poll.
let currentPageInfo = { role: 'owner', shareCount: 0, ownerName: '' };
// The page the extension hook last heard about, so 'page-changed' fires once
// per page and not on every header refresh.
let lastAnnouncedPageId = null;
// The page fetch a press on a list row started, waiting for its click.
let prefetchedLyric = null;

function setPageInfo(lyric) {
  currentPageInfo = {
    role: lyric.role === 'editor' ? 'editor' : 'owner',
    shareCount: Number(lyric.share_count) || 0,
    ownerName: typeof lyric.owner_name === 'string' ? lyric.owner_name : '',
  };
  refreshSharingUi();
}

// sharing.js loads after this file, so the first calls, from a restored
// draft, come before it is there.
function refreshSharingUi() {
  if (typeof refreshPageSharing === 'function') refreshPageSharing();
}

// live.js loads after this file, so early calls find no session yet. Not
// named liveSession: live.js sets window.liveSession, which would replace a
// global function of that name.
function currentLiveSession() {
  return window.liveSession || null;
}

function isLive() {
  const session = currentLiveSession();
  return Boolean(session && session.isLive());
}

// Whether the page on screen is live, or waiting to reopen live: its draft
// says so, and a reload reopens it from the device's local copy (live.js).
// It outlasts a signed-out close, so signing back in picks the page up.
let isLiveDraft = false;
// Set while the page on screen is read-only for a reason this file gave:
// live.js did not load, or live editing is paused for a co-writer. Nothing
// can be typed there, so leaving it loses nothing.
let isEditorLocked = false;
// Set while the live room holds the page read-only (a full room, too many
// tabs), so the end of a replace does not unlock it.
let isRoomReadOnly = false;
// Phones hide the title row and the save indicator in it, so being offline
// is shown in the notice strip, which every screen size shows.
let isOfflineNoticeShown = false;
// The savedAt of the local copy the stored draft's words come from, so a
// reload can tell which of the two is newer, and that copy's words. Typing
// before the first sync moves the draft's body on but leaves these, so a
// reload whose copy is newer still knows what that typing was added to.
// null when there is none.
let liveCopyStamp = null;
let liveCopyText = null;
// The text the room had saved at that copy: the base a reload falls back to
// when the copy itself is gone. A few seconds of typing can then repeat, but
// nothing is lost.
let liveConfirmedText = null;
// What the page had on its way out past the last copy that landed, as a
// base64 Yjs update (live.js saveOnLeaving). null once a copy holds it.
let liveDelta = null;

function forgetLiveCopyMarks() {
  liveCopyStamp = null;
  liveCopyText = null;
  liveConfirmedText = null;
  liveDelta = null;
}

function closeLiveSession() {
  isLiveDraft = false;
  forgetLiveCopyMarks();
  if (currentLiveSession()) currentLiveSession().close();
  // A page locked for want of a live session (showLyric) unlocks once
  // another page is on screen.
  unlockEditor();
}

// Signed out mid-session: off the room, but the local copy stays.
function suspendLiveSession() {
  if (currentLiveSession()) currentLiveSession().close({ keepCopy: true });
}

function liveHasLocalCopy() {
  const session = currentLiveSession();
  return Boolean(session && session.hasLocalCopy());
}

// Signing out and deleting the account leave no live words on the device.
// forgetAllCopies never rejects.
function forgetLiveCopies() {
  const session = currentLiveSession();
  if (session) session.forgetAllCopies();
}

// The room saves a live page, and one waiting to reopen live; a REST save
// would only meet it as a 409.
function isRoomSaved() {
  return isLiveDraft || isLive();
}

// Up here, not with the rest of the sample code, because naming the page
// reads it and the notebook can be drawn before that code runs.
let sampleShowing = false;

// ── Dialog ──

// One panel for everything the app needs to ask. It comes in three shapes:
// a question with a field (naming a page), a question without one (deleting
// a page), and a question whose field has to be typed correctly before the
// answer counts (deleting an account with only Google). A field can also be a
// password (deleting an account that has one). Resolves with the field's contents, or
// true when there is no field, or null if the person backed out.
let resolveDialog = null;
let requiredAnswer = null;

function openDialog({
  heading, message, confirmLabel, danger, field, noCancel = false, cancelLabel = 'Cancel',
}) {
  const overlay = document.getElementById('dialog-overlay');
  const input = document.getElementById('dialog-input');
  const confirm = document.getElementById('dialog-confirm');
  const messageEl = document.getElementById('dialog-message');
  const fieldEl = document.getElementById('dialog-field');

  document.getElementById('dialog-title').textContent = heading;
  // A dialog that only tells something has nothing to cancel.
  const cancel = document.getElementById('dialog-cancel');
  cancel.hidden = noCancel;
  cancel.textContent = cancelLabel;
  confirm.textContent = confirmLabel;
  confirm.classList.toggle('danger-btn', Boolean(danger));

  messageEl.textContent = message || '';
  messageEl.hidden = !message;

  fieldEl.hidden = !field;
  requiredAnswer = field && field.mustMatch ? field.mustMatch : null;
  if (field) {
    document.getElementById('dialog-label').textContent = field.label;
    input.value = field.value || '';
    // A password field also tells password managers what to fill.
    input.type = field.type || 'text';
    input.autocomplete = field.type === 'password' ? 'current-password' : 'off';
  }
  updateDialogConfirmState();

  overlay.hidden = false;
  overlay.classList.add('open');

  // Focus once the panel is on its way in, so iOS raises the keyboard for it.
  setTimeout(() => {
    if (field) { input.focus(); input.select(); } else { confirm.focus(); }
  }, FOCUS_DELAY_MS);

  return new Promise(resolve => { resolveDialog = resolve; });
}

// Only a field that has to match can hold the button shut.
function updateDialogConfirmState() {
  const input = document.getElementById('dialog-input');
  document.getElementById('dialog-confirm').disabled =
    requiredAnswer !== null && input.value.trim() !== requiredAnswer;
}

function closeDialog(answer) {
  const overlay = document.getElementById('dialog-overlay');
  overlay.classList.remove('open');
  // Wait out the fade before taking it out of the page entirely.
  setTimeout(() => { if (!overlay.classList.contains('open')) overlay.hidden = true; }, CLOSE_DELAY_MS);
  const resolve = resolveDialog;
  resolveDialog = null;
  requiredAnswer = null;
  if (resolve) resolve(answer);
}

function submitDialog() {
  if (document.getElementById('dialog-confirm').disabled) return;
  const fieldEl = document.getElementById('dialog-field');
  closeDialog(fieldEl.hidden ? true : document.getElementById('dialog-input').value);
}

document.getElementById('dialog-confirm').addEventListener('click', submitDialog);
document.getElementById('dialog-cancel').addEventListener('click', () => closeDialog(null));
document.getElementById('dialog-close').addEventListener('click', () => closeDialog(null));
document.getElementById('dialog-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('dialog-overlay')) closeDialog(null);
});
document.getElementById('dialog-input').addEventListener('input', updateDialogConfirmState);
document.getElementById('dialog-overlay').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'dialog-input') { e.preventDefault(); submitDialog(); }
  if (e.key === 'Escape') { e.preventDefault(); closeDialog(null); }
});

function askForLyricName({ heading, confirmLabel, value }) {
  return openDialog({
    heading,
    confirmLabel,
    field: { label: LYRIC_TITLE_LABEL, value },
  });
}

// ── Sidebar ──

// One sidebar at every size. Wide, it is docked beside the page, open until
// the writer hides it, and remembered that way. Narrower, it slides over the
// page and gets out of the way once a page is picked.
function isSidebarDocked() {
  return SIDEBAR_DOCK_QUERY.matches;
}

// Storage that cannot be read leaves it open: the notebook is the default.
function readSidebarPreference() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function setSidebarOpen(isOpen, { remember = false } = {}) {
  document.body.classList.toggle('sidebar-open', isOpen);
  document.getElementById('rail-open-btn').setAttribute('aria-expanded', String(isOpen));
  setNotebookButtonActive(isOpen);
  if (remember && isSidebarDocked()) {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, isOpen ? '1' : '0');
    } catch {
      // Not remembered this time; the sidebar still opens and closes.
    }
  }
}

function isSidebarOpen() {
  return document.body.classList.contains('sidebar-open');
}

function openLyricsList() {
  setSidebarOpen(true, { remember: true });
  loadLyricsList();
}

// Picking or making a page puts a sliding sidebar away. A docked one stays.
function closeLyricsList() {
  if (!isSidebarDocked()) setSidebarOpen(false);
}

function hideSidebar() {
  setSidebarOpen(false, { remember: true });
}

function placeSidebarForViewport() {
  setSidebarOpen(isSidebarDocked() && readSidebarPreference());
}

// The phone bar's notebook button lights up amber while the sidebar is open,
// like the other tool buttons do while their tool is on.
function setNotebookButtonActive(isActive) {
  const button = document.getElementById('notebook-btn');
  button.classList.toggle('active', isActive);
  button.setAttribute('aria-expanded', String(isActive));
}

// Signed out, a new page would have no notebook to live in, so Create page asks
// for an account instead, in the sign-in modal's first step.
// currentUser is null only once the sign-in check has answered.
async function promptForAccount() {
  if (window.openAuthModal) {
    await window.openAuthModal({ message: CREATE_ACCOUNT_MESSAGE });
  } else if (window.startSignIn) {
    window.startSignIn();
  }
}

function handleNotebookClick() {
  if (isSidebarOpen()) {
    hideSidebar();
  } else {
    openLyricsList();
  }
}

async function handleCreateClick() {
  if (window.currentUser === null) {
    await promptForAccount();
    return;
  }
  await createLyric();
}

// What the list last showed for each page, so a save can tell whether the
// sidebar has fallen behind the title on screen.
let listedTitles = new Map();
let lastListedLyrics = null;

// How many pages of their own the list last showed, for the limit check at
// New page. Null until the list loads; /api/me's count stands in until then.
let ownPageCount = null;

function currentOwnPageCount() {
  if (ownPageCount !== null) return ownPageCount;
  const user = window.currentUser;
  return user && typeof user.page_count === 'number' ? user.page_count : 0;
}

// The quiet "3 of 5 pages" under the notebook. Only shows when the site sets
// a page limit; a stale limits.js leaves it hidden rather than breaking.
function showPageCount(count) {
  const countEl = document.getElementById('page-count');
  const user = window.currentUser;
  const text = user && window.SiteLimits ? window.SiteLimits.pageCountText(count, user.page_limit) : '';
  countEl.textContent = text;
  countEl.hidden = !text;
}

// Create page either makes a page or, signed out, asks for an account, so it
// stays off only until the sign-in check answers. Runs whenever the list does,
// which is whenever sign-in changes.
function setNewPageEnabled(isEnabled) {
  for (const id of ['new-lyric-btn', 'rail-new-btn']) {
    document.getElementById(id).disabled = !isEnabled;
  }
}

async function loadLyricsList() {
  const container = document.getElementById('lyrics-list-items');
  setNewPageEnabled(window.currentUser !== undefined);

  // Signed out, the only page is the one in this browser. Before the sign-in
  // check answers there is nothing to say yet.
  if (!window.currentUser) showPageCount(0);
  if (window.currentUser === null) {
    lastListedLyrics = null;
    showLocalPage(container);
    if (typeof promptForPendingShare === 'function') promptForPendingShare();
    return;
  }
  if (window.currentUser === undefined) {
    showListMessage(container, LOADING_MESSAGE);
    return;
  }

  if (!container.querySelector('.lyrics-list-item')) showListMessage(container, LOADING_MESSAGE);

  try {
    const res = await fetch('/api/lyrics');

    // An expired session and a broken request are worth telling apart, and
    // neither should read as an empty notebook: someone whose lyrics failed
    // to load must not be told they have none.
    if (res.status === HTTP_UNAUTHORIZED) {
      showListMessage(container, SIGNED_OUT_MESSAGE);
      if (window.handleSessionExpired) window.handleSessionExpired();
      return;
    }
    if (!res.ok) {
      showListMessage(container, LOAD_FAILED_MESSAGE);
      return;
    }

    const lyrics = await res.json();
    lastListedLyrics = lyrics;
    renderLyricsList(container, lyrics);
    return lyrics;
  } catch {
    showListMessage(container, LOAD_FAILED_MESSAGE);
  }
}

// Draws the rows from a list already fetched, so a change to the row
// buttons needs no request.
function renderLyricsList(container, lyrics) {
  listedTitles = new Map(lyrics.map(lyric => [lyric.id, lyric.title]));
  const own = lyrics.filter(lyric => !lyric.shared);
  const shared = lyrics.filter(lyric => lyric.shared);
  ownPageCount = own.length;
  showPageCount(own.length);
  if (own.length === 0) {
    showListMessage(container, EMPTY_NOTEBOOK_MESSAGE);
  } else {
    container.innerHTML = '';
    for (const lyric of own) container.appendChild(buildListItem(lyric));
  }
  if (shared.length > 0) {
    const label = document.createElement('h2');
    label.className = 'sidebar-label lyrics-list-group';
    label.innerHTML = `<button type="button" class="list-group-toggle" data-group="shared" aria-expanded="true">`
      + `${escapeHtml(SHARED_GROUP_LABEL)}${CHEVRON_ICON}</button>`;
    container.appendChild(label);
    for (const lyric of shared) container.appendChild(buildListItem(lyric));
  }
  applyListFolds();
  // The database may not have the live page's newest title yet.
  if (isLive()) showListedTitle(currentLyricId, currentTitle);
}

document.addEventListener('notebook-actions-changed', () => {
  if (!window.currentUser || !lastListedLyrics) return;
  renderLyricsList(document.getElementById('lyrics-list-items'), lastListedLyrics);
});

// live-presence.js loads after this file and holds the one rule for short
// names; a tab without it shows the name whole.
function shortPersonName(name) {
  return window.LivePresence ? window.LivePresence.shortNameOf(name) : name;
}

// Which notebook groups are folded, kept on this device. Both start open.
const LIST_FOLDS_KEY = 'notebook_folds';
const LIST_GROUPS = ['own', 'shared'];
const CHEVRON_ICON = '<svg class="list-group-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';

function readListFolds() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_FOLDS_KEY) || '{}');
    return { own: saved.own === true, shared: saved.shared === true };
  } catch {
    return { own: false, shared: false };
  }
}

// A folded group hides its pages, except the one open on screen, so the
// writer can always see where they are.
function applyListFolds() {
  const folds = readListFolds();
  const container = document.getElementById('lyrics-list-items');
  for (const group of LIST_GROUPS) {
    container.classList.toggle(`is-${group}-folded`, folds[group]);
    for (const toggle of document.querySelectorAll(`.list-group-toggle[data-group="${group}"]`)) {
      toggle.setAttribute('aria-expanded', String(!folds[group]));
    }
  }
}

function toggleListGroup(group) {
  const folds = readListFolds();
  folds[group] = !folds[group];
  try {
    localStorage.setItem(LIST_FOLDS_KEY, JSON.stringify(folds));
  } catch {
    // Storage blocked: the fold still applies until the page reloads.
  }
  rollListGroup(group, folds[group]);
}

// A click rolls the rows one after another: folding takes the bottom one
// first, unfolding brings the top one down first. Loads and refreshes do
// not roll, since only the click asked for it.
const ROLL_STEP_MS = 30;
const ROLL_SPREAD_MS = 240;
// Longer than the last row's delay plus its own roll (--duration-base).
const ROLL_DONE_MS = 600;
let rollTimer = null;

// The row's own scrollHeight is wrong while it is folded: its contents are
// centred, so half of them overflow above the top, where scrollHeight does
// not count. Its children keep their full height either way.
function measureRowHeight(row) {
  return Math.max(0, ...[...row.children].map(child => child.offsetHeight));
}

function rollListGroup(group, isFolding) {
  const container = document.getElementById('lyrics-list-items');
  const rows = [...container.querySelectorAll(`.lyrics-list-item[data-group="${group}"]:not(.active)`)];
  if (isFolding) rows.reverse();
  // All heights are read before any style is written: reading after a write
  // makes the browser lay the page out again, once per row.
  const heights = rows.map(measureRowHeight);
  rows.forEach((row, order) => {
    row.style.setProperty('--row-height', `${heights[order]}px`);
    row.style.setProperty('--fold-order', String(order));
  });
  const step = Math.min(ROLL_STEP_MS, ROLL_SPREAD_MS / Math.max(rows.length, 1));
  container.style.setProperty('--fold-step', `${step}ms`);
  container.classList.add('is-rolling');
  // The rows take their measured height before the fold changes, so the
  // roll starts from it rather than jumping.
  void container.offsetHeight;
  applyListFolds();
  clearTimeout(rollTimer);
  rollTimer = setTimeout(() => container.classList.remove('is-rolling'), ROLL_DONE_MS);
}

const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const LEAVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
const EXTRA_ACTION_PREFIX = 'extra-';

// The buttons an extension added to every row, in the order they were added.
function rowExtensions() {
  const hook = window.siteExtensions;
  return hook && hook.notebookRowActions ? hook.notebookRowActions() : [];
}

function extraRowButtons(escapedTitle) {
  return rowExtensions().map(({ label, icon }, index) => {
    const name = escapeHtml(label);
    return `<button class="lyrics-action-btn" data-action="${EXTRA_ACTION_PREFIX}${index}" aria-label="${name} ${escapedTitle}" title="${name}">${icon}</button>`;
  }).join('');
}

// Each runs with the row's page, and a throw there is only warned about.
function extraRowRuns(lyric) {
  const row = { id: lyric.id, title: lyric.title, shared: Boolean(lyric.shared) };
  return rowExtensions().map(({ label, icon, onClick }) => ({
    label,
    icon,
    run: () => {
      try {
        onClick({ ...row });
      } catch (error) {
        console.warn('Extension hook: a row action failed:', error);
      }
    },
  }));
}

// A page is its title, like a chat in Gemini or ChatGPT. Rename and delete
// wait at the end of the row until it is hovered or focused. A page shared
// with this person shows whose it is, and can be left rather than deleted.
// The owner shows as "Tao S.", short enough to stay whole beside the title.
function buildListItem(lyric) {
  const item = document.createElement('div');
  item.className = 'lyrics-list-item' + (lyric.id === currentLyricId ? ' active' : '');
  item.dataset.id = lyric.id;
  item.dataset.group = lyric.shared ? 'shared' : 'own';
  const title = escapeHtml(titleForName(lyric.title));
  const owner = lyric.shared ? escapeHtml(shortPersonName(lyric.owner_name || '')) : '';
  const lastAction = lyric.shared
    ? `<button class="lyrics-action-btn lyrics-delete-btn" data-action="leave" aria-label="Leave ${title}" title="Leave">${LEAVE_ICON}</button>`
    : `<button class="lyrics-action-btn lyrics-delete-btn" data-action="delete" aria-label="Delete ${title}" title="Delete">${TRASH_ICON}</button>`;

  item.innerHTML = `
    <button class="lyrics-list-open" title="${title} · ${formatDate(lyric.created_at)}"><span class="lyrics-list-title">${title}</span>${owner ? `<span class="lyrics-list-owner">${owner}</span>` : ''}</button>
    <div class="lyrics-list-actions">
      ${extraRowButtons(title)}<button class="lyrics-action-btn" data-action="rename" aria-label="Rename ${title}" title="Rename">${PENCIL_ICON}</button>
      ${lastAction}
    </div>
  `;

  const openButton = item.querySelector('.lyrics-list-open');
  // A touch may be the start of scrolling the list, not a tap on this row.
  openButton.addEventListener('pointerdown', event => {
    if (event.pointerType !== TOUCH_POINTER) prefetchLyric(lyric.id);
  });
  openButton.addEventListener('click', () => {
    trackEvent('page_opened');
    loadLyric(lyric.id);
  });
  const actions = {
    rename: () => renameLyric(lyric.id, lyric.title),
    delete: () => deleteLyric(lyric),
    leave: () => deleteLyric(lyric),
  };
  extraRowRuns(lyric).forEach((extra, index) => {
    actions[EXTRA_ACTION_PREFIX + index] = extra.run;
  });
  for (const button of item.querySelectorAll('.lyrics-action-btn')) {
    button.addEventListener('click', actions[button.dataset.action]);
  }
  watchListItemHold(item, lyric, actions);
  return item;
}

// On touch the row's buttons are hidden, and a long press brings them up
// as a menu. A tab holding an older index.html has no page-menu.js.
function watchListItemHold(item, lyric, actions) {
  if (!window.PageMenu) return;
  PageMenu.watchForHold(item, () => PageMenu.open(item, titleForName(lyric.title), {
    share: canShareFromList(lyric) ? () => openShareDialog(lyric.id, lyric.title) : null,
    rename: actions.rename,
    remove: actions.delete,
    removeLabel: lyric.shared ? 'Leave' : 'Delete',
    extra: extraRowRuns(lyric),
  }));
}

// The Share button's rule: an editor can always see who is on a page, and an
// owner can still reach people already added while sharing is paused.
function canShareFromList(lyric) {
  if (!window.openShareDialog) return false;
  if (lyric.shared || lyric.share_count > 0) return true;
  return Boolean(window.currentUser && window.currentUser.can_share);
}

// The page a signed-out writer has, shown the way a saved one would be so
// the notebook they would get is already in view.
function showLocalPage(container) {
  // The page on screen, so it reads as the editor's placeholder does.
  const title = escapeHtml(titleForDisplay(currentTitle) || placeholderTitle());
  container.innerHTML = `
    <div class="lyrics-list-item active">
      <button class="lyrics-list-open" title="Saved in this browser">${title}</button>
    </div>
  `;
  container.querySelector('.lyrics-list-open').addEventListener('click', () => {
    closeLyricsList();
    document.getElementById('lyrics').focus();
  });
}

function markActiveListItem() {
  markListItem(currentLyricId);
}

function markListItem(id) {
  for (const item of document.querySelectorAll('#lyrics-list-items .lyrics-list-item[data-id]')) {
    item.classList.toggle('active', item.dataset.id === id);
  }
}

// After a save, the list is only fetched again if it shows this page under
// another title, or not at all.
// On a live page the room writes a new title to the database up to 10 s
// later, so asking the database now would bring the old one back; the
// title on screen is the newest, and the list takes it from there.
function refreshListIfBehind() {
  if (listedTitles.get(currentLyricId) === currentTitle) return;
  if (isLive()) showListedTitle(currentLyricId, currentTitle);
  else loadLyricsList();
}

function showListedTitle(id, title) {
  if (!listedTitles.has(id)) return;
  listedTitles.set(id, title);
  // A later re-render without a fetch draws from this list.
  const listed = lastListedLyrics && lastListedLyrics.find(lyric => lyric.id === id);
  if (listed) listed.title = title;
  const row = document.querySelector(`.lyrics-list-item[data-id="${CSS.escape(id)}"] .lyrics-list-title`);
  if (row) row.textContent = titleForName(title);
}

function showListMessage(container, message) {
  container.innerHTML = '<div class="lyrics-list-empty">' + escapeHtml(message) + '</div>';
}

// Fetches a page and puts it on screen. Returns the fetch's status, or 0 when
// the request itself failed. The new page is only shown once the save waiting
// on the page being left is done, so its last words are not lost; the fetch
// runs alongside that save rather than after it. The row lights up at once,
// and goes back to the open page if this one does not open.
async function loadLyric(id) {
  markListItem(id);
  const status = await openLyric(id);
  markActiveListItem();
  return status;
}

// The open page itself is fetched only after its save lands: fetched during
// it, the older words would come back and replace the newer ones.
async function openLyric(id) {
  const isOpenPage = id === currentLyricId;
  const early = isOpenPage ? null : takePrefetchedLyric(id) || fetchLyric(id);
  if (!await flushSave()) return 0;
  let res;
  try {
    res = await (early || fetchLyric(id));
  } catch {
    return 0;
  }
  if (!res.ok) return res.status;
  const lyric = await res.json();

  showLyric(lyric);
  closeLyricsList();
  return res.status;
}

function fetchLyric(id) {
  const fetching = fetch(`/api/lyrics/${id}`);
  // A fetch nobody ends up waiting for must not fail as an unhandled rejection.
  fetching.catch(() => {});
  return fetching;
}

// Pressing a row starts its fetch, so the time until the click lands is not
// spent waiting.
function prefetchLyric(id) {
  if (id === currentLyricId) return;
  prefetchedLyric = { id, startedAt: Date.now(), fetching: fetchLyric(id) };
}

function takePrefetchedLyric(id) {
  const prefetched = prefetchedLyric;
  prefetchedLyric = null;
  if (!prefetched || prefetched.id !== id) return null;
  if (Date.now() - prefetched.startedAt > PREFETCH_MAX_AGE_MS) return null;
  return prefetched.fetching;
}

// The revision and the saved text are set before the input event, which
// would otherwise schedule a save of text that is already on the server.
function showLyric(lyric) {
  // The page already live on screen: its room has newer words than this
  // copy, and writing it into the editor would send it to everyone as typing.
  const session = currentLiveSession();
  if (lyric.live && session && session.isLiveFor(lyric.id)) return refreshLivePageInfo(lyric);
  // Off the old page's room before its editor changes, so nothing of the new
  // page is ever sent there.
  closeLiveSession();
  // Before the input event below, so its draft is marked live.
  isLiveDraft = Boolean(lyric.live);
  if (lyric.id !== currentLyricId) clearPageNotice();
  currentLyricId = lyric.id;
  currentTitle = lyric.title;
  currentRevision = lyric.revision;
  lastSavedBody = lyric.body;
  unansweredBody = null;
  clearConflict();
  if (lyric.role) setPageInfo(lyric);

  const textarea = document.getElementById('lyrics');
  textarea.value = lyric.body;
  textarea.dispatchEvent(new Event('input'));

  setSaveIndicator('');
  updatePanelHeader();
  if (session) session.follow(lyric);
  // Live, but live.js did not load: the words would be kept from the REST
  // save and from the room alike, so the page is read-only until a reload.
  // A co-writer with live editing off may only read (spec §8).
  if (isLiveDraft && !session) lockEditor(NO_LIVE_SESSION_MESSAGE);
  else if (isPausedForMe(lyric)) lockEditor(PAUSED_MESSAGE);
}

function isPausedForMe(lyric) {
  return lyric.role === 'editor' && !lyric.live;
}

// The title too: a paused co-writer's rename would be refused.
function setEditorReadOnly(isReadOnly) {
  document.getElementById('lyrics').readOnly = isReadOnly;
  document.getElementById('lyrics-panel-title').contentEditable = isReadOnly ? 'false' : 'true';
}

function lockEditor(message) {
  isEditorLocked = true;
  freezeUntilReload(message);
}

function unlockEditor() {
  if (isEditorLocked) hideNotice();
  isEditorLocked = false;
  setEditorReadOnly(false);
}

// A live draft reopened without live.js may hold unsaved words, so it is
// frozen without the lock flag: leaving stays refused until a reload.
function freezeUntilReload(message = NO_LIVE_SESSION_MESSAGE) {
  setEditorReadOnly(true);
  showNotice(message);
}

// live.js asks when reconnects keep failing. A refused upgrade looks like a
// dropped socket, so the page asks the server: still live, keep trying; not
// live (the switch went off), the words are saved the REST way, which for a
// co-writer means read-only or a page of their own; gone, they are kept.
async function checkStillLive() {
  const id = currentLyricId;
  let res;
  try {
    res = await fetch(`/api/lyrics/${id}`);
  } catch {
    return;
  }
  if (id !== currentLyricId || !isLive()) return;
  if (res.status === HTTP_NOT_FOUND) return leaveUnavailableLivePage(id);
  if (!res.ok) return;
  const lyric = await res.json();
  if (lyric.live) return;
  closeLiveSession();
  reconcileAsRest(lyric);
}

async function leaveUnavailableLivePage(id) {
  const screen = document.getElementById('lyrics').value;
  const hasUnsaved = await currentLiveSession().hasUnsavedWords(id, screen);
  if (id === currentLyricId) window.livePage.onUnavailable({ hasUnsaved });
}

function refreshLivePageInfo(lyric) {
  if (lyric.role) setPageInfo(lyric);
  markActiveListItem();
}

// A new page is on screen but not on the server, so its first save creates it.
function startBlankPage(title) {
  closeLiveSession();
  clearPageNotice();
  clearTimeout(saveTimer);
  currentLyricId = crypto.randomUUID();
  currentTitle = title;
  currentRevision = null;
  lastSavedBody = '';
  unansweredBody = null;
  clearConflict();
  setPageInfo({});

  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));
  setSaveIndicator('');
  updatePanelHeader();
  // The page left behind is no longer the open one, so a folded group can
  // put it away.
  markActiveListItem();
}

async function createLyric() {
  if (window.SiteLimits && !await window.SiteLimits.askAtLimit('pages', currentOwnPageCount())) return;
  const name = await askForLyricName({ heading: NEW_LYRIC_HEADING, confirmLabel: 'Create', value: '' });
  if (name === null) return;
  trackEvent('page_created');

  if (!await flushSave()) return;
  startBlankPage(name.trim() || DEFAULT_TITLE);
  saveDraft();
  closeLyricsList();
  document.getElementById('lyrics').focus();

  await saveNewLyric();
}

// A lyric someone has just named belongs in the notebook straight away, even
// with no words in it yet, so this save goes out with an empty body.
function saveNewLyric() {
  return performSave({ force: true });
}

// The server treats both the same way: the owner's call deletes the page,
// an editor's only takes them off it. Only the words differ.
async function deleteLyric({ id, title, shared, owner_name: ownerName }) {
  const confirmed = await openDialog(shared
    ? {
      heading: LEAVE_LYRIC_HEADING,
      message: `You'll lose access to “${titleForName(title)}”. ${ownerName || 'Its owner'} keeps it.`,
      confirmLabel: 'Leave',
      danger: true,
    }
    : {
      heading: DELETE_LYRIC_HEADING,
      message: `“${titleForName(title)}” will be deleted, along with everything written in it. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
  if (!confirmed) return;

  if (id === currentLyricId) {
    clearTimeout(saveTimer);
    await waitForSaves();
  }
  const res = await fetch(`/api/lyrics/${id}`, { method: 'DELETE' });

  if (id === currentLyricId) startBlankPage(DEFAULT_TITLE);
  else if (res.ok && !shared && isPageBlocked()) saveBlockedPage();

  loadLyricsList();
}

function isPageBlocked() {
  return blockedPageId !== null && blockedPageId === currentLyricId;
}

// Deleting a page makes room, so the page held back goes out now.
function saveBlockedPage() {
  blockedPageId = null;
  performSave({ force: true });
}

// Only the first refusal of a page shows the dialog, so typing on does not
// bring it back on every pause. Not awaited: the save ends now, so nothing
// waiting on it sits behind the dialog. Leaving the page asks over it.
function holdAtPageLimit(pageId, limit) {
  const isFirstRefusal = blockedPageId !== pageId;
  blockedPageId = pageId;
  clearTimeout(saveTimer);
  setSaveIndicator(PAGE_LIMIT_STATUS);
  if (isFirstRefusal) showPageLimitDialog(limit).catch(() => {});
}

async function showPageLimitDialog(limit) {
  if (!window.SiteLimits) return;
  const answer = await window.SiteLimits.showLimitDialog({ kind: LIMIT_KIND_PAGES, limit });
  if (answer === LIMIT_ANSWER_DELETE) openLyricsList();
}

async function askToLeaveBlockedPage() {
  const answer = await openDialog({
    heading: LEAVE_BLOCKED_HEADING,
    message: LEAVE_BLOCKED_MESSAGE,
    confirmLabel: 'Leave anyway',
    danger: true,
  });
  return answer === true;
}

function sendRename(id, title) {
  return fetch(`/api/lyrics/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

async function renameLyric(id, oldTitle) {
  const entered = await askForLyricName({ heading: RENAME_HEADING, confirmLabel: 'Rename', value: oldTitle });
  if (entered === null) return;
  const newTitle = entered.trim();
  if (!newTitle || newTitle === oldTitle) return;

  if (id === currentLyricId) {
    currentTitle = newTitle;
    updatePanelHeader();
    saveDraft();
    await renameCurrentPage();
    refreshListIfBehind();
    return;
  }

  try {
    await sendRename(id, newTitle);
  } catch {
    // The list below still shows the name the server has.
  }
  loadLyricsList();
}

// A rename touches only the title, so it never bumps the revision or runs
// into someone else's words. A page not on the server yet has nothing to
// rename; its create goes out instead, carrying the name. One whose create
// is still on its way is renamed once that lands.
async function renameCurrentPage() {
  const pageId = currentLyricId;
  if (isLive()) {
    currentLiveSession().rename(currentTitle);
    return;
  }
  await waitForSaves();
  if (pageId !== currentLyricId) return;
  if (currentRevision === null) {
    await performSave({ force: true });
    return;
  }

  setSaveIndicator('Saving...');
  try {
    const res = await sendRename(pageId, currentTitle);
    if (res.status === HTTP_UNAUTHORIZED) {
      setSaveIndicator('Log in to save');
      if (window.handleSessionExpired) window.handleSessionExpired();
      return;
    }
    if (!res.ok) {
      setSaveIndicator('Save failed');
      return;
    }
    showSaved();
  } catch {
    setSaveIndicator('Save failed');
  }
}

function scheduleSave() {
  if (!window.currentUser) return;
  // The room saves a live page; the draft still records it.
  if (isRoomSaved()) return;
  if (isPageBlocked()) return;
  clearTimeout(saveTimer);
  setSaveIndicator('Unsaved');
  saveTimer = setTimeout(performSave, 1000);
}

// Saves the open page's words. Only one save is on the wire at a time; one
// asked for meanwhile goes out when it answers, on the new revision. `force`
// saves even an empty or unchanged body: a new page, a rename of a page not on
// the server yet, and "Keep mine" all need that.
function performSave({ force = false } = {}) {
  if (!window.currentUser) return Promise.resolve();
  if (isPageBlocked()) return Promise.resolve();
  if (saveInFlight) {
    saveQueued = true;
    queuedForce = queuedForce || force;
    return saveInFlight;
  }
  saveInFlight = sendSave(force).finally(() => {
    saveInFlight = null;
    if (!saveQueued) return undefined;
    const again = queuedForce;
    saveQueued = false;
    queuedForce = false;
    return performSave({ force: again });
  });
  return saveInFlight;
}

// Resolves once no save is on the wire or waiting to follow one.
async function waitForSaves() {
  while (saveInFlight) await saveInFlight;
}

// Sends the save the 1-second timer is holding, then waits for it. Called
// before leaving a page, so the timer cannot fire on the next one. Words
// caught in an unresolved conflict are kept as a page of their own. Returns
// false when that failed, and the page must stay open so nothing is lost.
async function flushSave() {
  if (isLive()) return flushLivePage();
  // Offline at load, waiting to reopen live: its words are not safe to leave.
  if (isLiveDraft && !isEditorLocked) {
    showNotice(UNSAVED_LEAVE_MESSAGE);
    return false;
  }
  if (pendingConflict) return keepMineAsCopy();
  clearTimeout(saveTimer);
  saveTimer = null;
  if (hasUnsavedEdits()) await performSave();
  await waitForSaves();
  // Checked after the save: a page reopened from its draft learns only now.
  if (isPageBlocked()) return askToLeaveBlockedPage();
  return true;
}

// Leaving a live page waits for the room to save its words, or stays, and
// says so where phones show it.
async function flushLivePage() {
  const isSaved = await currentLiveSession().flush();
  if (!isSaved) showNotice(UNSAVED_LEAVE_MESSAGE);
  return isSaved;
}

// Signing out ends this device's copy of a live page. Words on their way
// get a few seconds to reach the room; if they cannot (offline), the
// writer decides whether to lose them.
async function confirmSignOut() {
  // Words behind the conflict bar would go with the draft at sign-out, so
  // they are kept as a page of their own first.
  if (pendingConflict && !await keepMineAsCopy()) return askToLogOutAnyway();
  // Its last save goes out first, so a page over the limit can ask.
  if (!isLiveDraft) return flushSave();
  if (isLive() && await currentLiveSession().flush(SIGN_OUT_WAIT_MS)) return true;
  return askToLogOutAnyway();
}

async function askToLogOutAnyway() {
  const answer = await openDialog({
    heading: SIGN_OUT_HEADING,
    message: UNSAVED_SIGN_OUT_MESSAGE,
    confirmLabel: 'Log out anyway',
    danger: true,
  });
  return answer === true;
}

// The sample verse is not the visitor's writing, so it goes out as an empty
// page. The answer is only used if its page is still the one open: a slow
// save on one page must not hand its revision to the next.
async function sendSave(force) {
  // A live page is saved by its room; a REST save would only meet it as a 409.
  if (isRoomSaved()) return;
  if (pendingConflict) return;
  const typed = document.getElementById('lyrics').value;
  if (!force) {
    if (!typed.trim()) return;
    if (isSampleShowing()) return;
    if (typed === lastSavedBody) return;
  }
  const body = isSampleShowing() ? '' : typed;
  const pageId = currentLyricId;
  const isCreate = currentRevision === null;
  const payload = isCreate ? { title: currentTitle, body } : { body, base_revision: currentRevision };
  if (isKeepMineSave && !isCreate) payload.overwrite = true;
  isKeepMineSave = false;

  setSaveIndicator('Saving...');
  let res;
  try {
    res = await fetch(`/api/lyrics/${pageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    unansweredBody = body;
    if (pageId === currentLyricId) setSaveIndicator('Save failed');
    return;
  }
  if (pageId !== currentLyricId) return;

  if (res.status === HTTP_UNAUTHORIZED) {
    setSaveIndicator('Log in to save');
    if (window.handleSessionExpired) window.handleSessionExpired();
    return;
  }
  if (res.ok) {
    const { revision, live } = await res.json();
    savedAs(body, revision);
    if (live) goLiveFromRest();
    // A new page can change the account's limits (an invite's reward).
    if (isCreate) document.dispatchEvent(new CustomEvent('page-created', { detail: { id: pageId } }));
    return;
  }
  if (res.status === HTTP_CONFLICT) {
    const theirs = await res.json();
    // A create that meets an existing page keeps the conflict bar: there
    // is no earlier text of ours to rebase from.
    if (theirs.live && !isCreate) return goLiveAfterConflict(theirs, body);
    handleConflict(theirs, body);
    return;
  }
  // Live editing went off while this co-writer had words to save (a live
  // draft reopened the REST way): they become a page of their own. Only the
  // server's own answer says so; a 403 from the edge is an ordinary failure.
  if (res.status === HTTP_FORBIDDEN && !isCreate && await isPausedAnswer(res)) {
    saveAsNewPage({ message: PAUSED_COPY_MESSAGE });
    return;
  }
  if (res.status === HTTP_NOT_FOUND) {
    // A create that is refused means the id is someone else's. An update that
    // is refused means the page was deleted, or its owner took this person
    // off it, while they were typing.
    saveAsNewPage({ message: isCreate ? null : LOST_ACCESS_MESSAGE });
    return;
  }
  if (res.status === HTTP_OVER_LIMIT) {
    const refusal = await res.json().catch(() => null);
    if (pageId === currentLyricId) holdAtPageLimit(pageId, refusal && refusal.limit);
    return;
  }
  setSaveIndicator('Save failed');
}

async function isPausedAnswer(res) {
  try {
    return (await res.json()).error === 'paused';
  } catch {
    return false;
  }
}

function savedAs(body, revision) {
  trackEventOnce(FIRST_SAVE_KEY, 'first_save');
  lastSavedBody = body;
  currentRevision = revision;
  unansweredBody = null;
  saveDraft();
  showSaved();
  refreshSharingUi();
}

function showSaved() {
  setSaveIndicator('Saved');
  setTimeout(() => setSaveIndicator(''), 3000);
  refreshListIfBehind();
}

// A save that landed but whose answer was lost comes back as a 409 against
// itself. That one is adopted, and anything typed since goes out on top.
function handleConflict(theirs, sentBody) {
  if (unansweredBody !== null && theirs.body === unansweredBody) {
    savedAs(theirs.body, theirs.revision);
    if (document.getElementById('lyrics').value !== lastSavedBody) saveQueued = true;
    return;
  }
  if (theirs.body === sentBody) {
    savedAs(theirs.body, theirs.revision);
    return;
  }
  pendingConflict = theirs;
  clearTimeout(saveTimer);
  setSaveIndicator('Not saved');
  const isOnlyMine = currentPageInfo.role === 'owner' && currentPageInfo.shareCount === 0;
  showNotice(isOnlyMine ? OWN_CONFLICT_MESSAGE : CONFLICT_MESSAGE, [
    { label: 'Load their version', onClick: loadTheirVersion },
    { label: 'Keep mine', onClick: keepMine },
  ], { closable: false });
}

function clearConflict() {
  if (!pendingConflict) return;
  pendingConflict = null;
  hideNotice();
}

function copyTitle(title) {
  return title.slice(0, MAX_TITLE_LENGTH - COPY_SUFFIX.length) + COPY_SUFFIX;
}

// Creates a page holding `body` under a fresh id. Returns whether it landed.
async function createCopy(title, body) {
  try {
    const res = await fetch(`/api/lyrics/${crypto.randomUUID()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: copyTitle(title), body }),
    });
    if (res.status === HTTP_OVER_LIMIT) await showPageLimitDialog(null);
    return res.ok;
  } catch {
    return false;
  }
}

// "Load their version": the writer's words become a new page first, so
// nothing is lost either way. The clipboard would be overwritten and forgotten.
async function loadTheirVersion() {
  const theirs = pendingConflict;
  if (!theirs) return;
  if (!await keepMineAsCopy()) return;
  showLyric({ id: currentLyricId, ...theirs });
  saveDraft();
  loadLyricsList();
}

// Saves the words on screen as their own page, leaving this one to whoever
// changed it. Returns whether that worked; on failure the conflict stays up.
async function keepMineAsCopy() {
  if (!pendingConflict) return true;
  setSaveIndicator('Saving...');
  if (!await createCopy(currentTitle, document.getElementById('lyrics').value)) {
    setSaveIndicator('Save failed');
    return false;
  }
  setSaveIndicator('');
  clearConflict();
  return true;
}

// "Keep mine": saves over their version on purpose.
function keepMine() {
  const theirs = pendingConflict;
  if (!theirs) return;
  currentRevision = theirs.revision;
  clearConflict();
  isKeepMineSave = true;
  performSave({ force: true });
}

// The page went live while this tab saved it the REST way (shared from
// another device, or the switch just turned on). Live from here: the last
// text the server took is the base, and anything typed since is rebased
// onto the room's text, so the conflict bar never shows.
function goLiveFromRest() {
  const session = currentLiveSession();
  if (!session || isLiveDraft) return;
  // A paused co-writer's poll found the switch back on.
  unlockEditor();
  clearTimeout(saveTimer);
  saveTimer = null;
  saveQueued = false;
  queuedForce = false;
  clearConflict();
  setSaveIndicator('');
  isLiveDraft = true;
  session.open({ id: currentLyricId, body: lastSavedBody, title: currentTitle });
  writeDraft();
}

// The poll found the page live. A save still on its way would land after
// live mode took the last saved words as its base, and its words would be
// rebased in a second time, so live mode waits for it.
async function goLiveWhenSaved() {
  const id = currentLyricId;
  try {
    await waitForSaves();
  } catch {
    // A failed save leaves the older base; the rebase keeps the words.
  }
  if (id === currentLyricId) goLiveFromRest();
}

// A save refused because the page went live. If the refused save, or one
// whose answer was lost, is what the server holds, it landed and is the
// base; otherwise the last save that landed is.
function goLiveAfterConflict(theirs, sentBody) {
  if (theirs.body === sentBody || theirs.body === unansweredBody) lastSavedBody = theirs.body;
  currentRevision = theirs.revision;
  unansweredBody = null;
  goLiveFromRest();
}

// The owner shared the page on screen and it is live now. The save due (or
// on its way) goes first, so live mode starts from what the server holds.
async function goLiveAfterShare(id) {
  if (id !== currentLyricId || isLiveDraft) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await performSave();
    await waitForSaves();
  } catch {
    // A failed save leaves the older base; the rebase keeps the words.
  }
  if (id === currentLyricId && !isLiveDraft) goLiveFromRest();
}

// The page on screen can no longer be saved where it is, so its words move to
// a new page of the writer's own. The save that follows creates it.
function saveAsNewPage({ message }) {
  closeLiveSession();
  currentLyricId = crypto.randomUUID();
  currentTitle = copyTitle(currentTitle);
  currentRevision = null;
  lastSavedBody = '';
  unansweredBody = null;
  setPageInfo({});
  updatePanelHeader();
  saveDraft();
  saveQueued = true;
  queuedForce = true;
  if (message) showNotice(message);
}

// Whether the words on screen differ from what the server last had.
function hasUnsavedEdits() {
  return document.getElementById('lyrics').value !== lastSavedBody;
}

// A synced live page writes its local copy, and the draft follows once
// that is on disk (followLocalCopy), so a reload never finds the two out
// of step.
function saveDraft() {
  if (liveHasLocalCopy()) {
    currentLiveSession().saveLocalCopy();
    return;
  }
  writeDraft();
}

function writeDraft() {
  // The sample is not the visitor's writing, and a draft holding it would
  // make them look like a returning visitor next time. The revision and
  // whether there are unsaved edits come back with it on reload.
  if (isSampleShowing()) return;
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
    id: currentLyricId,
    title: currentTitle,
    body: document.getElementById('lyrics').value,
    revision: currentRevision,
    dirty: hasUnsavedEdits(),
    info: currentPageInfo,
    live: isLiveDraft,
    copyAt: liveCopyStamp,
    copyText: liveCopyText,
    liveBase: liveConfirmedText,
    liveDelta,
  }));
}

// The local copy is on disk, so the draft can show its words. While
// synced, a co-writer's words may already be on screen past the copy, so
// the draft waits for the next copy rather than hold words the copy lacks.
// Off sync (after a signed-out close), only this person's typing can differ.
function followLocalCopy({ id, stamp, text, confirmed }) {
  if (id !== currentLyricId || !isLiveDraft) return;
  if (document.getElementById('lyrics').value !== text && liveHasLocalCopy()) return;
  liveCopyStamp = stamp;
  liveCopyText = text;
  liveConfirmedText = confirmed;
  liveDelta = null;
  writeDraft();
}

// The page is going (pagehide, hidden): the draft is written now, with the
// changes past the last copy that landed, since the copy on its way may not.
function keepDraftOnLeaving({ id, stamp, text, confirmed, delta }) {
  if (id !== currentLyricId || !isLiveDraft) return;
  liveCopyStamp = stamp;
  liveCopyText = text;
  liveConfirmedText = confirmed;
  liveDelta = delta;
  writeDraft();
}

// ── Page notice ──

// A strip under the title for what happened to the page: a save that someone
// else beat, or a page this account can no longer open. Amber buttons are for
// choices; a notice that only tells closes with a quiet ✕. The conflict bar
// has no ✕: one of its two choices has to be made.
function showNotice(text, actions = [], { closable = true } = {}) {
  const notice = document.getElementById('page-notice');
  document.getElementById('page-notice-text').textContent = text;
  const buttons = document.getElementById('page-notice-actions');
  buttons.innerHTML = '';
  for (const { label, onClick } of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample-clear';
    button.textContent = label;
    button.addEventListener('click', onClick);
    buttons.appendChild(button);
  }
  if (closable) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'lyrics-action-btn page-notice-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.title = 'Dismiss';
    close.textContent = '✕';
    close.addEventListener('click', hideNotice);
    buttons.appendChild(close);
  }
  notice.hidden = false;
}

function hideNotice() {
  document.getElementById('page-notice').hidden = true;
}

// A notice is about the page it was shown on, so another page drops it. The
// offline flag goes too, or its later clear would hide the next page's notice.
function clearPageNotice() {
  isOfflineNoticeShown = false;
  hideNotice();
}

function setSaveIndicator(text) {
  document.getElementById('save-indicator').textContent = text;
}

// The default name is stored as a real title, but on screen it is left blank
// so the placeholder shows instead.
function titleForDisplay(title) {
  return title === DEFAULT_TITLE ? '' : title;
}

// An unnamed page takes the sample's title while the sample is up. Only the
// placeholder changes, so the sample's name is never saved as the page's.
function placeholderTitle() {
  return sampleShowing ? SAMPLE_TITLE : PLACEHOLDER_TITLE;
}

function showPlaceholderTitle() {
  document.getElementById('lyrics-panel-title').dataset.placeholder = placeholderTitle();
}

// Where a saved page is named rather than edited. A saved page is never the
// sample, so it never takes the sample's title, even while the sample is up.
function titleForName(title) {
  return titleForDisplay(title) || PLACEHOLDER_TITLE;
}

function updatePanelHeader() {
  const el = document.getElementById('lyrics-panel-title');
  if (document.activeElement !== el) el.textContent = titleForDisplay(currentTitle);
  announcePageIfChanged();
}

// A title saved somewhere else: by a co-writer in the live room, or found by
// the poll (sharing.js).
function takeRemoteTitle(title) {
  currentTitle = title;
  updatePanelHeader();
  saveDraft();
  refreshListIfBehind();
}

// escapeHtml lives in app.js. These three scripts share one global scope, so a
// second copy here does not shadow anything — it replaces app.js's version for
// app.js's own callers too, because this file loads last. That collision has
// happened twice now; leave the single definition where it is.

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

document.getElementById('lyrics').addEventListener('input', () => {
  // A synced live page's draft goes out with its local copy (saveDraft).
  if (!liveHasLocalCopy()) writeDraft();
  scheduleSave();
});

const titleEl = document.getElementById('lyrics-panel-title');
titleEl.addEventListener('focus', () => {
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
titleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
});
titleEl.addEventListener('blur', () => {
  const newTitle = titleEl.textContent.trim() || DEFAULT_TITLE;
  titleEl.textContent = titleForDisplay(newTitle);
  if (newTitle !== currentTitle) {
    currentTitle = newTitle;
    saveDraft();
    if (window.currentUser) renameCurrentPage();
    else if (window.currentUser === null) loadLyricsList();
  }
});
document.getElementById('notebook-btn').addEventListener('click', handleNotebookClick);
document.getElementById('create-btn').addEventListener('click', handleCreateClick);
document.getElementById('new-lyric-btn').addEventListener('click', handleCreateClick);

// A sliding sidebar is put away first, or it would sit over the lit parts.
function handleTutorialClick() {
  closeLyricsList();
  const tour = isSampleShowing() ? 'sample' : 'page';
  if (window.replayCoachTour) window.replayCoachTour(tour);
}

for (const id of ['tutorial-btn', 'rail-tutorial-btn']) {
  document.getElementById(id).addEventListener('click', handleTutorialClick);
}
document.getElementById('rail-open-btn').addEventListener('click', openLyricsList);
document.getElementById('rail-new-btn').addEventListener('click', handleCreateClick);
document.getElementById('sidebar-close-btn').addEventListener('click', hideSidebar);
document.getElementById('sidebar-scrim').addEventListener('click', hideSidebar);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isSidebarOpen() && !isSidebarDocked()) hideSidebar();
});
SIDEBAR_DOCK_QUERY.addEventListener('change', placeSidebarForViewport);
placeSidebarForViewport();
// Two frames: the first paints the sidebar where it was placed, the second
// lets later changes animate.
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('sidebar-animate')));
window.refreshNotebook = loadLyricsList;
window.openNotebook = openNotebook;

// A pad holding nothing but the sample, or nothing at all, on a page the
// notebook does not have yet, is not the writer's work.
function isPadUnused() {
  const body = document.getElementById('lyrics').value;
  return (body === '' || isSampleShowing()) && !listedTitles.has(currentLyricId);
}

// Signing in lands on the page last worked on, the way a reload does, rather
// than on a blank one. Words typed before signing in stay where they are.
// Whether the notebook has been opened since this page loaded.
let hasOpenedNotebook = false;

// live.js and sharing.js load after this file, and opening the notebook
// can reopen a live page, so it waits until every script has run.
function whenScriptsReady() {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

async function openNotebook() {
  hasOpenedNotebook = true;
  try {
    await openNotebookPage();
  } finally {
    // The splash (splash.js) holds until the page is in place.
    document.dispatchEvent(new Event('notebook-opened'));
  }
}

async function openNotebookPage() {
  await whenScriptsReady();
  refreshSharingUi();
  const lyrics = await loadLyricsList();
  await reconcileRestoredDraft();
  if (typeof openPendingShare === 'function' && await openPendingShare()) return;
  if (lyrics && lyrics.length > 0 && isPadUnused()) await loadLyric(lyrics[0].id);
  saveSignedOutWords();
}

// Words written signed out were never saved: their saves were skipped with no
// one signed in. Without this, signing up showed them on an empty notebook,
// and they only went to the account once the writer typed again.
function saveSignedOutWords() {
  const isUnsavedPage = currentRevision === null && !listedTitles.has(currentLyricId);
  if (isUnsavedPage && !isPadUnused()) scheduleSave();
}

// What a reload put back on screen from the stored draft, until sign-in says
// whose it is. null once dealt with.
let restoredDraft = null;

// A reload shows the stored draft at once, but on a shared page it can be
// hours old. With no unsaved edits it is swapped for the page as it is now.
// With edits, its next save carries its revision, so a stale one gets the
// conflict bar instead of erasing newer work. A never-saved draft is created
// by saveSignedOutWords once the notebook opens.
async function reconcileRestoredDraft() {
  const draft = restoredDraft;
  restoredDraft = null;
  if (!draft || draft.id !== currentLyricId) return;

  if (draft.live) {
    await reopenLiveDraft(draft);
  } else if (draft.fromOldApp) {
    await checkOldAppDraft(draft.id);
  } else if (draft.revision !== null && !draft.dirty) {
    await refreshCleanDraft(draft.id);
  } else if (draft.revision !== null) {
    scheduleSave();
  }
}

// A draft of a live page goes back to its room from the device's local
// copy, so saved words are not repeated and unsaved ones are sent again.
// Off the switch, it is saved the REST way like any other draft.
async function reopenLiveDraft(draft) {
  clearTimeout(saveTimer);
  // live.js did not load. The draft may hold unsaved words, so the page
  // stays (leaving is still refused) and asks for a reload.
  if (!currentLiveSession()) return freezeUntilReload();
  let res;
  try {
    res = await fetch(`/api/lyrics/${draft.id}`);
  } catch {
    return retryReopen(draft);
  }
  if (draft.id !== currentLyricId) return;
  if (res.status === HTTP_NOT_FOUND) return keepOrDropLostDraft(draft);
  // Signed out, the reopen waits for signing in; any other failure is tried
  // again, or the page would stay unsaved and impossible to leave.
  if (res.status === HTTP_UNAUTHORIZED) return;
  if (!res.ok) return retryReopen(draft);
  const lyric = await res.json();
  if (!lyric.live) return reconcileAsRest(lyric);
  setPageInfo(lyric);
  currentRevision = lyric.revision;
  lastSavedBody = document.getElementById('lyrics').value;
  isLiveDraft = true;
  currentLiveSession().open({
    id: lyric.id, body: draft.liveBase ?? lyric.body, title: currentTitle,
    restore: { copyAt: draft.copyAt, shown: draft.shown, delta: draft.liveDelta },
  });
}

// The page could not be fetched (offline at load). It waits, saved by
// nobody, and tries again while it is still the page on screen.
function retryReopen(draft) {
  setTimeout(() => {
    if (draft.id === currentLyricId && isLiveDraft && !isLive()) reopenLiveDraft(draft);
  }, REOPEN_RETRY_MS);
}

async function keepOrDropLostDraft(draft) {
  const screen = document.getElementById('lyrics').value;
  const hasUnsaved = await currentLiveSession().hasUnsavedWords(draft.id, screen);
  if (draft.id !== currentLyricId) return;
  if (!hasUnsaved) return dropUnavailablePage();
  saveAsNewPage({ message: LOST_ACCESS_MESSAGE });
  performSave({ force: true });
}

// The page is no longer live (unshared, or the switch is off): its words
// are saved the REST way, like any other draft.
function reconcileAsRest(lyric) {
  isLiveDraft = false;
  forgetLiveCopyMarks();
  if (document.getElementById('lyrics').value === lyric.body) return showLyric(lyric);
  lastSavedBody = lyric.body;
  currentRevision = lyric.revision;
  scheduleSave();
}

// Swaps a clean draft for the page as it is now. Anything typed while the
// fetch was out wins: those words save on the draft's revision, and meet the
// conflict bar if the page moved on. The same goes for a page that is gone:
// with edits, its save turns them into "(my copy)".
async function refreshCleanDraft(id) {
  let res;
  try {
    res = await fetch(`/api/lyrics/${id}`);
  } catch {
    return;
  }
  if (id !== currentLyricId || hasUnsavedEdits()) return;
  if (res.status === HTTP_NOT_FOUND) {
    dropUnavailablePage();
    return;
  }
  if (res.ok) showLyric(await res.json());
}

// A draft from before revisions says neither its revision nor whether it was
// saved. The page is fetched to find out. Missing, it was never saved (or is
// someone else's, which its first save finds out). Different, the writer
// picks whose version to keep.
async function checkOldAppDraft(id) {
  let res;
  try {
    res = await fetch(`/api/lyrics/${id}`);
  } catch {
    return;
  }
  if (!res.ok || id !== currentLyricId) return;
  const lyric = await res.json();

  if (lyric.body === document.getElementById('lyrics').value) {
    currentRevision = lyric.revision;
    lastSavedBody = lyric.body;
    saveDraft();
    return;
  }
  handleConflict(lyric, null);
}

// A page with no unsaved edits that this account cannot open is let go,
// with no copy made: a removed editor must not end up with the owner's page.
function dropUnavailablePage() {
  startBlankPage(DEFAULT_TITLE);
  saveDraft();
  showNotice(UNAVAILABLE_MESSAGE);
}

// The group headings fold their pages. One listener, since the shared
// heading is rebuilt with each list.
document.getElementById('sidebar').addEventListener('click', event => {
  const toggle = event.target.closest('.list-group-toggle');
  if (toggle) toggleListGroup(toggle.dataset.group);
});
applyListFolds();
loadLyricsList();

// ── The open page, for the extension hook (extensions.js) ──

function currentPageSummary() {
  return {
    id: currentLyricId,
    role: currentPageInfo.role,
    live: isLiveDraft || isLive(),
    signedIn: Boolean(window.currentUser),
  };
}

// Every path that puts another page on screen ends in updatePanelHeader, so
// that is where an extension hears of it.
function announcePageIfChanged() {
  if (currentLyricId === lastAnnouncedPageId) return;
  lastAnnouncedPageId = currentLyricId;
  document.dispatchEvent(new CustomEvent('page-changed', { detail: currentPageSummary() }));
}

async function openPageById(id) {
  return await loadLyric(id) === HTTP_OK;
}

// A live page is replaced by its room, which saves its own words first. A
// page waiting to reopen live may hold words only this device has.
function replaceReadiness() {
  if (isLive()) return null;
  if (isLiveDraft || currentRevision === null) return REPLACE_NOT_READY;
  if (pendingConflict || isPageBlocked()) return REPLACE_NOT_READY;
  return null;
}

// Not flushSave: that turns a conflict into a copy. The editor is already
// locked, so one save covers every word typed.
async function flushBeforeReplace() {
  if (isLive()) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (hasUnsavedEdits()) await performSave();
  await waitForSaves();
}

// Words a failed save left behind are not on the server, so a replace would
// lose them. An empty page or the sample is never saved, and holds none.
function hasWordsToKeep() {
  if (isLive() || !hasUnsavedEdits()) return false;
  return document.getElementById('lyrics').value.trim() !== '' && !isSampleShowing();
}

// Answers whether the editor was editable, so a page locked for its own
// reason (a paused co-writer) stays locked after.
function lockForReplace() {
  const wasEditable = !document.getElementById('lyrics').readOnly;
  setEditorReadOnly(true);
  return wasEditable;
}

// A lock taken meanwhile, by showLyric for a page opened or by the room,
// stays.
function unlockAfterReplace(wasEditable) {
  if (wasEditable && !isEditorLocked && !isRoomReadOnly) setEditorReadOnly(false);
}

async function sendReplace(id, { title, body, tag }) {
  const words = tag === null ? { title, body } : { title, body, tag };
  const res = await fetch(`/api/lyrics/${id}/replace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(words),
  });
  if (res.status === HTTP_UNAUTHORIZED && window.handleSessionExpired) {
    window.handleSessionExpired();
  }
  const answer = res.status === HTTP_OK ? await res.json() : null;
  return { status: res.status, answer };
}

// The answer's revision and the words sent become the saved state, so the
// next save builds on the replace instead of meeting it as a conflict. A live
// page already has the words from its room.
function applyReplace(answer, words) {
  if (isLive()) return;
  showLyric({
    id: answer.id,
    title: answer.title,
    body: words.body,
    revision: answer.revision,
    live: answer.live,
    role: currentPageInfo.role,
    share_count: currentPageInfo.shareCount,
    owner_name: currentPageInfo.ownerName,
  });
  refreshListIfBehind();
}

function replaceWholePage(words) {
  return window.ReplaceFlow.runReplace({
    readiness: replaceReadiness,
    flush: flushBeforeReplace,
    pageId: () => currentLyricId,
    hasUnsaved: hasWordsToKeep,
    lock: lockForReplace,
    unlock: unlockAfterReplace,
    send: sendReplace,
    apply: applyReplace,
  }, words);
}

function showLiveIndicator(text) {
  const isOffline = Boolean(window.Live) && text === window.Live.TEXT.offline;
  setSaveIndicator(isOffline ? '' : text);
  if (isOffline) {
    showNotice(text);
    isOfflineNoticeShown = true;
  } else {
    clearOfflineNotice();
  }
}

function clearOfflineNotice() {
  if (!isOfflineNoticeShown) return;
  isOfflineNoticeShown = false;
  hideNotice();
}

// What the live session shows on the page (live.js). titleEl is declared
// further down, so it is read only when called.
window.livePage = {
  setIndicator: showLiveIndicator,
  onLocalCopySaved: followLocalCopy,
  onLeaving: keepDraftOnLeaving,
  showSaved() {
    clearOfflineNotice();
    showSaved();
  },
  onTitle: takeRemoteTitle,
  isTitleFocused: () => document.activeElement === titleEl,
  // Unsaved words become a page of the writer's own, as with a REST save.
  onUnavailable({ hasUnsaved }) {
    if (!hasUnsaved) return dropUnavailablePage();
    saveAsNewPage({ message: LOST_ACCESS_MESSAGE });
    performSave({ force: true });
  },
  // Signed out mid-session: the words stay on screen and in the local copy,
  // and signing back in (here, or after a reload) reopens the page live.
  onSessionExpired() {
    restoredDraft = { id: currentLyricId, revision: currentRevision, dirty: true, fromOldApp: false, live: true };
    suspendLiveSession();
    if (window.handleSessionExpired) window.handleSessionExpired();
  },
  reload() {
    saveDraft();
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0;
    if (Date.now() - last < RELOAD_GUARD_MS) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    location.reload();
  },
  notice: text => showNotice(text),
  checkStillLive,
  setReadOnly: isReadOnly => {
    isRoomReadOnly = isReadOnly;
    document.getElementById('lyrics').readOnly = isReadOnly;
  },
};

// The open page, for the scripts that load after this one (sharing.js,
// extensions.js, auth.js, save-nudge.js). They go through this object, not
// this file's globals, so its state has one way in.
window.OpenPage = {
  get id() { return currentLyricId; },
  get title() { return currentTitle; },
  get revision() { return currentRevision; },
  get role() { return currentPageInfo.role; },
  get ownerName() { return currentPageInfo.ownerName; },
  get shareCount() { return currentPageInfo.shareCount; },
  get isLiveDraft() { return isLiveDraft; },
  isSaving: () => saveInFlight !== null || pendingConflict !== null,
  hasUnsavedEdits,
  isSampleShowing,
  summary: currentPageSummary,
  setShareCount(count) {
    currentPageInfo.shareCount = count;
    saveDraft();
  },
  takeTitle: takeRemoteTitle,
  show: showLyric,
  load: loadLyric,
  openById: openPageById,
  replaceWhole: replaceWholePage,
  saveDraft,
  drop: dropUnavailablePage,
  goLiveWhenSaved,
  goLiveAfterShare,
  confirmSignOut,
  clear: clearLyricState,
};

// Signing out must not leave the last account's lyric on screen, in the
// notebook list, in the rhymes panel, or in the draft kept on this device.
// The draft is removed after the input event, which saves an empty one.
function clearLyricState() {
  closeLiveSession();
  forgetLiveCopies();
  clearTimeout(saveTimer);
  currentLyricId = crypto.randomUUID();
  currentTitle = DEFAULT_TITLE;
  lastSavedBody = '';
  currentRevision = null;
  unansweredBody = null;
  saveQueued = false;
  queuedForce = false;
  restoredDraft = null;
  pendingConflict = null;
  hideNotice();
  setPageInfo({});
  // Nothing an extension put in the panel may stay for the next person.
  if (window.SidePanel) window.SidePanel.close();
  if (typeof forgetPendingShare === 'function') forgetPendingShare();
  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  setSaveIndicator('');
  updatePanelHeader();
  closeLyricsList();
  listedTitles = new Map();
  lastListedLyrics = null;
  ownPageCount = null;
  document.getElementById('page-count').hidden = true;
  document.getElementById('lyrics-list-items').innerHTML = '';
  if (window.resetRhymesPanel) window.resetRhymesPanel();
}

// ── Sample verse ──

function isSampleShowing() {
  return sampleShowing && document.getElementById('lyrics').value === SAMPLE_VERSE;
}

// A visitor is new when this device has never kept a draft of theirs, even an
// empty one, and they have not already cleared the sample away. Storage that
// cannot be read counts as not new, so nobody's pad is ever covered by it.
function isFirstVisit() {
  try {
    return localStorage.getItem(DRAFT_STORAGE_KEY) === null
      && localStorage.getItem(SAMPLE_SEEN_KEY) === null;
  } catch {
    return false;
  }
}

function hasSeenSampleHint() {
  try {
    return localStorage.getItem(SAMPLE_HINT_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

// A pick made by the pointer on a real word, announced by app.js. Arrow keys,
// the sample's own pre-picked word and clicks that pick nothing never reach
// here.
function retireSampleHint() {
  if (!sampleShowing || hasSeenSampleHint()) return;
  if (window.hideSamplePointer) window.hideSamplePointer();
  try { localStorage.setItem(SAMPLE_HINT_SEEN_KEY, '1'); } catch {}
}

document.addEventListener('rhyme-pick', retireSampleHint);

let isSampleShownUnreported = false;

// isFirstVisit ignores sign-in, so the event says which kind of visitor saw
// the sample. The sign-in check answers after this script runs, so the event
// waits for it.
function reportSampleShown() {
  if (!isSampleShownUnreported || window.currentUser === undefined) return;
  isSampleShownUnreported = false;
  trackEvent('sample_shown', { signed_in: Boolean(window.currentUser) });
}

document.addEventListener('auth-checked', reportSampleShown);

function showSample() {
  const textarea = document.getElementById('lyrics');
  sampleShowing = true;
  isSampleShownUnreported = true;
  reportSampleShown();
  document.getElementById('sample-clear').hidden = false;
  document.getElementById('sample-bar').hidden = false;
  showPlaceholderTitle();
  textarea.value = SAMPLE_VERSE;
  textarea.dispatchEvent(new Event('input'));
  if (window.showRhymesForWord) {
    const start = SAMPLE_VERSE.indexOf(SAMPLE_PICKED_WORD);
    window.showRhymesForWord(SAMPLE_PICKED_WORD, { start, end: start + SAMPLE_PICKED_WORD.length });
  }
  // The tour teaches what the pointer would, so the two never show at once.
  const isTouring = Boolean(window.startCoachTour && window.startCoachTour('sample'));
  if (!isTouring && !hasSeenSampleHint() && window.showSamplePointer) {
    window.showSamplePointer();
  }
}

// Clearing it and writing over it both make the pad the visitor's own, so
// the sample does not come back after either.
function endSample() {
  sampleShowing = false;
  document.getElementById('sample-bar').hidden = true;
  document.getElementById('sample-clear').hidden = true;
  if (window.hideSamplePointer) window.hideSamplePointer();
  showPlaceholderTitle();
  if (window.currentUser === null) loadLyricsList();
  try { localStorage.setItem(SAMPLE_SEEN_KEY, '1'); } catch {}
}

// The moment a visitor becomes a writer. Loading a page or the sample fires
// input too, but only a person's typing is trusted, so those never count.
function trackFirstWrite() {
  trackEventOnce(FIRST_WRITE_KEY, 'first_write');
}

function clearSample() {
  trackEvent('sample_cleared', { trigger: 'button' });
  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));
  if (window.resetRhymesPanel) window.resetRhymesPanel();
  textarea.focus();
}

// Listening on the scroller in the capture phase runs this before the
// editor's own input handlers, so the button is gone by the time they measure
// the page, and before the draft handler below decides whether to save.
document.querySelector('.lyrics-area').addEventListener('input', (event) => {
  if (sampleShowing && !isSampleShowing()) endSample();
  if (event.isTrusted) trackFirstWrite();
}, true);
document.getElementById('sample-clear').addEventListener('click', clearSample);

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    const { id, title, body } = draft;
    // A page with a name but no words yet still comes back under its name.
    if (!body && (!title || title === DEFAULT_TITLE)) return;
    currentLyricId = id || currentLyricId;
    currentTitle = title || DEFAULT_TITLE;
    // Set before the input event below, which writes the draft again.
    currentRevision = Number.isSafeInteger(draft.revision) ? draft.revision : null;
    if (draft.info && typeof draft.info === 'object') {
      setPageInfo({
        role: draft.info.role, share_count: draft.info.shareCount, owner_name: draft.info.ownerName,
      });
    }
    lastSavedBody = currentRevision !== null && !draft.dirty ? (body || '') : '';
    restoredDraft = {
      id: currentLyricId,
      revision: currentRevision,
      dirty: Boolean(draft.dirty),
      fromOldApp: !('revision' in draft),
      // Drafts written before the local copy marked a live page with liveBase.
      live: draft.live === true || typeof draft.liveBase === 'string',
      copyAt: Number.isSafeInteger(draft.copyAt) ? draft.copyAt : null,
      copyText: typeof draft.copyText === 'string' ? draft.copyText : null,
      liveBase: typeof draft.liveBase === 'string' ? draft.liveBase : null,
      liveDelta: typeof draft.liveDelta === 'string' ? draft.liveDelta : null,
    };
    // The words the copy at copyAt held: typing before a sync is not in them.
    restoredDraft.shown = restoredDraft.copyText ?? (body || '');
    // Kept until the reconcile, so the draft written again below (and any
    // written while offline) still marks the page as live.
    isLiveDraft = restoredDraft.live;
    liveCopyStamp = restoredDraft.copyAt;
    liveCopyText = restoredDraft.copyText;
    liveConfirmedText = restoredDraft.liveBase;
    liveDelta = restoredDraft.liveDelta;
    if (body) {
      const textarea = document.getElementById('lyrics');
      textarea.value = body;
      textarea.dispatchEvent(new Event('input'));
    }
    updatePanelHeader();
  } catch {}
}

// The word is taken once and dropped from the address, so a reload or a
// copied link is the plain editor again.
function takeLinkedWord() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(LINKED_WORD_PARAM)) return null;
  const word = url.searchParams.get(LINKED_WORD_PARAM).trim().toLowerCase();
  url.searchParams.delete(LINKED_WORD_PARAM);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  return LINKED_WORD_PATTERN.test(word) ? word : null;
}

// Someone who came for one word's rhymes gets a blank pad beside them, not
// the sample with its own word picked. A draft of theirs still comes back.
function startEditor() {
  const linkedWord = takeLinkedWord();
  const isNewVisitor = isFirstVisit();
  if (linkedWord === null && isNewVisitor) showSample();
  else restoreDraft();
  if (linkedWord === null || !window.showRhymesForWord) return;
  window.showRhymesForWord(linkedWord, null);
  trackEvent('linked_word_opened', { word: linkedWord });
  // The sample's tour never runs for them, so they get one of their own.
  if (isNewVisitor && window.startCoachTour) window.startCoachTour('word', linkedWord);
}

startEditor();
announcePageIfChanged();

// Every app script is revalidated on load, so the sign-in check can answer
// while this file is still on its way; auth.js then finds no openNotebook to
// call, and a reloaded draft (a live one above all) would never be picked up.
whenScriptsReady().then(() => {
  if (window.currentUser && !hasOpenedNotebook) openNotebook();
});
