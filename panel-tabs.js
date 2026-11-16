// The tabs across the top of the word panel. Rhymes is always there; an
// extension may add more beside it (see extensions.js). With none added the
// strip stays hidden and the panel is the rhymes alone. The browser loads
// this as a module and reads window.PanelTabs; Node loads it with require.
(function exposePanelTabs(root) {
  'use strict';

  const RHYMES_TAB_ID = 'rhymes';
  const ADDED_ID_PREFIX = 'tab-';

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

  const PanelTabs = { createTabList, RHYMES_TAB_ID };

  if (typeof module === 'object' && module.exports) {
    module.exports = PanelTabs;
  } else {
    root.PanelTabs = PanelTabs;
  }
})(globalThis);
