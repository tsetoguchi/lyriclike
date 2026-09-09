let currentLyricId = crypto.randomUUID();
let currentTitle = 'Untitled';
let lastSavedBody = '';
let saveTimer = null;

function openLyricsList() {
  document.getElementById('lyrics-list-overlay').classList.add('open');
  loadLyricsList();
}

function closeLyricsList() {
  document.getElementById('lyrics-list-overlay').classList.remove('open');
}

async function loadLyricsList() {
  const container = document.getElementById('lyrics-list-items');
  container.innerHTML = '<div class="lyrics-list-empty">Loading...</div>';

  try {
    const res = await fetch('/api/lyrics');
    if (!res.ok) { container.innerHTML = '<div class="lyrics-list-empty">Failed to load</div>'; return; }
    const lyrics = await res.json();

    if (lyrics.length === 0) {
      container.innerHTML = '<div class="lyrics-list-empty">No saved lyrics yet</div>';
      return;
    }

    container.innerHTML = '';
    for (const lyric of lyrics) {
      const item = document.createElement('div');
      item.className = 'lyrics-list-item' + (lyric.id === currentLyricId ? ' active' : '');

      item.innerHTML = `
        <div class="lyrics-list-item-main">
          <span class="lyrics-list-title">${escapeHtml(lyric.title)}</span>
          <span class="lyrics-list-date">${formatDate(lyric.updated_at)}</span>
        </div>
        <div class="lyrics-list-actions">
          <button class="lyrics-action-btn">Rename</button>
          <button class="lyrics-action-btn lyrics-delete-btn">Delete</button>
        </div>
      `;

      item.querySelector('.lyrics-list-item-main').addEventListener('click', () => loadLyric(lyric.id));
      item.querySelectorAll('.lyrics-action-btn')[0].addEventListener('click', e => { e.stopPropagation(); renameLyric(lyric.id, lyric.title); });
      item.querySelectorAll('.lyrics-action-btn')[1].addEventListener('click', e => { e.stopPropagation(); deleteLyric(lyric.id); });

      container.appendChild(item);
    }
  } catch {
    container.innerHTML = '<div class="lyrics-list-empty">Failed to load</div>';
  }
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
  closeLyricsList();
}

function newLyric() {
  currentLyricId = crypto.randomUUID();
  currentTitle = 'Untitled';
  lastSavedBody = '';

  const textarea = document.getElementById('lyrics');
  textarea.value = '';
  textarea.dispatchEvent(new Event('input'));

  setSaveIndicator('');
  updatePanelHeader();
  closeLyricsList();
}

async function deleteLyric(id) {
  if (!confirm('Delete this lyric?')) return;
  await fetch(`/api/lyrics/${id}`, { method: 'DELETE' });

  if (id === currentLyricId) {
    currentLyricId = crypto.randomUUID();
    currentTitle = 'Untitled';
    document.getElementById('lyrics').value = '';
    document.getElementById('lyrics').dispatchEvent(new Event('input'));
    updatePanelHeader();
  }

  loadLyricsList();
}

async function renameLyric(id, oldTitle) {
  const newTitle = prompt('Rename:', oldTitle);
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
  if (body === lastSavedBody) return;

  setSaveIndicator('Saving...');
  try {
    const res = await fetch(`/api/lyrics/${currentLyricId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: currentTitle, body }),
    });

    if (res.status === 401) {
      setSaveIndicator('Sign in to save');
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
  } catch {
    setSaveIndicator('Save failed');
  }
}

function saveDraft() {
  localStorage.setItem('swag_draft', JSON.stringify({
    id: currentLyricId,
    title: currentTitle,
    body: document.getElementById('lyrics').value,
  }));
}

function setSaveIndicator(text) {
  document.getElementById('save-indicator').textContent = text;
}

function updatePanelHeader() {
  const el = document.getElementById('lyrics-panel-title');
  if (document.activeElement !== el) el.textContent = currentTitle;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
  const newTitle = titleEl.textContent.trim() || 'Untitled';
  titleEl.textContent = newTitle;
  if (newTitle !== currentTitle) {
    currentTitle = newTitle;
    saveDraft();
    clearTimeout(saveTimer);
    performSave();
  }
});
document.getElementById('my-lyrics-btn').addEventListener('click', openLyricsList);
document.getElementById('notebook-btn').addEventListener('click', openLyricsList);
document.getElementById('create-btn').addEventListener('click', newLyric);
document.getElementById('new-lyric-btn').addEventListener('click', newLyric);
document.getElementById('close-lyrics-list-btn').addEventListener('click', closeLyricsList);
document.getElementById('lyrics-list-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('lyrics-list-overlay')) closeLyricsList();
});

// Expose state for autosave (step 6).
window.getLyricState = () => ({ id: currentLyricId, title: currentTitle });

function restoreDraft() {
  try {
    const raw = localStorage.getItem('swag_draft');
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

restoreDraft();
