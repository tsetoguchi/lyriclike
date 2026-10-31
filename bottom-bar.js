// The phone's bottom bar, lent to an extension. While an element is in it,
// the bar's own buttons step aside and the element takes their place; closing
// it (or the side panel behind it closing) brings them back. extensions.js
// passes the calls through.
(function exposeBottomBar(root) {
  'use strict';

  const NAV_ID = 'bottom-nav';
  const SLOT_CLASS = 'bottom-bar-slot';
  const OPEN_CLASS = 'has-bar-slot';
  const SIDE_PANEL_CLOSED_EVENT = 'side-panel-closed';

  function navElement() {
    return document.getElementById(NAV_ID);
  }

  function slotElement() {
    const nav = navElement();
    return nav ? nav.querySelector('.' + SLOT_CLASS) : null;
  }

  function isOpen() {
    return slotElement() !== null;
  }

  function open(element) {
    const nav = navElement();
    if (!nav || !(element instanceof Element)) return false;
    const slot = slotElement() || document.createElement('div');
    slot.className = SLOT_CLASS;
    slot.replaceChildren(element);
    nav.append(slot);
    nav.classList.add(OPEN_CLASS);
    return true;
  }

  function close() {
    const slot = slotElement();
    if (!slot) return;
    slot.remove();
    navElement().classList.remove(OPEN_CLASS);
  }

  document.addEventListener(SIDE_PANEL_CLOSED_EVENT, close);

  root.BottomBar = { open, close, isOpen };
})(this);
