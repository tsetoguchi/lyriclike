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
  });

  const byId = id => document.getElementById(id);
  const overlay = byId('invite-overlay');
  const inviteButton = byId('invite-btn');
  const copyButton = byId('invite-copy');
  const linkInput = byId('invite-link');
  let returnFocusTo = null;

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
      if (data && data.claimed) window.trackEvent('invite_claimed');
    } catch {
      // Tried again on the next load.
    }
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

  function onAuthChecked() {
    inviteButton.hidden = !hasPageLimit();
    claimPendingInvite();
  }

  const code = readCodeFromAddress();
  if (code) rememberPendingInvite(code);

  document.addEventListener('auth-checked', onAuthChecked);
  // The sign-in check may have answered before this script ran.
  if (window.currentUser !== undefined) onAuthChecked();
  inviteButton.addEventListener('click', openInviteDialog);
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
