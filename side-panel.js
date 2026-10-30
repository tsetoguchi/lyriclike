// The side panel: a spot where the rhymes panel sits, for an extension's own
// element. The open app owns showing and hiding it; extensions.js passes
// the calls through.
(function exposeSidePanel(root) {
  'use strict';

  const PANEL_ID = 'side-panel';
  const MAIN_SELECTOR = '.main';
  const OPEN_CLASS = 'has-side-panel';
  const CLOSED_EVENT = 'side-panel-closed';

  function panelElement() {
    return document.getElementById(PANEL_ID);
  }

  function isOpen() {
    const panel = panelElement();
    return Boolean(panel) && !panel.hidden;
  }

  function mainElement() {
    return document.querySelector(MAIN_SELECTOR);
  }

  // On a phone the notebook drawer would cover the full-screen panel.
  function closeNotebookDrawer() {
    if (root.Sidebar) root.Sidebar.close();
  }

  function open(element) {
    const panel = panelElement();
    const main = mainElement();
    if (!panel || !main || !(element instanceof Element)) return false;
    panel.replaceChildren(element);
    panel.hidden = false;
    main.classList.add(OPEN_CLASS);
    closeNotebookDrawer();
    return true;
  }

  function close() {
    if (!isOpen()) return;
    const panel = panelElement();
    panel.replaceChildren();
    panel.hidden = true;
    const main = mainElement();
    if (main) main.classList.remove(OPEN_CLASS);
    document.dispatchEvent(new Event(CLOSED_EVENT));
  }

  root.SidePanel = { open, close, isOpen };
})(this);
