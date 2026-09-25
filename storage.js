const HTTP_UNAUTHORIZED = 401;
const DEFAULT_TITLE = 'Untitled';
const DRAFT_STORAGE_KEY = 'swag_draft';
// Set once a visitor has cleared the sample verse or written over it.
const SAMPLE_SEEN_KEY = 'sample_seen';
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
const NEW_LYRIC_HEADING = 'New page';
const DELETE_LYRIC_HEADING = 'Delete page';
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

let currentLyricId = crypto.randomUUID();
let currentTitle = 'Untitled';
let lastSavedBody = '';
let saveTimer = null;

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

// Signed out, a new page would have no notebook to live in, so New page asks
// for an account instead, in the sign-in modal's Create account view.
// currentUser is null only once the sign-in check has answered.
async function promptForAccount() {
  if (window.openAuthModal) {
    await window.openAuthModal({ view: 'sign-up', message: CREATE_ACCOUNT_MESSAGE });
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

async function loadLyricsList() {
  const container = document.getElementById('lyrics-list-items');

  // Signed out, the only page is the one in this browser. Before the sign-in
  // check answers there is nothing to say yet.
  if (window.currentUser === null) {
    showLocalPage(container);
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
    if (lyrics.length === 0) {
      showListMessage(container, EMPTY_NOTEBOOK_MESSAGE);
      return;
    }

    container.innerHTML = '';
    for (const lyric of lyrics) {
      container.appendChild(buildListItem(lyric));
    }
  } catch {
    showListMessage(container, LOAD_FAILED_MESSAGE);
  }
}

const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

// A page is its title, like a chat in Gemini or ChatGPT. Rename and delete
// wait at the end of the row until it is hovered or focused.
function buildListItem(lyric) {
  const item = document.createElement('div');
  item.className = 'lyrics-list-item' + (lyric.id === currentLyricId ? ' active' : '');
  item.dataset.id = lyric.id;
  const title = escapeHtml(lyric.title);

  item.innerHTML = `
    <button class="lyrics-list-open" title="${title} · ${formatDate(lyric.created_at)}">${title}</button>
    <div class="lyrics-list-actions">
      <button class="lyrics-action-btn" aria-label="Rename ${title}" title="Rename">${PENCIL_ICON}</button>
      <button class="lyrics-action-btn lyrics-delete-btn" aria-label="Delete ${title}" title="Delete">${TRASH_ICON}</button>
    </div>
  `;

  item.querySelector('.lyrics-list-open').addEventListener('click', () => loadLyric(lyric.id));
  const [renameBtn, deleteBtn] = item.querySelectorAll('.lyrics-action-btn');
  renameBtn.addEventListener('click', () => renameLyric(lyric.id, lyric.title));
  deleteBtn.addEventListener('click', () => deleteLyric(lyric.id, lyric.title));
  return item;
}

// The page a signed-out writer has, shown the way a saved one would be so
// the notebook they would get is already in view.
function showLocalPage(container) {
  const title = escapeHtml(titleForDisplay(currentTitle) || PLACEHOLDER_TITLE);
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

async function loadLyric(id) {
  const res = await fetch(`/api/lyrics/${id}`);
  if (!res.ok) return;
  const lyric = await res.json();

  currentLyricId = lyric.id;
  currentTitle = lyric.title;
  lastSavedBody = lyric.body;

  const textarea = document.getElementById('lyrics');
  textarea.value = lyric.body;
  textarea.dispatchEvent(new Event('input'));

  setSaveIndicator('');
  updatePanelHeader();
  markActiveListItem();
  closeLyricsList();
}

async function createLyric() {
  const name = await askForLyricName({ heading: NEW_LYRIC_HEADING, confirmLabel: 'Create', value: '' });
  if (name === null) return;

  currentLyricId = crypto.randomUUID();
  currentTitle = name.trim() || DEFAULT_TITLE;
  lastSavedBody = '';

  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));

  setSaveIndicator('');
  updatePanelHeader();
  saveDraft();
  closeLyricsList();
  textarea.focus();

  await saveNewLyric();
}

// A lyric someone has just named belongs in the notebook straight away, even
// with no words in it yet. performSave() deliberately skips an empty body, so
// the first write goes out from here.
async function saveNewLyric() {
  if (!window.currentUser) return;

  setSaveIndicator('Saving...');
  try {
    const res = await fetch(`/api/lyrics/${currentLyricId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: currentTitle, body: '' }),
    });
    if (!res.ok) { setSaveIndicator('Save failed'); return; }
    lastSavedBody = '';
    setSaveIndicator('Saved');
    setTimeout(() => setSaveIndicator(''), 3000);
    refreshListIfBehind();
  } catch {
    setSaveIndicator('Save failed');
  }
}

async function deleteLyric(id, title) {
  const confirmed = await openDialog({
    heading: DELETE_LYRIC_HEADING,
    message: `“${title}” will be deleted, along with everything written in it. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;

  await fetch(`/api/lyrics/${id}`, { method: 'DELETE' });

  if (id === currentLyricId) {
    currentLyricId = crypto.randomUUID();
    currentTitle = DEFAULT_TITLE;
    document.getElementById('lyrics').value = '';
    document.getElementById('lyrics').dispatchEvent(new Event('input'));
    updatePanelHeader();
  }

  loadLyricsList();
}

async function renameLyric(id, oldTitle) {
  const entered = await askForLyricName({ heading: RENAME_HEADING, confirmLabel: 'Rename', value: oldTitle });
  if (entered === null) return;
  const newTitle = entered.trim();
  if (!newTitle || newTitle === oldTitle) return;

  const res = await fetch(`/api/lyrics/${id}`);
  if (!res.ok) return;
  const lyric = await res.json();

  await fetch(`/api/lyrics/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: newTitle, body: lyric.body }),
  });

  if (id === currentLyricId) {
    currentTitle = newTitle;
    updatePanelHeader();
  }

  loadLyricsList();
}

function scheduleSave() {
  if (!window.currentUser) return;
  clearTimeout(saveTimer);
  setSaveIndicator('Unsaved');
  saveTimer = setTimeout(performSave, 1000);
}

async function performSave() {
  const body = document.getElementById('lyrics').value;
  if (!body.trim()) return;
  if (isSampleShowing()) return;
  if (body === lastSavedBody) return;

  setSaveIndicator('Saving...');
  try {
    const res = await fetch(`/api/lyrics/${currentLyricId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: currentTitle, body }),
    });

    if (res.status === 401) {
      setSaveIndicator('Log in to save');
      if (window.handleSessionExpired) window.handleSessionExpired();
      return;
    }

    if (!res.ok) {
      setSaveIndicator('Save failed');
      return;
    }

    lastSavedBody = body;
    setSaveIndicator('Saved');
    setTimeout(() => setSaveIndicator(''), 3000);
    refreshListIfBehind();
  } catch {
    setSaveIndicator('Save failed');
  }
}

function saveDraft() {
  // The sample is not the visitor's writing, and a draft holding it would
  // make them look like a returning visitor next time.
  if (isSampleShowing()) return;
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
    id: currentLyricId,
    title: currentTitle,
    body: document.getElementById('lyrics').value,
  }));
}

function setSaveIndicator(text) {
  document.getElementById('save-indicator').textContent = text;
}

// The default name is stored as a real title, but on screen it is left blank
// so the placeholder shows instead.
function titleForDisplay(title) {
  return title === DEFAULT_TITLE ? '' : title;
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
    clearTimeout(saveTimer);
    performSave();
    if (window.currentUser === null) loadLyricsList();
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

function clearSample() {
  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));
  if (window.resetRhymesPanel) window.resetRhymesPanel();
  textarea.focus();
}

// Listening on the scroller in the capture phase runs this before the
// editor's own input handlers, so the link is gone by the time they measure
// the page, and before the draft handler below decides whether to save.
document.querySelector('.lyrics-area').addEventListener('input', () => {
  if (sampleShowing && !isSampleShowing()) endSample();
}, true);
document.getElementById('sample-clear').addEventListener('click', clearSample);

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    const { id, title, body } = JSON.parse(raw);
    if (!body) return;
    currentLyricId = id || currentLyricId;
    currentTitle = title || 'Untitled';
    const textarea = document.getElementById('lyrics');
    textarea.value = body;
    textarea.dispatchEvent(new Event('input'));
    updatePanelHeader();
  } catch {}
}

if (isFirstVisit()) showSample();
else restoreDraft();
