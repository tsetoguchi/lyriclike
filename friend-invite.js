// Inviting a friend: the Invite button and its window, and the other side of
// the link, where a new account says whose invite brought it here. A friend
// counts once they save a page; then both people get extra pages. The button
// only shows when the site has a page limit, since the reward is pages.
(function initFriendInvite() {
  'use strict';

  // The code waits here while the friend signs up. Google is a full redirect
  // and the confirm link opens a new tab, so it has to be localStorage. The
  // server only takes it from a day-old account, so it keeps for a day too.
  const PENDING_INVITE_KEY = 'pending_invite';
  const PENDING_INVITE_MS = 24 * 60 * 60 * 1000;
  const INVITE_PARAM = 'invite';
  const CODE_PATTERN = /^[0-9a-f]{10}$/;
  const COPIED_LABEL_MS = 2000;
  const COPY_LABEL = 'Copy link';
  const COPIED_LABEL = 'Copied';

  const TEXT = Object.freeze({
    howItWorks: perFriend => `When a friend signs up with your link and saves a page, `
      + `you both get ${perFriend} more pages.`,
    NONE_YET: 'No friends have joined yet.',
    joined: (friends, pages) => `${friends} ${friends === 1 ? 'friend has' : 'friends have'} `
      + `joined. You've earned ${pages} more pages.`,
    allJoined: (friends, pages) => `${friends} friends have joined. You've earned ${pages} `
      + 'more pages, the most there is.',
    LOAD_FAILED: "Couldn't load your invite link. Try again.",
    WELCOME: 'A friend invited you to LyricLike. Sign up and save a page, '
      + "and you'll both get extra pages.",
    INVITE_WORKED: 'Your invite worked',
    saveToEarn: perFriend => `Save your first page, and you and your friend `
      + `will both get ${perFriend} more pages.`,
    earned: perFriend => `You and your friend both got ${perFriend} more pages.`,
    OK: 'OK',
  });

  const byId = id => document.getElementById(id);
  const overlay = byId('invite-overlay');
  // One in the header for phones, one in the lyrics' corner for wider screens;
  // the stylesheet shows the right one.
  const inviteButtons = [byId('invite-btn'), byId('invite-btn-panel')].filter(Boolean);
  const copyButton = byId('invite-copy');
  const linkInput = byId('invite-link');
  let returnFocusTo = null;
  // Set after this account takes a code, until its first save brings the
  // extra pages, so the "3 of 5 pages" line can catch up without a reload.
  let isAwaitingReward = false;

  // ── The friend's side: remember the code, then hand it in once signed in ──

  function readCodeFromAddress() {
    const params = new URLSearchParams(location.search);
    const code = params.get(INVITE_PARAM);
    if (code === null) return null;
    // Out of the address bar, so a copied link doesn't pass the code on.
    params.delete(INVITE_PARAM);
    const rest = params.toString();
    const search = rest ? `?${rest}` : '';
    history.replaceState(history.state, '', location.pathname + search + location.hash);
    return CODE_PATTERN.test(code) ? code : null;
  }

  function rememberPendingInvite(code) {
    try {
      localStorage.setItem(PENDING_INVITE_KEY,
        JSON.stringify({ code, expires: Date.now() + PENDING_INVITE_MS }));
    } catch {
      // Without storage the invite is lost; the friend can still sign up.
    }
  }

  function readPendingInvite() {
    try {
      const pending = JSON.parse(localStorage.getItem(PENDING_INVITE_KEY));
      if (pending && CODE_PATTERN.test(pending.code) && pending.expires > Date.now()) {
        return pending.code;
      }
      localStorage.removeItem(PENDING_INVITE_KEY);
    } catch {
      // Unreadable storage holds no invite.
    }
    return null;
  }

  function forgetPendingInvite() {
    try { localStorage.removeItem(PENDING_INVITE_KEY); } catch {}
  }

  // Signed out, the sign-up window opens once with a line saying why.
  function welcomeInvitedVisitor() {
    if (window.openAuthModal) window.openAuthModal({ message: TEXT.WELCOME });
  }

  // The new limit is on the server; this brings it to the line under the
  // notebook. showPageCount and currentOwnPageCount come from storage.js.
  async function refreshPageLimit() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok || !window.currentUser) return false;
      const { page_limit: pageLimit } = await res.json();
      const isRaised = pageLimit !== window.currentUser.page_limit;
      window.currentUser.page_limit = pageLimit;
      if (typeof showPageCount === 'function') showPageCount(currentOwnPageCount());
      return isRaised;
    } catch {
      return false;
    }
  }

  function showClaimed(data) {
    window.trackEvent('invite_claimed');
    window.openDialog({
      heading: TEXT.INVITE_WORKED,
      message: data.rewarded ? TEXT.earned(data.pages_per_friend)
        : TEXT.saveToEarn(data.pages_per_friend),
      confirmLabel: TEXT.OK,
      noCancel: true,
    });
    if (data.rewarded) refreshPageLimit();
    isAwaitingReward = !data.rewarded;
  }

  // Any answer from the server is final, so the code is forgotten; only a
  // dropped connection keeps it for the next page load.
  async function claimPendingInvite() {
    const code = readPendingInvite();
    if (!code || !window.currentUser) return;
    try {
      const res = await fetch('/api/me/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      forgetPendingInvite();
      const data = res.ok ? await res.json() : null;
      if (data && data.claimed) showClaimed(data);
    } catch {
      // Tried again on the next load.
    }
  }

  // The server rewards the invite as it creates the first page, so the new
  // limit is there by the time this hears of it.
  async function onPageCreated() {
    if (!isAwaitingReward) return;
    if (await refreshPageLimit()) isAwaitingReward = false;
  }

  // ── The inviter's side: the button and the window ──

  function hasPageLimit() {
    const user = window.currentUser;
    return Boolean(user) && typeof user.page_limit === 'number';
  }

  function progressText(data) {
    if (data.friends_joined === 0) return TEXT.NONE_YET;
    const shown = Math.min(data.friends_joined, data.max_friends);
    const pages = shown * data.pages_per_friend;
    return shown >= data.max_friends ? TEXT.allJoined(shown, pages) : TEXT.joined(shown, pages);
  }

  function showInvite(data) {
    byId('invite-subtext').textContent = TEXT.howItWorks(data.pages_per_friend);
    linkInput.value = data.url;
    byId('invite-progress').textContent = progressText(data);
    copyButton.disabled = false;
  }

  function showLoadFailed() {
    byId('invite-subtext').textContent = '';
    linkInput.value = '';
    byId('invite-progress').textContent = TEXT.LOAD_FAILED;
    copyButton.disabled = true;
  }

  async function loadInvite() {
    try {
      const res = await fetch('/api/me/invite');
      if (!res.ok) throw new Error(`invite ${res.status}`);
      showInvite(await res.json());
    } catch {
      showLoadFailed();
    }
  }

  async function openInviteDialog() {
    returnFocusTo = document.activeElement;
    copyButton.textContent = COPY_LABEL;
    window.trackEvent('invite_open');
    await loadInvite();
    overlay.hidden = false;
    overlay.classList.add('open');
    copyButton.focus();
  }

  function closeInviteDialog() {
    overlay.classList.remove('open');
    setTimeout(() => {
      if (!overlay.classList.contains('open')) overlay.hidden = true;
    }, CLOSE_DELAY_MS);
    if (returnFocusTo && returnFocusTo.offsetParent !== null) returnFocusTo.focus();
    returnFocusTo = null;
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(linkInput.value);
      copyButton.textContent = COPIED_LABEL;
      setTimeout(() => { copyButton.textContent = COPY_LABEL; }, COPIED_LABEL_MS);
      window.trackEvent('invite_copy');
    } catch {
      // Selected instead, for copying by hand.
      linkInput.focus();
      linkInput.select();
    }
  }

  // Only a visitor who arrived on the link this load is greeted, and once.
  let isFreshArrival = false;

  function onAuthChecked() {
    for (const button of inviteButtons) button.hidden = !hasPageLimit();
    if (window.currentUser) {
      claimPendingInvite();
    } else if (isFreshArrival) {
      isFreshArrival = false;
      welcomeInvitedVisitor();
    }
  }

  const code = readCodeFromAddress();
  if (code) {
    rememberPendingInvite(code);
    isFreshArrival = true;
    // The sign-up window is about to open; the first-visit tour waits.
    window.isTourHeld = true;
  }

  document.addEventListener('auth-checked', onAuthChecked);
  document.addEventListener('page-created', onPageCreated);
  // The sign-in check may have answered before this script ran.
  if (window.currentUser !== undefined) onAuthChecked();
  for (const button of inviteButtons) button.addEventListener('click', openInviteDialog);
  copyButton.addEventListener('click', copyInviteLink);
  byId('invite-done').addEventListener('click', closeInviteDialog);
  byId('invite-close').addEventListener('click', closeInviteDialog);
  linkInput.addEventListener('focus', () => linkInput.select());
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeInviteDialog();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeInviteDialog(); }
  });
})();
