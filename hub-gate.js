// Decides, before the page is drawn, whether a signed-in phone visit opens on
// the start screen rather than the editor. It runs in the head right after
// splash.js, so the splash can lift straight onto it, and before the scripts
// that tidy links out of the address, so it still sees where a link leads.
(function defineHubGate(root) {
  'use strict';

  // Away this long counts as a fresh open, even in a tab that never closed.
  const FRESH_OPEN_GAP_MS = 6 * 60 * 60 * 1000;
  const TAB_MARK_KEY = 'hub_tab_seen';
  const LAST_ACTIVE_KEY = 'hub_last_active';
  const HUB_CLASS = 'is-hub';
  const SPLASH_CLASS = 'is-splashing';
  const PHONE_QUERY = '(max-width: 768px)';
  // Read here, owned elsewhere: coach-tour.js, sharing.js, friend-invite.js.
  const TOUR_SEEN_KEY = 'tour_seen';
  const PENDING_SHARE_KEY = 'pending_shared';
  const PENDING_INVITE_KEY = 'pending_invite';
  const LINK_QUERY_PARAMS = Object.freeze(['word', 'invite']);
  const LINK_HASH_PARAMS = Object.freeze(['shared', 'signup_token', 'reset_token']);

  function hasLinkDestination(href, storedKeys) {
    if (storedKeys.pendingShared !== null || storedKeys.pendingInvite !== null) return true;
    const url = new URL(href);
    const hash = new URLSearchParams(url.hash.slice(1));
    return LINK_QUERY_PARAMS.some(name => url.searchParams.has(name))
      || LINK_HASH_PARAMS.some(name => hash.has(name));
  }

  // A tab that has been here before is a reload, unless it sat unused long
  // enough to count as a new day. With no time kept, it stays a reload.
  function isFreshOpen(hasTabMark, lastActiveMs, nowMs) {
    if (!hasTabMark) return true;
    if (lastActiveMs === null) return false;
    return nowMs - lastActiveMs >= FRESH_OPEN_GAP_MS;
  }

  function shouldShowHub(visit) {
    if (!visit.isPhone || !visit.isSplashing || !visit.isTourSeen) return false;
    if (visit.hasDestination) return false;
    return isFreshOpen(visit.hasTabMark, visit.lastActiveMs, visit.nowMs);
  }

  function readLastActive(storage) {
    const stored = Number(storage.getItem(LAST_ACTIVE_KEY));
    return stored > 0 ? stored : null;
  }

  function readVisit(win) {
    const local = win.localStorage;
    return {
      isPhone: win.matchMedia(PHONE_QUERY).matches,
      isSplashing: win.document.documentElement.classList.contains(SPLASH_CLASS),
      isTourSeen: local.getItem(TOUR_SEEN_KEY) !== null,
      hasDestination: hasLinkDestination(win.location.href, {
        pendingShared: local.getItem(PENDING_SHARE_KEY),
        pendingInvite: local.getItem(PENDING_INVITE_KEY),
      }),
      hasTabMark: win.sessionStorage.getItem(TAB_MARK_KEY) !== null,
      lastActiveMs: readLastActive(local),
      nowMs: Date.now(),
    };
  }

  function markTab(win) {
    win.sessionStorage.setItem(TAB_MARK_KEY, '1');
  }

  function rememberLastActive(win) {
    try {
      win.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    } catch {
      // Nothing to keep it in; the next load in this tab counts as a reload.
    }
  }

  function watchLastActive(win) {
    win.addEventListener('pagehide', () => rememberLastActive(win));
    win.document.addEventListener('visibilitychange', () => {
      if (win.document.visibilityState === 'hidden') rememberLastActive(win);
    });
  }

  // Storage that throws can't tell a reload from a fresh open, and a start
  // screen on every reload is worse than none, so it stays off.
  function openOnHubIfDue(win) {
    try {
      const isDue = shouldShowHub(readVisit(win));
      markTab(win);
      if (isDue) win.document.documentElement.classList.add(HUB_CLASS);
    } catch {
      return;
    }
    watchLastActive(win);
  }

  const HubGate = {
    FRESH_OPEN_GAP_MS,
    TAB_MARK_KEY,
    LAST_ACTIVE_KEY,
    hasLinkDestination,
    shouldShowHub,
    markTab,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = HubGate;
    return;
  }
  root.HubGate = HubGate;
  openOnHubIfDue(root);
})(this);
