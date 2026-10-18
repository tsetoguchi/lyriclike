// Sharing a page by email: the Share button and dialog, the "Shared by" line,
// the links in invite mail, and the poll that brings in other people's saves.
// Loads after storage.js and reads its page state (currentLyricId,
// currentRevision, currentPageInfo, ...): the scripts share one global scope.
(function initSharing() {
  'use strict';

  // A page id from a link waits here while the person signs in. Every way in
  // leaves the page (Google is a full redirect; the confirm link opens a new
  // tab), and sessionStorage is per tab, so it has to be localStorage. It
  // runs out after a day, and signing out clears it.
  const PENDING_SHARE_KEY = 'pending_shared';
  const PENDING_SHARE_MS = 24 * 60 * 60 * 1000;
  const PAGE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
  const STOP_TOKEN_PATTERN = /^[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/;

  // The poll. The free plan allows 100,000 function calls a day for the whole
  // site, and one tab polling every 10 s all day is 8,640, so it slows down
  // when nobody is doing anything and stops after a while.
  const POLL_FAST_MS = 10 * 1000;
  const POLL_SLOW_MS = 60 * 1000;
  const TYPING_QUIET_MS = 5 * 1000;
  const SLOW_AFTER_MS = 2 * 60 * 1000;
  const STOP_AFTER_MS = 15 * 60 * 1000;
  const COPIED_LABEL_MS = 2000;
  // How long the dialog waits for its people list before showing anyway, so
  // a slow connection still answers the click.
  const OPEN_WAIT_MS = 600;
  const HTTP_OK = 200;

  const TEXT = Object.freeze({
    LOG_IN_TO_SEE: 'Log in to see the page that was shared with you.',
    SIGN_UP_TO_SEE: 'Create a free account with the email the page was shared with, to see it.',
    NOT_AVAILABLE: "This page isn't available to this account. If it was shared with you "
      + 'under another email, log in with that one.',
    notSharedWith: to => `This page was shared with ${to}. Log out, then log in with that `
      + 'email to see it.',
    signUpWith: to => `This page was shared with ${to}. Sign up with that email to see it.`,
    logInWith: to => `This page was shared with ${to}. Log in with that email to see it.`,
    NOT_EMAILED: "Shared, but we couldn't email them today. "
      + 'Copy the link and send it to them yourself.',
    SEND_IT_YOURSELF: 'Copy the link and send it to them yourself.',
    LOAD_FAILED: "Couldn't load who has this page.",
    FAILED: 'Something went wrong. Try again.',
    STOP_QUESTION: "You won't get an email when someone shares a LyricLike page with this "
      + 'address. You can still open pages shared with you.',
    STOPPED: "You won't get these emails again.",
  });

  const byId = id => document.getElementById(id);

  // Tolerates a missing element: a tab that loaded the page just before a
  // deploy can run this script against the older markup.
  function setHidden(id, hidden) {
    const element = byId(id);
    if (element) element.hidden = hidden;
  }

  // One person with a plus for the owner, who can add people; two people for
  // an editor, who can only see who is there.
  const SHARE_BUTTON_ICON = '<svg class="share-btn-icon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M18 8v6M15 11h6"/></svg>';
  const PEOPLE_BUTTON_ICON = '<svg class="share-btn-icon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>'
    + '<path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c1.8.9 3 2.9 3 5.7"/></svg>';

  // ── The Share button and the line under the title ──

  function isShared() {
    return currentPageInfo.role === 'editor' || currentPageInfo.shareCount > 0;
  }

  function sharingLine() {
    if (currentPageInfo.role === 'editor') {
      const owner = currentPageInfo.ownerName || 'someone';
      // "Tao S.": live-presence.js loads after this file and holds the rule.
      return `Shared by ${window.LivePresence ? window.LivePresence.shortNameOf(owner) : owner}`;
    }
    const count = currentPageInfo.shareCount;
    if (count === 0) return '';
    return `Shared with ${count} ${count === 1 ? 'person' : 'people'}`;
  }

  // Live editing's switch decides who may start a share (spec §8). The
  // server checks it too; this keeps the button from offering what it refuses.
  function canShare() {
    return Boolean(window.currentUser && window.currentUser.can_share);
  }

  // Only a page that is on the server can be shared. An editor gets the same
  // button, to see who else is on the page.
  function refreshPageSharing() {
    const signedIn = Boolean(window.currentUser);
    const button = byId('share-btn');
    const isEditor = currentPageInfo.role === 'editor';
    // An already-shared page keeps the button, so its owner can still see
    // and remove people with sharing paused.
    button.hidden = !signedIn || currentRevision === null || (!isEditor && !isShared() && !canShare());
    button.innerHTML = (isEditor ? PEOPLE_BUTTON_ICON : SHARE_BUTTON_ICON)
      + `<span>${isEditor ? 'People' : 'Share'}</span>`;
    // Phones hide the title row, so they get a copy of the button above the words.
    const phoneButton = byId('share-btn-phone');
    if (phoneButton) {
      phoneButton.hidden = button.hidden;
      phoneButton.innerHTML = button.innerHTML;
    }

    const line = byId('page-sharing');
    line.textContent = signedIn ? sharingLine() : '';
    line.hidden = !line.textContent;
    schedulePoll();
  }

  // ── The dialog ──

  const overlay = byId('share-overlay');
  const form = byId('share-form');
  const emailInput = byId('share-email');
  const submitButton = byId('share-submit');
  const copyButton = byId('share-copy');

  let dialogPage = null;
  let copyLink = '';
  let returnFocusTo = null;

  // What happened after Share or Remove. Errors read in red; a success is a
  // quiet line, since the new row in the list already shows it.
  function showResult(text, { error = false } = {}) {
    byId('share-result').hidden = !text;
    byId('share-result-text').textContent = text || '';
    byId('share-result-text').classList.toggle('is-error', error);
  }

  // Share takes Done's place while there is an address to send to.
  function updateActions() {
    const hasEmail = Boolean(emailInput.value.trim());
    submitButton.hidden = !hasEmail;
    byId('share-done').hidden = hasEmail;
  }

  // The link only opens for people on the page, so it is offered once
  // someone is.
  function showCopyLink(page, hasPeople) {
    copyLink = hasPeople ? `${location.origin}/#shared=${page.id}` : '';
    copyButton.hidden = !hasPeople;
    byId('share-copy-label').textContent = 'Copy link';
  }

  // Names the daily limit that stopped the invite email. The number comes from
  // the server, so the words never drift from the real limit.
  function notEmailedText(limit) {
    const perDay = limit && limit.per_day;
    if (!perDay) return TEXT.NOT_EMAILED;
    if (limit.reason === 'address') {
      return `Shared, but we didn't email them. They've already gotten ${perDay} invite `
        + `emails today, the daily limit. ${TEXT.SEND_IT_YOURSELF}`;
    }
    if (limit.reason === 'sender') {
      return `Shared, but we didn't email them. You've sent ${perDay} invite emails `
        + `today, the daily limit. ${TEXT.SEND_IT_YOURSELF}`;
    }
    return TEXT.NOT_EMAILED;
  }

  // Shows once the people list is in, so the dialog opens at its full size
  // instead of growing under the reader.
  async function openShareDialog(id, title) {
    const page = { id, title, role: null };
    dialogPage = page;
    returnFocusTo = document.activeElement;
    byId('share-title').textContent = `Share “${titleForName(title)}”`;
    emailInput.value = '';
    submitButton.disabled = false;
    updateActions();
    showCopyLink(dialogPage, false);
    showResult('');
    form.hidden = true;
    setHidden('share-leave', true);
    setHidden('share-people-block', true);
    byId('share-people').innerHTML = '';
    const loaded = loadPeople();
    await Promise.race([loaded, new Promise(done => setTimeout(done, OPEN_WAIT_MS))]);
    // Closed, or opened for another page, while it loaded.
    if (dialogPage !== page) return;
    overlay.hidden = false;
    overlay.classList.add('open');
    await loaded;
  }

  function closeShareDialog() {
    overlay.classList.remove('open');
    setTimeout(() => { if (!overlay.classList.contains('open')) overlay.hidden = true; }, CLOSE_DELAY_MS);
    dialogPage = null;
    if (returnFocusTo && returnFocusTo.offsetParent !== null) returnFocusTo.focus();
    returnFocusTo = null;
  }

  // Each person is marked by their first letter, set the way the rhyme scheme
  // letters are in the margin. The owner's is amber.
  function personRow(label, detail, { isOwner = false, isYou = false, onRemove = null } = {}) {
    const row = document.createElement('li');
    row.className = 'share-person' + (isOwner ? ' is-owner' : '');
    const initial = document.createElement('span');
    initial.className = 'share-person-initial';
    initial.setAttribute('aria-hidden', 'true');
    initial.textContent = (label.trim()[0] || '?').toUpperCase();
    const name = document.createElement('span');
    name.className = 'share-person-name';
    name.textContent = label;
    if (isYou) {
      const you = document.createElement('span');
      you.className = 'share-person-you';
      you.textContent = ' (you)';
      name.append(you);
    }
    const status = document.createElement('span');
    status.className = 'share-person-status';
    status.textContent = detail;
    row.append(initial, name, status);
    if (onRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'lyrics-action-btn share-remove';
      remove.setAttribute('aria-label', `Remove ${label}`);
      remove.title = 'Remove';
      remove.textContent = '✕';
      remove.addEventListener('click', onRemove);
      row.append(remove);
    }
    return row;
  }

  async function loadPeople() {
    const page = dialogPage;
    if (!page) return;
    let data;
    try {
      const res = await fetch(`/api/lyrics/${page.id}/shares`);
      if (res.status === HTTP_UNAUTHORIZED) {
        closeShareDialog();
        if (window.handleSessionExpired) window.handleSessionExpired();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch {
      if (page === dialogPage) showResult(TEXT.LOAD_FAILED, { error: true });
      return;
    }
    if (page !== dialogPage) return;
    try {
      showPeople(page, data);
    } catch (err) {
      console.error('share dialog', err);
      showResult(TEXT.LOAD_FAILED, { error: true });
    }
  }

  // A page only its owner has shows no list: "you, the owner" and a note
  // about seeing each other's emails mean nothing until someone else is on it.
  function showPeople(page, data) {
    const list = byId('share-people');
    const isOwner = data.role === 'owner';
    page.role = data.role;
    page.ownerName = data.owner.name || data.owner.email;
    byId('share-title').textContent = isOwner
      ? `Share “${titleForName(page.title)}”`
      : `People on “${titleForName(page.title)}”`;
    form.hidden = !data.can_share;
    // An editor's dialog is headed "People on …" already.
    setHidden('share-people-label', !isOwner);
    setHidden('share-leave', isOwner);
    setHidden('share-people-block', data.people.length === 0);
    showCopyLink(page, data.people.length > 0);

    const myEmail = window.currentUser ? String(window.currentUser.email || '').toLowerCase() : '';
    list.innerHTML = '';
    list.append(personRow(page.ownerName, 'Owner', { isOwner: true, isYou: isOwner }));
    for (const person of data.people) {
      list.append(personRow(person.email, person.joined ? 'Joined' : 'Invited', {
        isYou: person.email.toLowerCase() === myEmail,
        onRemove: isOwner ? () => removePerson(person.email) : null,
      }));
    }
    if (isOwner && page.id === currentLyricId && currentPageInfo.shareCount !== data.people.length) {
      currentPageInfo.shareCount = data.people.length;
      saveDraft();
      refreshPageSharing();
    }
    if (data.can_share) setTimeout(() => emailInput.focus(), FOCUS_DELAY_MS);
  }

  function errorMessage(data) {
    return data && data.error && typeof data.error.message === 'string' ? data.error.message : TEXT.FAILED;
  }

  async function sharePage(event) {
    event.preventDefault();
    const page = dialogPage;
    const email = emailInput.value.trim();
    if (!page || !email) return;

    submitButton.disabled = true;
    try {
      const res = await fetch(`/api/lyrics/${page.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === HTTP_UNAUTHORIZED) {
        closeShareDialog();
        if (window.handleSessionExpired) window.handleSessionExpired();
        return;
      }
      const data = await res.json().catch(() => null);
      if (page !== dialogPage) return;
      if (!res.ok) {
        showResult(errorMessage(data), { error: true });
        return;
      }
      if (data.status === 'already_shared') {
        showResult(`Already shared with ${data.email}.`);
      } else {
        trackEvent('page_shared');
        if (data.emailed) showResult(`Shared with ${data.email}.`);
        else showResult(notEmailedText(data.email_limit));
        // The page on the owner's screen goes live now, without a reload.
        const isOpenPageLive = data.live && page.id === currentLyricId;
        if (isOpenPageLive && typeof goLiveAfterShare === 'function') await goLiveAfterShare(page.id);
      }
      emailInput.value = '';
      await loadPeople();
    } catch {
      if (page === dialogPage) showResult(TEXT.FAILED, { error: true });
    } finally {
      submitButton.disabled = false;
      updateActions();
    }
  }

  async function removePerson(email) {
    const page = dialogPage;
    if (!page) return;
    try {
      const res = await fetch(`/api/lyrics/${page.id}/shares`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      showResult(res.ok ? '' : TEXT.FAILED, { error: !res.ok });
    } catch {
      showResult(TEXT.FAILED, { error: true });
    }
    if (page === dialogPage) await loadPeople();
  }

  // Leaving goes through the notebook's own Leave, which asks first.
  function leavePage() {
    const page = dialogPage;
    if (!page) return;
    closeShareDialog();
    deleteLyric({ id: page.id, title: page.title, shared: true, owner_name: page.ownerName });
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(copyLink);
      byId('share-copy-label').textContent = 'Copied';
      copyButton.classList.add('is-copied');
      setTimeout(() => {
        byId('share-copy-label').textContent = 'Copy link';
        copyButton.classList.remove('is-copied');
      }, COPIED_LABEL_MS);
    } catch {
      // Shown in the message instead, for copying by hand.
      showResult(copyLink);
    }
  }

  form.addEventListener('submit', sharePage);
  emailInput.addEventListener('input', updateActions);
  copyButton.addEventListener('click', copyShareLink);
  byId('share-leave').addEventListener('click', leavePage);
  byId('share-done').addEventListener('click', closeShareDialog);
  overlay.addEventListener('click', event => { if (event.target === overlay) closeShareDialog(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeShareDialog(); }
  });
  const openForCurrentPage = () => openShareDialog(currentLyricId, currentTitle);
  byId('share-btn').addEventListener('click', openForCurrentPage);
  byId('page-sharing').addEventListener('click', openForCurrentPage);
  if (byId('share-btn-phone')) byId('share-btn-phone').addEventListener('click', openForCurrentPage);

  // ── Links from invite mail ──

  function readPendingShare() {
    try {
      const pending = JSON.parse(localStorage.getItem(PENDING_SHARE_KEY));
      if (pending && PAGE_ID_PATTERN.test(pending.id) && pending.expires > Date.now()) {
        return { ...pending, to: typeof pending.to === 'string' ? pending.to : '' };
      }
      localStorage.removeItem(PENDING_SHARE_KEY);
    } catch {
      // Unreadable storage holds nothing to open.
    }
    return null;
  }

  function forgetPendingShare() {
    try { localStorage.removeItem(PENDING_SHARE_KEY); } catch {}
  }

  function rememberPendingShare(id, signup, to) {
    try {
      localStorage.setItem(PENDING_SHARE_KEY, JSON.stringify({
        id, signup: Boolean(signup), to: to || '', expires: Date.now() + PENDING_SHARE_MS,
      }));
    } catch {
      // Without storage the page can't be opened after sign-in; it still
      // shows under "Shared with me".
    }
  }

  // The server gives the same 404 for "no such page", "not yours" and
  // "removed", and names no address. Only the emailed link knows which
  // address the page went to, so only it can name one.
  function notAvailableText(to) {
    const isOtherAddress = to && window.currentUser
      && to.toLowerCase() !== String(window.currentUser.email).toLowerCase();
    return isOtherAddress ? TEXT.notSharedWith(to) : TEXT.NOT_AVAILABLE;
  }

  async function openSharedPage(id, to) {
    const status = await loadLyric(id);
    if (status === HTTP_NOT_FOUND) {
      showNotice(notAvailableText(to), [
        { label: 'Log out', onClick: () => { hideNotice(); signOut(); } },
      ]);
      return;
    }
    if (status !== HTTP_OK) return;
    loadLyricsList();
    if (currentPageInfo.role === 'editor') {
      showNotice(`${currentPageInfo.ownerName || 'Someone'} shared this with you.`);
    }
  }

  // Called once signed in. Returns whether there was a page to open.
  async function openPendingShare() {
    const pending = readPendingShare();
    if (!pending) return false;
    forgetPendingShare();
    await openSharedPage(pending.id, pending.to);
    return true;
  }

  function pendingShareMessage({ signup, to }) {
    if (!to) return signup ? TEXT.SIGN_UP_TO_SEE : TEXT.LOG_IN_TO_SEE;
    return signup ? TEXT.signUpWith(to) : TEXT.logInWith(to);
  }

  // Signed out with a page waiting: once per load, the sign-in modal opens
  // with a line on top saying why.
  let promptedForShare = false;

  function promptForPendingShare() {
    refreshPageSharing();
    const pending = readPendingShare();
    if (!pending || promptedForShare || !window.openAuthModal) return;
    promptedForShare = true;
    window.openAuthModal({ message: pendingShareMessage(pending), email: pending.to });
  }

  // Only a POST stops the mail, and only after this button: mail scanners
  // open every link in a mail, and must not opt anyone out by doing so.
  async function confirmStop(token) {
    if (!STOP_TOKEN_PATTERN.test(token)) return;
    const confirmed = await openDialog({
      heading: 'Stop these emails', message: TEXT.STOP_QUESTION, confirmLabel: 'Stop these emails',
    });
    if (!confirmed) return;
    try {
      const res = await fetch('/api/invites/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      await openDialog({ heading: 'Stop these emails', message: TEXT.FAILED, confirmLabel: 'OK', noCancel: true });
      return;
    }
    await openDialog({ heading: 'Emails stopped', message: TEXT.STOPPED, confirmLabel: 'OK', noCancel: true });
  }

  function openShareLink(link) {
    if (!link || typeof link.token !== 'string') return;
    if (link.kind === 'stop') {
      confirmStop(link.token);
      return;
    }
    if (link.kind !== 'shared' || !PAGE_ID_PATTERN.test(link.token)) return;
    if (window.currentUser) {
      openSharedPage(link.token, link.to);
      return;
    }
    rememberPendingShare(link.token, link.signup, link.to);
    // Before the sign-in check answers, the notebook picks the page up
    // (openNotebook) or the signed-out list asks for a sign-in.
    if (window.currentUser === null) {
      promptedForShare = false;
      promptForPendingShare();
    }
  }

  // ── The poll ──

  // On a shared page, other people's saves are fetched when this person is
  // not typing and has nothing unsaved, so nobody's words are swapped out
  // from under them. Live co-editing is a later, separate job.
  let pollTimer = null;
  let lastActivity = Date.now();
  let lastTyped = 0;

  function checkWanted() {
    // A live page, or one waiting to reopen live, gets other people's edits
    // from its room, not the poll. storage.js's live names are read behind
    // typeof: a tab can hold an older cached storage.js without them.
    return Boolean(window.currentUser) && currentRevision !== null && !document.hidden
      && !(typeof isLiveDraft !== 'undefined' && isLiveDraft);
  }

  function pollingWanted() {
    return checkWanted() && isShared();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!pollingWanted()) return;
    const idle = Date.now() - lastActivity;
    if (idle >= STOP_AFTER_MS) return;
    pollTimer = setTimeout(pollOnce, idle >= SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS);
  }

  function isBusy() {
    return Date.now() - lastTyped < TYPING_QUIET_MS || hasUnsavedEdits()
      || saveInFlight !== null || pendingConflict !== null;
  }

  async function pollOnce() {
    pollTimer = null;
    if (!pollingWanted()) return;
    if (isBusy()) {
      schedulePoll();
      return;
    }
    await checkForNewerSave(schedulePoll);
  }

  // Asks whether the page was saved somewhere else since it was loaded, and
  // takes those words if so. thenAgain runs while the page is still one to
  // check: not once it's gone, signed out or live.
  async function checkForNewerSave(thenAgain) {
    const id = currentLyricId;
    let res;
    try {
      res = await fetch(`/api/lyrics/${id}?meta=1`);
    } catch {
      thenAgain();
      return;
    }
    if (id !== currentLyricId) return;
    if (res.status === HTTP_UNAUTHORIZED) return;
    if (res.status === HTTP_NOT_FOUND) {
      // Deleted, or this person was taken off it. There are no unsaved edits
      // (the check waits for those), so nothing needs keeping.
      dropUnavailablePage();
      loadLyricsList();
      return;
    }
    if (res.ok) {
      const meta = await res.json();
      // The page went live (shared from another device, or the switch turned
      // on): its room takes over from the poll.
      if (meta.live && typeof goLiveWhenSaved === 'function') return goLiveWhenSaved();
      if (meta.live && typeof goLiveFromRest === 'function') return goLiveFromRest();
      if (meta.revision > currentRevision) await takeTheirWords(id);
      else if (meta.title !== currentTitle) takeTheirTitle(meta.title);
    }
    thenAgain();
  }

  // A page left open in a background tab, or behind another window, may have
  // been saved on another device since. Every page is checked on the way
  // back, shared or not, so typing doesn't start on old words.
  let isReturnCheckRunning = false;

  async function checkOnReturn() {
    if (isReturnCheckRunning || !checkWanted() || isBusy()) return;
    isReturnCheckRunning = true;
    try {
      await checkForNewerSave(() => {});
    } finally {
      isReturnCheckRunning = false;
    }
  }

  // showLyric sets the saved text and revision before the input event, so the
  // swap is not saved back as if typed here. The cursor keeps its place in
  // the text as best it can.
  async function takeTheirWords(id) {
    let res;
    try {
      res = await fetch(`/api/lyrics/${id}`);
    } catch {
      return;
    }
    if (!res.ok || id !== currentLyricId || isBusy()) return;
    const lyric = await res.json();

    const textarea = byId('lyrics');
    const focused = document.activeElement === textarea;
    const { selectionStart, selectionEnd } = textarea;
    showLyric(lyric);
    saveDraft();
    if (focused) {
      const end = textarea.value.length;
      textarea.setSelectionRange(Math.min(selectionStart, end), Math.min(selectionEnd, end));
    }
    refreshListIfBehind();
  }

  function takeTheirTitle(title) {
    if (document.activeElement === byId('lyrics-panel-title')) return;
    currentTitle = title;
    updatePanelHeader();
    saveDraft();
    refreshListIfBehind();
  }

  // Any sign of life speeds a slowed poll back up, or restarts a stopped one.
  function noteActivity() {
    lastActivity = Date.now();
    if (!pollTimer) schedulePoll();
  }

  byId('lyrics').addEventListener('input', event => {
    if (!event.isTrusted) return;
    lastTyped = Date.now();
    noteActivity();
  });
  document.addEventListener('pointerdown', noteActivity);
  document.addEventListener('keydown', noteActivity);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      schedulePoll();
      return;
    }
    noteActivity();
    checkOnReturn();
  });
  window.addEventListener('focus', checkOnReturn);

  window.refreshPageSharing = refreshPageSharing;
  window.openShareDialog = openShareDialog;
  window.openPendingShare = openPendingShare;
  window.promptForPendingShare = promptForPendingShare;
  window.forgetPendingShare = forgetPendingShare;
  window.openShareLink = openShareLink;

  const link = window.authLink;
  if (link && (link.kind === 'shared' || link.kind === 'stop')) {
    window.authLink = null;
    openShareLink(link);
  }
  refreshPageSharing();
})();
