// Swipes between the phone's two tabs: a swipe left on Lyrics opens Rhymes,
// and a swipe right on Rhymes goes back to Lyrics. app.js's switchMobileTab
// does the switching, as a tap on the tab would. A swipe right on Lyrics, and
// one from the screen's left edge, belong to the sidebar (sidebar-swipe.js).
(function defineTabSwipe() {
  'use strict';

  const LYRICS_TAB = 'lyrics';
  const RHYMES_TAB = 'rhymes';
  const PHONE_QUERY = '(max-width: 768px)';
  // Matches sidebar-swipe.js's edge strip.
  const EDGE_PX = 20;
  // Far enough that a tap or a wobble while scrolling never switches.
  const MIN_SWIPE_PX = 60;
  // Clearly sideways: this many times more across than down.
  const SIDEWAYS_RATIO = 1.5;

  const mainEl = document.querySelector('.main');

  let start = null;

  // Pure: which tab a finished swipe goes to, or null for none.
  function tabAfterSwipe({ tab, dx, dy }) {
    const isSideways = Math.abs(dx) >= MIN_SWIPE_PX
      && Math.abs(dx) >= Math.abs(dy) * SIDEWAYS_RATIO;
    if (!isSideways) return null;
    if (tab === LYRICS_TAB && dx < 0) return RHYMES_TAB;
    if (tab === RHYMES_TAB && dx > 0) return LYRICS_TAB;
    return null;
  }

  function currentTab() {
    return mainEl.classList.contains('show-rhymes') ? RHYMES_TAB : LYRICS_TAB;
  }

  function isBusy() {
    if (window.Sidebar && window.Sidebar.isOpen()) return true;
    return Boolean(window.isCoachTourOpen && window.isCoachTourOpen());
  }

  // A drag there scrolls that row, or moves the ends of a selection.
  function isInSidewaysScroller(target) {
    for (let el = target; el && el !== mainEl; el = el.parentElement) {
      const isWider = el.scrollWidth > el.clientWidth + 1;
      if (isWider && getComputedStyle(el).overflowX !== 'hidden') return true;
    }
    return false;
  }

  function hasTextSelected() {
    const textarea = document.getElementById('lyrics');
    return Boolean(textarea) && textarea.selectionStart !== textarea.selectionEnd;
  }

  // Whether a sideways swipe from here is the page's to take, on a phone.
  function canSwipeFrom(target) {
    if (!window.matchMedia(PHONE_QUERY).matches || !mainEl.contains(target)) return false;
    return !isInSidewaysScroller(target) && !hasTextSelected();
  }

  function canStartAt(touch, target) {
    if (isBusy() || touch.clientX <= EDGE_PX) return false;
    return canSwipeFrom(target);
  }

  function onTouchStart(event) {
    start = null;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!canStartAt(touch, event.target)) return;
    start = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event) {
    const began = start;
    start = null;
    const touch = event.changedTouches && event.changedTouches[0];
    if (!began || !touch || typeof window.switchMobileTab !== 'function') return;
    const next = tabAfterSwipe({
      tab: currentTab(), dx: touch.clientX - began.x, dy: touch.clientY - began.y,
    });
    if (next) window.switchMobileTab(next);
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', () => { start = null; }, { passive: true });

  window.TabSwipe = { tabAfterSwipe, canSwipeFrom, currentTab };
})();
