// On a phone a word's meaning opens as a sheet from the bottom, with a grip
// on top. A drag down on it follows the finger, and the dim behind it fades
// as it goes. Let go far enough down, or flick it, and it slides away;
// otherwise it springs back. A meaning long enough to scroll only gives up
// the drag once it is scrolled to its top, so reading it never closes it.
(function defineSheetDrag() {
  'use strict';

  const SHEET_SELECTOR = '.def-popup';
  const SCRIM_SELECTOR = '.def-overlay';
  // Let go past this share of the sheet's height, it closes.
  const CLOSE_SHARE = 1 / 3;
  // A flick down this fast closes it however far it went.
  const FLICK_PX_PER_MS = 0.5;
  // Movement before the drag picks a direction; sideways is not this drag's.
  const SLOP_PX = 10;
  // Pulled up, the sheet gives only this much, so it can't leave the bottom.
  const UP_GIVE = 0.15;
  const DRAGGING_CLASS = 'is-dragging';
  const SETTLING_CLASS = 'is-settling';
  // Matches the sheet's own slide in styles.css.
  const SETTLE_MS = 250;

  let drag = null;

  // Pure: whether a drag has gone far enough down that letting go closes it.
  function isPastShare({ dy, height }) {
    return dy > height * CLOSE_SHARE;
  }

  // Pure: whether a drag let go here closes the sheet.
  function isClosedAfterRelease({ dy, elapsedMs, height }) {
    const speed = elapsedMs > 0 ? dy / elapsedMs : 0;
    if (speed >= FLICK_PX_PER_MS) return true;
    return isPastShare({ dy, height });
  }

  // haptics.js may be missing (an older bundle); then nothing plays.
  function feel(moment) {
    if (window.AppHaptics) window.AppHaptics[moment]();
  }

  // One tick as the drag crosses the line where letting go closes it, and
  // none again until it has gone back up over the line.
  function tickAtShare() {
    const isPast = isPastShare(drag);
    if (isPast && !drag.isPast) feel('tick');
    drag.isPast = isPast;
  }

  function isPhone() {
    return typeof window.isMobileView === 'function' && window.isMobileView();
  }

  function onTouchStart(event) {
    drag = null;
    if (event.touches.length !== 1 || !isPhone()) return;
    const sheet = event.target.closest && event.target.closest(SHEET_SELECTOR);
    if (!sheet) return;
    const touch = event.touches[0];
    drag = {
      sheet, startX: touch.clientX, startY: touch.clientY,
      startedAt: event.timeStamp, isDragging: false, dy: 0, isPast: false,
    };
  }

  // Down from a sheet at its top is a drag; anything else is a scroll, or
  // another file's sideways swipe, and is left alone.
  function isDragDown(dx, dy, sheet) {
    if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return null;
    return dy > Math.abs(dx) && sheet.scrollTop <= 0;
  }

  function beginDrag() {
    drag.isDragging = true;
    drag.height = drag.sheet.offsetHeight;
    drag.scrim = document.querySelector(SCRIM_SELECTOR);
    drag.sheet.classList.add(DRAGGING_CLASS);
    if (drag.scrim) drag.scrim.classList.add(DRAGGING_CLASS);
    feel('startTicks');
  }

  function followFinger() {
    const offset = drag.dy < 0 ? drag.dy * UP_GIVE : drag.dy;
    drag.sheet.style.transform = `translateY(${offset}px)`;
    if (drag.scrim) {
      const share = Math.max(0, Math.min(1, offset / drag.height));
      drag.scrim.style.opacity = String(1 - share);
    }
  }

  function onTouchMove(event) {
    if (!drag) return;
    const touch = event.touches[0];
    drag.dy = touch.clientY - drag.startY;
    if (!drag.isDragging) {
      const isDown = isDragDown(touch.clientX - drag.startX, drag.dy, drag.sheet);
      if (isDown === null) return;
      if (!isDown) {
        drag = null;
        return;
      }
      beginDrag();
    }
    event.preventDefault();
    followFinger();
    tickAtShare();
  }

  // The sheet's transition carries it on from where the finger left it.
  function settle(ended, isClosed) {
    feel('endTicks');
    const { sheet, scrim } = ended;
    sheet.classList.remove(DRAGGING_CLASS);
    sheet.classList.add(SETTLING_CLASS);
    if (scrim) {
      scrim.classList.remove(DRAGGING_CLASS);
      scrim.classList.add(SETTLING_CLASS);
    }
    if (isClosed) {
      sheet.style.transform = 'translateY(100%)';
      if (scrim) scrim.style.opacity = '0';
      setTimeout(() => {
        // A new word may have opened its own sheet meanwhile.
        if (sheet.isConnected && typeof window.closeDefinition === 'function') {
          window.closeDefinition();
        }
      }, SETTLE_MS);
      return;
    }
    sheet.style.removeProperty('transform');
    if (scrim) scrim.style.removeProperty('opacity');
    setTimeout(() => {
      sheet.classList.remove(SETTLING_CLASS);
      if (scrim) scrim.classList.remove(SETTLING_CLASS);
    }, SETTLE_MS);
  }

  function onTouchEnd(event) {
    const ended = drag;
    drag = null;
    if (!ended || !ended.isDragging) return;
    settle(ended, isClosedAfterRelease({
      dy: ended.dy, elapsedMs: event.timeStamp - ended.startedAt, height: ended.height,
    }));
  }

  function onTouchCancel() {
    const ended = drag;
    drag = null;
    if (ended && ended.isDragging) settle(ended, false);
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  // Not passive: a drag down must stop the sheet's own scroll under it.
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchCancel);

  window.SheetDrag = { isClosedAfterRelease, isPastShare };
})();
