// The tabs across the top of the word panel. Rhymes is always there; an
// extension may add more beside it (see extensions.js). With none added the
// strip stays hidden and the panel is the rhymes alone. The browser loads
// this as a module and reads window.PanelTabs; Node loads it with require.
(function exposePanelTabs(root) {
  'use strict';

  const RHYMES_TAB_ID = 'rhymes';
  const ADDED_ID_PREFIX = 'tab-';
  const RHYMES_LABEL = 'Rhymes';
  const PANEL_ID = 'rhymes-panel';
  const STRIP_ID = 'panel-tabs';
  const BODY_ID = 'panel-tab-body';
  const TAB_CLASS = 'panel-tab';
  // On the panel while an added tab shows; styles.css hides the rhymes by it.
  const OPEN_CLASS = 'shows-added-tab';

  // Which tabs there are and which one shows. It touches no page: the
  // caller acts on what select() says closed and opened.
  function createTabList() {
    const addedTabs = [];
    let activeId = RHYMES_TAB_ID;
    let nextNumber = 1;

    function findTab(id) {
      const entry = addedTabs.find((added) => added.id === id);
      return entry ? entry.tab : null;
    }

    function add(tab) {
      const id = ADDED_ID_PREFIX + nextNumber;
      nextNumber += 1;
      addedTabs.push({ id, tab });
      return id;
    }

    function select(id) {
      const isKnown = id === RHYMES_TAB_ID || findTab(id) !== null;
      if (!isKnown || id === activeId) return null;
      const change = { closed: findTab(activeId), opened: findTab(id) };
      activeId = id;
      return change;
    }

    // The caller closes the tab first, so this only forgets it.
    function remove(id) {
      const index = addedTabs.findIndex((added) => added.id === id);
      if (index === -1) return false;
      addedTabs.splice(index, 1);
      if (activeId === id) activeId = RHYMES_TAB_ID;
      return true;
    }

    return {
      add,
      select,
      remove,
      activeId: () => activeId,
      added: () => addedTabs.map(({ id, tab }) => ({ id, label: tab.label })),
    };
  }

  // ── The strip on the page ──

  const pageTabs = createTabList();

  function pageElements() {
    if (typeof document === 'undefined') return null;
    const panel = document.getElementById(PANEL_ID);
    const strip = document.getElementById(STRIP_ID);
    const body = document.getElementById(BODY_ID);
    return panel && strip && body ? { panel, strip, body } : null;
  }

  // A tab is someone else's code: its failure must not take the strip down.
  function runTabCallback(callback, argument) {
    try {
      callback(argument);
    } catch (error) {
      console.warn('Word panel tab failed:', error);
    }
  }

  function showBody({ panel, body }, tab) {
    panel.classList.add(OPEN_CLASS);
    body.replaceChildren();
    body.hidden = false;
    runTabCallback(tab.onOpen, body);
  }

  function hideBody({ panel, body }, tab) {
    if (tab.onClose) runTabCallback(tab.onClose);
    body.replaceChildren();
    body.hidden = true;
    panel.classList.remove(OPEN_CLASS);
  }

  function buildTabButton(id, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = TAB_CLASS;
    button.dataset.tabId = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(id === pageTabs.activeId()));
    button.textContent = label;
    return button;
  }

  // Hidden with nothing added, so the panel is the rhymes alone.
  function drawStrip({ strip }) {
    const added = pageTabs.added();
    const tabs = [{ id: RHYMES_TAB_ID, label: RHYMES_LABEL }, ...added];
    strip.replaceChildren(...tabs.map(({ id, label }) => buildTabButton(id, label)));
    strip.hidden = added.length === 0;
  }

  function selectTab(elements, id) {
    const change = pageTabs.select(id);
    if (change && change.closed) hideBody(elements, change.closed);
    if (change && change.opened) showBody(elements, change.opened);
    drawStrip(elements);
  }

  function onStripClick(event) {
    const button = event.target.closest('.' + TAB_CLASS);
    const elements = pageElements();
    if (button && elements) selectTab(elements, button.dataset.tabId);
  }

  // Returns the function that takes the tab away again, or null on a page
  // with no word panel.
  function add(tab) {
    const elements = pageElements();
    if (!elements) return null;
    const id = pageTabs.add(tab);
    drawStrip(elements);
    return function remove() {
      if (pageTabs.activeId() === id) selectTab(elements, RHYMES_TAB_ID);
      if (pageTabs.remove(id)) drawStrip(elements);
    };
  }

  function listenToStrip() {
    const elements = pageElements();
    if (elements) elements.strip.addEventListener('click', onStripClick);
  }

  listenToStrip();

  const PanelTabs = { createTabList, RHYMES_TAB_ID, add };

  if (typeof module === 'object' && module.exports) {
    module.exports = PanelTabs;
  } else {
    root.PanelTabs = PanelTabs;
  }
})(globalThis);
