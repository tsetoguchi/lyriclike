// Swipes for the sliding sidebar. A drag from the screen's left edge pulls it
// out, and a drag left on it or its scrim pushes it back. It follows the
// finger, then sidebar.js opens or closes it from where it was let go. The
// docked sidebar is part of the page, so it takes no swipes.
(function defineSidebarSwipe() {
  'use strict';

  // Where an opening drag may start: the screen's first strip, so drags on
  // the lyrics, the rhymes and the lists keep their own meaning.
  const EDGE_PX = 20;
  // Movement before the drag picks a direction; a mostly vertical one is a
  // scroll and is left alone.
  const SLOP_PX = 10;
  // Let go past this share of the sidebar's width, it settles that way.
  const SETTLE_SHARE = 0.4;
  // A flick this fast settles in its direction however far it went.
  const FLICK_PX_PER_MS = 0.4;
  const DRAGGING_CLASS = 'sidebar-dragging';

  const sidebarEl = document.getElementById('sidebar');
  const scrimEl = document.getElementById('sidebar-scrim');

  let drag = null;

  // Pure: whether a drag let go at this point leaves the sidebar open.
  function isOpenAfterRelease({ wasOpen, dx, elapsedMs, width }) {
    const speed = elapsedMs > 0 ? dx / elapsedMs : 0;
    if (speed >= FLICK_PX_PER_MS) return true;
    if (speed <= -FLICK_PX_PER_MS) return false;
    const travel = wasOpen ? -dx : dx;
    const isPastShare = travel > width * SETTLE_SHARE;
    return wasOpen ? !isPastShare : isPastShare;
  }

  function isSwipeable() {
    const sidebar = window.Sidebar;
    if (!sidebar || sidebar.isDocked()) return false;
    return !(window.isCoachTourOpen && window.isCoachTourOpen());
  }

  function canStartAt(touch, target) {
    if (window.Sidebar.isOpen()) {
      return sidebarEl.contains(target) || target === scrimEl;
    }
    return touch.clientX <= EDGE_PX;
  }

  function onTouchStart(event) {
    drag = null;
    if (event.touches.length !== 1 || !isSwipeable()) return;
    const touch = event.touches[0];
    if (!canStartAt(touch, event.target)) return;
    drag = {
      wasOpen: window.Sidebar.isOpen(), startX: touch.clientX, startY: touch.clientY,
      startedAt: event.timeStamp, isDragging: false, dx: 0,
    };
  }

  // The first moves past the slop decide: sideways is a swipe, otherwise
  // the touch is the page's and this drag is dropped.
  function isSidewaysDrag(dx, dy) {
    if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return null;
    return Math.abs(dx) > Math.abs(dy);
  }

  function beginDrag() {
    drag.isDragging = true;
    drag.width = sidebarEl.offsetWidth;
    document.body.classList.add(DRAGGING_CLASS);
    sidebarEl.style.visibility = 'visible';
    scrimEl.style.visibility = 'visible';
  }

  // offset runs from -width (shut) to 0 (open).
  function followFinger() {
    const start = drag.wasOpen ? 0 : -drag.width;
    const offset = Math.min(0, Math.max(-drag.width, start + drag.dx));
    sidebarEl.style.transform = `translateX(${offset}px)`;
    scrimEl.style.opacity = String(1 + offset / drag.width);
  }

  function onTouchMove(event) {
    if (!drag) return;
    const touch = event.touches[0];
    drag.dx = touch.clientX - drag.startX;
    if (!drag.isDragging) {
      const isSideways = isSidewaysDrag(drag.dx, touch.clientY - drag.startY);
      if (isSideways === null) return;
      if (!isSideways) {
        drag = null;
        return;
      }
      beginDrag();
    }
    event.preventDefault();
    followFinger();
  }

  // The inline styles go in the same frame the class settles, so the
  // sidebar's own transition carries it on from where the finger left it.
  function settle(isOpen) {
    document.body.classList.remove(DRAGGING_CLASS);
    for (const el of [sidebarEl, scrimEl]) {
      el.style.removeProperty('transform');
      el.style.removeProperty('opacity');
      el.style.removeProperty('visibility');
    }
    if (isOpen) window.Sidebar.show();
    else window.Sidebar.hide();
  }

  function onTouchEnd(event) {
    const ended = drag;
    drag = null;
    if (!ended || !ended.isDragging) return;
    settle(isOpenAfterRelease({
      wasOpen: ended.wasOpen, dx: ended.dx,
      elapsedMs: event.timeStamp - ended.startedAt, width: ended.width,
    }));
  }

  function onTouchCancel() {
    const ended = drag;
    drag = null;
    if (ended && ended.isDragging) settle(ended.wasOpen);
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  // Not passive: a sideways drag must stop the page scrolling under it.
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchCancel);

  window.SidebarSwipe = { isOpenAfterRelease };
})();
