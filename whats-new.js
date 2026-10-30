// A one-time card that tells signed-in people about live co-writing. It shows
// only to accounts the LIVE_EDITING switch lets share, so it goes out with the
// switch, and once closed it stays closed in this browser. It waits for a visit
// after their first page: before it there is nothing to share, and a card
// arriving as that page saves would interrupt the writing.
(function initWhatsNew() {
  'use strict';

  const SEEN_KEY = 'whats_new_seen';
  const SEEN_VALUE = 'live-editing';
  // Lets the page settle first, so the card doesn't arrive mid-load.
  const SHOW_DELAY_MS = 800;

  const card = document.getElementById('whats-new');
  if (!card) return;

  // Storage that throws can't remember the close, and a card that comes back
  // on every visit is worse than none, so it counts as seen.
  function isSeen() {
    try {
      return localStorage.getItem(SEEN_KEY) === SEEN_VALUE;
    } catch {
      return true;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, SEEN_VALUE);
    } catch {
      // Nothing to keep it in; the card just closes for this visit.
    }
  }

  function canShare() {
    return Boolean(window.currentUser && window.currentUser.can_share);
  }

  function hasOwnPage() {
    return Boolean(window.currentUser && window.currentUser.page_count > 0);
  }

  // On a phone the card sits just above the bottom menu, not over it.
  function liftAboveBottomNav() {
    const nav = document.querySelector('.bottom-nav');
    const height = nav ? nav.getBoundingClientRect().height : 0;
    card.style.setProperty('--whats-new-lift', `${height}px`);
  }

  function show() {
    liftAboveBottomNav();
    card.hidden = false;
  }

  function dismiss() {
    if (card.hidden) return;
    card.hidden = true;
    markSeen();
  }

  function update() {
    if (!canShare()) {
      card.hidden = true;
      return;
    }
    if (isSeen() || !hasOwnPage()) return;
    setTimeout(() => {
      if (canShare() && !isSeen()) show();
    }, SHOW_DELAY_MS);
  }

  document.getElementById('whats-new-done').addEventListener('click', dismiss);
  document.getElementById('whats-new-close').addEventListener('click', dismiss);
  // Opening Share is the thing the card asks for, so it has done its job.
  // Phones have their own copy of the button, and the sharing line opens it too.
  for (const id of ['share-btn', 'share-btn-phone', 'page-sharing']) {
    const opener = document.getElementById(id);
    if (opener) opener.addEventListener('click', dismiss);
  }
  document.addEventListener('auth-checked', update);
  if (window.currentUser !== undefined) update();
})();
