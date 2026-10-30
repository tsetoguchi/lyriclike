// The notebook: the list of pages in the sidebar. It reaches the page on
// screen only through window.OpenPage (storage.js), which loads after this
// file, so it is read only when called.
(function exposeNotebookList() {
  'use strict';

  const HTTP_UNAUTHORIZED = 401;
  const LOADING_MESSAGE = 'Loading...';
  const EMPTY_NOTEBOOK_MESSAGE = 'You have no pages';
  const SIGNED_OUT_MESSAGE = 'Log in to see your notebook';
  const LOAD_FAILED_MESSAGE = 'Could not open your notebook';
  const SHARED_GROUP_LABEL = 'Shared with me';
  const TOUCH_POINTER = 'touch';
  // Which notebook groups are folded, kept on this device. Both start open.
  const LIST_FOLDS_KEY = 'notebook_folds';
  const LIST_GROUPS = ['own', 'shared'];
  const CHEVRON_ICON = '<svg class="list-group-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';
  const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
  const LEAVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>';
  const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
  const EXTRA_ACTION_PREFIX = 'extra-';
  // A click rolls the rows one after another: folding takes the bottom one
  // first, unfolding brings the top one down first. Loads and refreshes do
  // not roll, since only the click asked for it.
  const ROLL_STEP_MS = 30;
  const ROLL_SPREAD_MS = 240;
  // Longer than the last row's delay plus its own roll (--duration-base).
  const ROLL_DONE_MS = 600;

  const container = document.getElementById('lyrics-list-items');

  // What the list last showed for each page, so a save can tell whether the
  // sidebar has fallen behind the title on screen.
  let listedTitles = new Map();
  let lastListedLyrics = null;
  // How many pages of their own the list last showed, for the limit check at
  // New page. Null until the list loads; /api/me's count stands in until then.
  let ownPageCount = null;
  let rollTimer = null;

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

  async function load() {
    setNewPageEnabled(window.currentUser !== undefined);

    // Signed out, the only page is the one in this browser. Before the sign-in
    // check answers there is nothing to say yet.
    if (!window.currentUser) showPageCount(0);
    if (window.currentUser === null) {
      lastListedLyrics = null;
      showLocalPage();
      if (window.promptForPendingShare) window.promptForPendingShare();
      return;
    }
    if (window.currentUser === undefined) {
      showListMessage(LOADING_MESSAGE);
      return;
    }

    if (!container.querySelector('.lyrics-list-item')) showListMessage(LOADING_MESSAGE);

    try {
      const res = await fetch('/api/lyrics');

      // An expired session and a broken request are worth telling apart, and
      // neither should read as an empty notebook: someone whose lyrics failed
      // to load must not be told they have none.
      if (res.status === HTTP_UNAUTHORIZED) {
        showListMessage(SIGNED_OUT_MESSAGE);
        if (window.handleSessionExpired) window.handleSessionExpired();
        return;
      }
      if (!res.ok) {
        showListMessage(LOAD_FAILED_MESSAGE);
        return;
      }

      const lyrics = await res.json();
      lastListedLyrics = lyrics;
      renderLyricsList(lyrics);
      return lyrics;
    } catch {
      showListMessage(LOAD_FAILED_MESSAGE);
    }
  }

  // Draws the rows from a list already fetched, so a change to the row
  // buttons needs no request.
  function renderLyricsList(lyrics) {
    listedTitles = new Map(lyrics.map(lyric => [lyric.id, lyric.title]));
    const own = lyrics.filter(lyric => !lyric.shared);
    const shared = lyrics.filter(lyric => lyric.shared);
    ownPageCount = own.length;
    showPageCount(own.length);
    if (own.length === 0) {
      showListMessage(EMPTY_NOTEBOOK_MESSAGE);
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
    if (OpenPage.isLive()) showListedTitle(OpenPage.id, OpenPage.title);
  }

  // live-presence.js loads after this file and holds the one rule for short
  // names; a tab without it shows the name whole.
  function shortPersonName(name) {
    return window.LivePresence ? window.LivePresence.shortNameOf(name) : name;
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

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

  // The row's own scrollHeight is wrong while it is folded: its contents are
  // centred, so half of them overflow above the top, where scrollHeight does
  // not count. Its children keep their full height either way.
  function measureRowHeight(row) {
    return Math.max(0, ...[...row.children].map(child => child.offsetHeight));
  }

  function rollListGroup(group, isFolding) {
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

  function rowHtml(lyric) {
    const title = escapeHtml(OpenPage.nameFor(lyric.title));
    const owner = lyric.shared ? escapeHtml(shortPersonName(lyric.owner_name || '')) : '';
    const lastAction = lyric.shared
      ? `<button class="lyrics-action-btn lyrics-delete-btn" data-action="leave" aria-label="Leave ${title}" title="Leave">${LEAVE_ICON}</button>`
      : `<button class="lyrics-action-btn lyrics-delete-btn" data-action="delete" aria-label="Delete ${title}" title="Delete">${TRASH_ICON}</button>`;
    return `
      <button class="lyrics-list-open" title="${title} · ${formatDate(lyric.created_at)}"><span class="lyrics-list-title">${title}</span>${owner ? `<span class="lyrics-list-owner">${owner}</span>` : ''}</button>
      <div class="lyrics-list-actions">
        ${extraRowButtons(title)}<button class="lyrics-action-btn" data-action="rename" aria-label="Rename ${title}" title="Rename">${PENCIL_ICON}</button>
        ${lastAction}
      </div>
    `;
  }

  // A page is its title, like a chat in Gemini or ChatGPT. Rename and delete
  // wait at the end of the row until it is hovered or focused. A page shared
  // with this person shows whose it is, and can be left rather than deleted.
  // The owner shows as "Tao S.", short enough to stay whole beside the title.
  function buildListItem(lyric) {
    const item = document.createElement('div');
    item.className = 'lyrics-list-item' + (lyric.id === OpenPage.id ? ' active' : '');
    item.dataset.id = lyric.id;
    item.dataset.group = lyric.shared ? 'shared' : 'own';
    item.innerHTML = rowHtml(lyric);

    const openButton = item.querySelector('.lyrics-list-open');
    // A touch may be the start of scrolling the list, not a tap on this row.
    openButton.addEventListener('pointerdown', event => {
      if (event.pointerType !== TOUCH_POINTER) OpenPage.prefetch(lyric.id);
    });
    openButton.addEventListener('click', () => {
      trackEvent('page_opened');
      OpenPage.load(lyric.id);
    });
    const actions = {
      rename: () => OpenPage.rename(lyric.id, lyric.title),
      delete: () => OpenPage.remove(lyric),
      leave: () => OpenPage.remove(lyric),
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
    PageMenu.watchForHold(item, () => PageMenu.open(item, OpenPage.nameFor(lyric.title), {
      share: canShareFromList(lyric) ? () => window.openShareDialog(lyric.id, lyric.title) : null,
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
  function showLocalPage() {
    // The page on screen, so it reads as the editor's placeholder does.
    const title = escapeHtml(OpenPage.shownTitle);
    container.innerHTML = `
      <div class="lyrics-list-item active">
        <button class="lyrics-list-open" title="Saved in this browser">${title}</button>
      </div>
    `;
    container.querySelector('.lyrics-list-open').addEventListener('click', () => {
      Sidebar.close();
      document.getElementById('lyrics').focus();
    });
  }

  function mark(id) {
    for (const item of container.querySelectorAll('.lyrics-list-item[data-id]')) {
      item.classList.toggle('active', item.dataset.id === id);
    }
  }

  // After a save, the list is only fetched again if it shows this page under
  // another title, or not at all.
  // On a live page the room writes a new title to the database up to 10 s
  // later, so asking the database now would bring the old one back; the
  // title on screen is the newest, and the list takes it from there.
  function refreshIfBehind() {
    if (listedTitles.get(OpenPage.id) === OpenPage.title) return;
    if (OpenPage.isLive()) showListedTitle(OpenPage.id, OpenPage.title);
    else load();
  }

  function showListedTitle(id, title) {
    if (!listedTitles.has(id)) return;
    listedTitles.set(id, title);
    // A later re-render without a fetch draws from this list.
    const listed = lastListedLyrics && lastListedLyrics.find(lyric => lyric.id === id);
    if (listed) listed.title = title;
    const row = container.querySelector(`.lyrics-list-item[data-id="${CSS.escape(id)}"] .lyrics-list-title`);
    if (row) row.textContent = OpenPage.nameFor(title);
  }

  function showListMessage(message) {
    container.innerHTML = '<div class="lyrics-list-empty">' + escapeHtml(message) + '</div>';
  }

  function open() {
    Sidebar.show();
    load();
  }

  function handleNotebookClick() {
    if (Sidebar.isOpen()) Sidebar.hide();
    else open();
  }

  // Signing out must not leave the last account's pages in the sidebar.
  function clear() {
    Sidebar.close();
    listedTitles = new Map();
    lastListedLyrics = null;
    ownPageCount = null;
    document.getElementById('page-count').hidden = true;
    container.innerHTML = '';
  }

  document.addEventListener('notebook-actions-changed', () => {
    if (!window.currentUser || !lastListedLyrics) return;
    renderLyricsList(lastListedLyrics);
  });
  // The group headings fold their pages. One listener, since the shared
  // heading is rebuilt with each list.
  document.getElementById('sidebar').addEventListener('click', event => {
    const toggle = event.target.closest('.list-group-toggle');
    if (toggle) toggleListGroup(toggle.dataset.group);
  });
  document.getElementById('notebook-btn').addEventListener('click', handleNotebookClick);
  document.getElementById('rail-open-btn').addEventListener('click', open);
  applyListFolds();

  window.NotebookList = {
    load,
    open,
    refreshIfBehind,
    mark,
    has: id => listedTitles.has(id),
    ownPageCount: currentOwnPageCount,
    refreshPageCount: () => showPageCount(currentOwnPageCount()),
    clear,
  };
})();
