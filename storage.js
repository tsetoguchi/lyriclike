const HTTP_UNAUTHORIZED = 401;
const DEFAULT_TITLE = 'Untitled';
const DRAFT_STORAGE_KEY = 'swag_draft';
// Set once a visitor has cleared the sample verse or written over it.
const SAMPLE_SEEN_KEY = 'sample_seen';
// Set once this device has reported its first typed word to analytics.
const FIRST_WRITE_KEY = 'first_write_tracked';
// Shown to a first-time visitor so the counts and rhyme letters are on screen
// before they have written anything. ABAB, so the letters show the pattern.
const SAMPLE_VERSE = [
  'I left the porch light on for you',
  'The way I did the year before',
  'The tea is cold, the sky is blue',
  'And still I listen for the door',
].join('\n');
// The word the rhymes panel opens on: the first line's last word.
const SAMPLE_PICKED_WORD = 'you';
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
const LOST_ACCESS_MESSAGE =
  'You no longer have access to this page. Your text is saved as a new page.';
const UNAVAILABLE_MESSAGE = "This page isn't available to this account.";
const COPY_SUFFIX = ' (my copy)';
const MAX_TITLE_LENGTH = 300;
// HTTP_NOT_FOUND comes from app.js: the scripts share one global scope.
const HTTP_CONFLICT = 409;

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
// Whose the open page is and how many people have it. Sharing (sharing.js)
// reads it for the Share button, the "Shared by" line and the poll.
let currentPageInfo = { role: 'owner', shareCount: 0, ownerName: '' };

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

// ── Dialog ──

// One panel for everything the app needs to ask. It comes in three shapes:
// a question with a field (naming a page), a question without one (deleting
// a page), and a question whose field has to be typed correctly before the
// answer counts (deleting an account with only Google). A field can also be a
// password (deleting an account that has one). Resolves with the field's contents, or
// true when there is no field, or null if the person backed out.
let resolveDialog = null;
let requiredAnswer = null;

function openDialog({ heading, message, confirmLabel, danger, field }) {
  const overlay = document.getElementById('dialog-overlay');
  const input = document.getElementById('dialog-input');
  const confirm = document.getElementById('dialog-confirm');
  const messageEl = document.getElementById('dialog-message');
  const fieldEl = document.getElementById('dialog-field');

  document.getElementById('dialog-title').textContent = heading;
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
  if (window.currentUser === null) {
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
    listedTitles = new Map(lyrics.map(lyric => [lyric.id, lyric.title]));
    const own = lyrics.filter(lyric => !lyric.shared);
    const shared = lyrics.filter(lyric => lyric.shared);
    if (own.length === 0) {
      showListMessage(container, EMPTY_NOTEBOOK_MESSAGE);
    } else {
      container.innerHTML = '';
      for (const lyric of own) container.appendChild(buildListItem(lyric));
    }
    if (shared.length > 0) {
      const label = document.createElement('h2');
      label.className = 'sidebar-label lyrics-list-group';
      label.textContent = SHARED_GROUP_LABEL;
      container.appendChild(label);
      for (const lyric of shared) container.appendChild(buildListItem(lyric));
    }
    return lyrics;
  } catch {
    showListMessage(container, LOAD_FAILED_MESSAGE);
  }
}

const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 8v6M14 11h6"/></svg>';
const LEAVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

// A page is its title, like a chat in Gemini or ChatGPT. Its actions wait at
// the end of the row until it is hovered or focused. Share is there as well as
// beside the title, because phones have no title row. A page shared with this
// person shows whose it is, and can be left rather than deleted.
function buildListItem(lyric) {
  const item = document.createElement('div');
  item.className = 'lyrics-list-item' + (lyric.id === currentLyricId ? ' active' : '');
  item.dataset.id = lyric.id;
  const title = escapeHtml(titleForName(lyric.title));
  const owner = lyric.shared ? escapeHtml(lyric.owner_name || '') : '';
  const lastAction = lyric.shared
    ? `<button class="lyrics-action-btn lyrics-delete-btn" data-action="leave" aria-label="Leave ${title}" title="Leave">${LEAVE_ICON}</button>`
    : `<button class="lyrics-action-btn lyrics-delete-btn" data-action="delete" aria-label="Delete ${title}" title="Delete">${TRASH_ICON}</button>`;
  const shareAction = lyric.shared ? ''
    : `<button class="lyrics-action-btn" data-action="share" aria-label="Share ${title}" title="Share">${SHARE_ICON}</button>`;

  item.innerHTML = `
    <button class="lyrics-list-open" title="${title} · ${formatDate(lyric.created_at)}">${title}${owner ? `<span class="lyrics-list-owner">${owner}</span>` : ''}</button>
    <div class="lyrics-list-actions">
      ${shareAction}
      <button class="lyrics-action-btn" data-action="rename" aria-label="Rename ${title}" title="Rename">${PENCIL_ICON}</button>
      ${lastAction}
    </div>
  `;

  item.querySelector('.lyrics-list-open').addEventListener('click', () => {
    trackEvent('page_opened');
    loadLyric(lyric.id);
  });
  const actions = {
    share: () => { if (typeof openShareDialog === 'function') openShareDialog(lyric.id, lyric.title); },
    rename: () => renameLyric(lyric.id, lyric.title),
    delete: () => deleteLyric(lyric),
    leave: () => deleteLyric(lyric),
  };
  for (const button of item.querySelectorAll('.lyrics-action-btn')) {
    button.addEventListener('click', actions[button.dataset.action]);
  }
  return item;
}

// The page a signed-out writer has, shown the way a saved one would be so
// the notebook they would get is already in view.
function showLocalPage(container) {
  const title = escapeHtml(titleForName(currentTitle));
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
  for (const item of document.querySelectorAll('#lyrics-list-items .lyrics-list-item[data-id]')) {
    item.classList.toggle('active', item.dataset.id === currentLyricId);
  }
}

// After a save, the list is only fetched again if it shows this page under
// another title, or not at all.
function refreshListIfBehind() {
  if (listedTitles.get(currentLyricId) !== currentTitle) loadLyricsList();
}

function showListMessage(container, message) {
  container.innerHTML = '<div class="lyrics-list-empty">' + escapeHtml(message) + '</div>';
}

// Fetches a page and puts it on screen. Returns the fetch's status, or 0 when
// the request itself failed. The save waiting on the page being left goes out
// first, so its last words are not lost.
async function loadLyric(id) {
  if (!await flushSave()) return 0;
  let res;
  try {
    res = await fetch(`/api/lyrics/${id}`);
  } catch {
    return 0;
  }
  if (!res.ok) return res.status;
  const lyric = await res.json();

  showLyric(lyric);
  markActiveListItem();
  closeLyricsList();
  return res.status;
}

// The revision and the saved text are set before the input event, which
// would otherwise schedule a save of text that is already on the server.
function showLyric(lyric) {
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
}

// A new page is on screen but not on the server, so its first save creates it.
function startBlankPage(title) {
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
}

async function createLyric() {
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
  await fetch(`/api/lyrics/${id}`, { method: 'DELETE' });

  if (id === currentLyricId) startBlankPage(DEFAULT_TITLE);

  loadLyricsList();
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
    loadLyricsList();
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
  if (pendingConflict) return keepMineAsCopy();
  clearTimeout(saveTimer);
  saveTimer = null;
  if (hasUnsavedEdits()) await performSave();
  await waitForSaves();
  return true;
}

// The sample verse is not the visitor's writing, so it goes out as an empty
// page. The answer is only used if its page is still the one open: a slow
// save on one page must not hand its revision to the next.
async function sendSave(force) {
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
    const { revision } = await res.json();
    savedAs(body, revision);
    return;
  }
  if (res.status === HTTP_CONFLICT) {
    handleConflict(await res.json(), body);
    return;
  }
  if (res.status === HTTP_NOT_FOUND) {
    // A create that is refused means the id is someone else's. An update that
    // is refused means the page was deleted, or its owner took this person
    // off it, while they were typing.
    saveAsNewPage({ message: isCreate ? null : LOST_ACCESS_MESSAGE });
    return;
  }
  setSaveIndicator('Save failed');
}

function savedAs(body, revision) {
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
  showNotice(CONFLICT_MESSAGE, [
    { label: 'Load their version', onClick: loadTheirVersion },
    { label: 'Keep mine', onClick: keepMine },
  ]);
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
  performSave({ force: true });
}

// The page on screen can no longer be saved where it is, so its words move to
// a new page of the writer's own. The save that follows creates it.
function saveAsNewPage({ message }) {
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
  if (message) showNotice(message, [{ label: 'OK', onClick: hideNotice }]);
}

// Whether the words on screen differ from what the server last had.
function hasUnsavedEdits() {
  return document.getElementById('lyrics').value !== lastSavedBody;
}

function saveDraft() {
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
  }));
}

// ── Page notice ──

// A strip under the title for what happened to the page: a save that someone
// else beat, or a page this account can no longer open.
function showNotice(text, actions) {
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
  notice.hidden = false;
}

function hideNotice() {
  document.getElementById('page-notice').hidden = true;
}

function setSaveIndicator(text) {
  document.getElementById('save-indicator').textContent = text;
}

// The default name is stored as a real title, but on screen it is left blank
// so the placeholder shows instead.
function titleForDisplay(title) {
  return title === DEFAULT_TITLE ? '' : title;
}

// Where a page is named rather than edited, the unnamed page reads as the
// editor's placeholder does.
function titleForName(title) {
  return titleForDisplay(title) || PLACEHOLDER_TITLE;
}

function updatePanelHeader() {
  const el = document.getElementById('lyrics-panel-title');
  if (document.activeElement !== el) el.textContent = titleForDisplay(currentTitle);
}

// escapeHtml lives in app.js. These three scripts share one global scope, so a
// second copy here does not shadow anything — it replaces app.js's version for
// app.js's own callers too, because this file loads last. That collision has
// happened twice now; leave the single definition where it is.

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

document.getElementById('lyrics').addEventListener('input', () => {
  saveDraft();
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
async function openNotebook() {
  refreshSharingUi();
  const lyrics = await loadLyricsList();
  await reconcileRestoredDraft();
  if (typeof openPendingShare === 'function' && await openPendingShare()) return;
  if (lyrics && lyrics.length > 0 && isPadUnused()) await loadLyric(lyrics[0].id);
}

// What a reload put back on screen from the stored draft, until sign-in says
// whose it is. null once dealt with.
let restoredDraft = null;

// A reload shows the stored draft at once, but on a shared page it can be
// hours old. With no unsaved edits it is swapped for the page as it is now.
// With edits, its next save carries its revision, so a stale one gets the
// conflict bar instead of erasing newer work. A never-saved draft is left to
// be created by its first save, as before.
async function reconcileRestoredDraft() {
  const draft = restoredDraft;
  restoredDraft = null;
  if (!draft || draft.id !== currentLyricId) return;

  if (draft.fromOldApp) {
    await checkOldAppDraft(draft.id);
  } else if (draft.revision !== null && !draft.dirty) {
    await refreshCleanDraft(draft.id);
  } else if (draft.revision !== null) {
    scheduleSave();
  }
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
  showNotice(UNAVAILABLE_MESSAGE, [{ label: 'OK', onClick: hideNotice }]);
}
loadLyricsList();

// Expose state for autosave (step 6).
window.getLyricState = () => ({ id: currentLyricId, title: currentTitle });
window.clearLyricState = clearLyricState;

// Signing out must not leave the last account's lyric on screen, in the
// notebook list, in the rhymes panel, or in the draft kept on this device.
// The draft is removed after the input event, which saves an empty one.
function clearLyricState() {
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
  if (typeof forgetPendingShare === 'function') forgetPendingShare();
  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  setSaveIndicator('');
  updatePanelHeader();
  closeLyricsList();
  listedTitles = new Map();
  document.getElementById('lyrics-list-items').innerHTML = '';
  if (window.resetRhymesPanel) window.resetRhymesPanel();
}

// ── Sample verse ──

let sampleShowing = false;

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

function showSample() {
  const textarea = document.getElementById('lyrics');
  sampleShowing = true;
  document.getElementById('sample-bar').hidden = false;
  textarea.value = SAMPLE_VERSE;
  textarea.dispatchEvent(new Event('input'));
  if (window.showRhymesForWord) {
    const start = SAMPLE_VERSE.indexOf(SAMPLE_PICKED_WORD);
    window.showRhymesForWord(SAMPLE_PICKED_WORD, { start, end: start + SAMPLE_PICKED_WORD.length });
  }
}

// Clearing it and writing over it both make the pad the visitor's own, so
// the sample does not come back after either.
function endSample() {
  sampleShowing = false;
  document.getElementById('sample-bar').hidden = true;
  try { localStorage.setItem(SAMPLE_SEEN_KEY, '1'); } catch {}
}

// The moment a visitor becomes a writer. Loading a page or the sample fires
// input too, but only a person's typing is trusted, so those never count.
function trackFirstWrite() {
  try {
    if (localStorage.getItem(FIRST_WRITE_KEY) !== null) return;
    localStorage.setItem(FIRST_WRITE_KEY, '1');
  } catch {
    return;
  }
  trackEvent('first_write');
}

function clearSample() {
  trackEvent('sample_cleared');
  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));
  if (window.resetRhymesPanel) window.resetRhymesPanel();
  textarea.focus();
}

// Listening on the scroller in the capture phase runs this before the
// editor's own input handlers, so the link is gone by the time they measure
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
    };
    if (body) {
      const textarea = document.getElementById('lyrics');
      textarea.value = body;
      textarea.dispatchEvent(new Event('input'));
    }
    updatePanelHeader();
  } catch {}
}

if (isFirstVisit()) showSample();
else restoreDraft();
