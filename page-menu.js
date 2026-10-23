// The menu a long press on a sidebar page opens on touch screens, where the
// row's own buttons are hidden: Share, Rename and Delete (or Leave) in one
// place. Loads before storage.js, which hands each row to watchForHold.
(function initPageMenu() {
  'use strict';

  const HOLD_MS = 500;
  // A finger drifting further than this is scrolling the list, not holding.
  const MOVE_TOLERANCE_PX = 10;
  const TOUCH = 'touch';
  const CLOSE_DELAY_MS = 200;

  const byId = id => document.getElementById(id);

  function hasMovedTooFar(start, event) {
    return Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX;
  }

  // iOS never sends contextmenu for a long press, so a timer finds the hold;
  // Android may send it first, and then it opens the menu instead.
  function watchForHold(row, onHold) {
    let timer = null;
    let start = null;
    let isTouch = false;
    let isHeld = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    const hold = () => {
      cancel();
      if (isHeld) return;
      isHeld = true;
      swallowLiftClick();
      onHold();
    };

    row.addEventListener('pointerdown', event => {
      isTouch = event.pointerType === TOUCH;
      isHeld = false;
      if (!isTouch) return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(hold, HOLD_MS);
    });
    row.addEventListener('pointermove', event => {
      if (timer && hasMovedTooFar(start, event)) cancel();
    });
    for (const type of ['pointerup', 'pointercancel']) row.addEventListener(type, cancel);
    row.addEventListener('contextmenu', event => {
      if (!isTouch) return;
      event.preventDefault();
      hold();
    });
  }

  function swallowClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  // The finger lifting after a hold sends a click, which would open the page
  // or land on the menu's backdrop and shut it. Android may send none, so the
  // next touch takes the trap away before its own click.
  function swallowLiftClick() {
    document.addEventListener('click', swallowClick, { capture: true, once: true });
    document.addEventListener('pointerdown', () => {
      document.removeEventListener('click', swallowClick, { capture: true });
    }, { capture: true, once: true });
  }

  const overlay = byId('page-menu-overlay');
  let menuActions = null;
  let heldRow = null;

  function closePageMenu() {
    overlay.classList.remove('open');
    setTimeout(() => { if (!overlay.classList.contains('open')) overlay.hidden = true; }, CLOSE_DELAY_MS);
    if (heldRow) heldRow.classList.remove('is-held');
    heldRow = null;
    menuActions = null;
  }

  // actions holds share (or null, when this page can't be shared), rename,
  // and remove, with removeLabel saying whether removing deletes or leaves.
  function openPageMenu(row, title, actions) {
    menuActions = actions;
    heldRow = row;
    row.classList.add('is-held');
    byId('page-menu-title').textContent = title;
    byId('page-menu-share').hidden = !actions.share;
    byId('page-menu-remove').textContent = actions.removeLabel;
    overlay.hidden = false;
    overlay.classList.add('open');
  }

  function runMenuAction(name) {
    const action = menuActions && menuActions[name];
    closePageMenu();
    if (action) action();
  }

  for (const button of overlay.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => runMenuAction(button.dataset.action));
  }
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closePageMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) closePageMenu();
  });

  window.PageMenu = Object.freeze({ watchForHold, open: openPageMenu });
})();
