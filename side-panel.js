// The side panel: a spot where the rhymes panel sits, for an extension's own
// element. The open app owns showing and hiding it; extensions.js passes
// the calls through.
(function exposeSidePanel(root) {
  'use strict';

  const PANEL_ID = 'side-panel';
  const OPEN_CLASS = 'has-side-panel';
  const CLOSED_EVENT = 'side-panel-closed';

  function panelElement() {
    return document.getElementById(PANEL_ID);
  }

  function isOpen() {
    const panel = panelElement();
    return Boolean(panel) && !panel.hidden;
  }

  function open(element) {
    const panel = panelElement();
    if (!panel || !(element instanceof Element)) return false;
    panel.replaceChildren(element);
    panel.hidden = false;
    document.querySelector('.main').classList.add(OPEN_CLASS);
    return true;
  }

  function close() {
    if (!isOpen()) return;
    const panel = panelElement();
    panel.replaceChildren();
    panel.hidden = true;
    document.querySelector('.main').classList.remove(OPEN_CLASS);
    document.dispatchEvent(new Event(CLOSED_EVENT));
  }

  root.SidePanel = { open, close, isOpen };
})(this);
