// Press and hold on the phone's Highlights button: the menu opens under the
// finger, the finger slides onto an overlay, and letting go there switches
// it, as a tap on it would, and shuts the menu. Letting go anywhere else
// leaves the menu open. A quick tap still opens and shuts it (app.js).
(function defineHighlightsHold() {
  'use strict';

  // Longer than a tap, shorter than iOS's own long-press callout.
  const HOLD_MS = 350;
  // A finger that wanders this far before the menu opens is scrolling.
  const SLOP_PX = 10;
  const PICKING_CLASS = 'is-picking';
  // A click this soon after a hold ends is that hold's, not a new tap.
  const AFTER_HOLD_MS = 500;

  const buttonEl = document.getElementById('rhymes-menu-btn');
  const popoverEl = document.getElementById('rhymes-menu-popover');

  let press = null;
  // The click that follows a hold must not shut the menu it just opened.
  let heldUntil = 0;

  // The overlay button under a point, or null.
  function itemAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const item = el && el.closest('.toggle-btn');
    return item && popoverEl.contains(item) ? item : null;
  }

  function markPicking(item) {
    if (press.item === item) return;
    if (press.item) press.item.classList.remove(PICKING_CLASS);
    if (item) item.classList.add(PICKING_CLASS);
    press.item = item;
  }

  function onPointerDown(event) {
    press = null;
    if (event.pointerType !== 'touch' || window.isRhymesMenuOpen()) return;
    press = { x: event.clientX, y: event.clientY, isHeld: false, item: null };
    press.timer = setTimeout(() => {
      press.isHeld = true;
      window.setRhymesMenuOpen(true);
    }, HOLD_MS);
  }

  function onPointerMove(event) {
    if (!press) return;
    if (press.isHeld) {
      markPicking(itemAt(event.clientX, event.clientY));
      return;
    }
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (moved > SLOP_PX) cancel();
  }

  function onPointerUp(event) {
    const ended = press;
    press = null;
    if (!ended) return;
    clearTimeout(ended.timer);
    if (!ended.isHeld) return;
    heldUntil = event.timeStamp + AFTER_HOLD_MS;
    if (!ended.item) return;
    ended.item.classList.remove(PICKING_CLASS);
    ended.item.click();
    window.setRhymesMenuOpen(false);
  }

  function cancel() {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.item) press.item.classList.remove(PICKING_CLASS);
    press = null;
  }

  function onClick(event) {
    if (event.timeStamp > heldUntil) return;
    heldUntil = 0;
    event.stopImmediatePropagation();
  }

  buttonEl.addEventListener('pointerdown', onPointerDown);
  buttonEl.addEventListener('pointermove', onPointerMove);
  buttonEl.addEventListener('pointerup', onPointerUp);
  buttonEl.addEventListener('pointercancel', cancel);
  // Capture, so it runs before app.js's toggle on the same button.
  buttonEl.addEventListener('click', onClick, true);
  // A held press is a gesture here, not the system's menu.
  buttonEl.addEventListener('contextmenu', event => {
    if (press) event.preventDefault();
  });
})();
