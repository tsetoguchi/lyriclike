// One sidebar at every size. Wide, it is docked beside the page, open until
// the writer hides it, and remembered that way. Narrower, it slides over the
// page and gets out of the way once a page is picked. What it holds is
// notebook-list.js's.
(function exposeSidebar() {
  'use strict';

  // Whether the docked sidebar was last left open, per device.
  const SIDEBAR_STORAGE_KEY = 'sidebar_open';
  // Wide enough for the sidebar, the sheet and the rhymes panel side by side.
  // Narrower, the sidebar slides over the page instead of pushing it.
  const SIDEBAR_DOCK_QUERY = window.matchMedia('(min-width: 1200px)');

  function isDocked() {
    return SIDEBAR_DOCK_QUERY.matches;
  }

  // Storage that cannot be read leaves it open: the notebook is the default.
  function readSidebarPreference() {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  // The phone bar's notebook button lights up amber while the sidebar is open,
  // like the other tool buttons do while their tool is on.
  function setNotebookButtonActive(isActive) {
    const button = document.getElementById('notebook-btn');
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-expanded', String(isActive));
  }

  function setSidebarOpen(isOpen, { remember = false } = {}) {
    document.body.classList.toggle('sidebar-open', isOpen);
    document.getElementById('rail-open-btn').setAttribute('aria-expanded', String(isOpen));
    setNotebookButtonActive(isOpen);
    if (remember && isDocked()) {
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, isOpen ? '1' : '0');
      } catch {
        // Not remembered this time; the sidebar still opens and closes.
      }
    }
  }

  function isOpen() {
    return document.body.classList.contains('sidebar-open');
  }

  function show() {
    setSidebarOpen(true, { remember: true });
  }

  function hide() {
    setSidebarOpen(false, { remember: true });
  }

  // Picking or making a page puts a sliding sidebar away. A docked one stays.
  function close() {
    if (!isDocked()) setSidebarOpen(false);
  }

  function placeForViewport() {
    setSidebarOpen(isDocked() && readSidebarPreference());
  }

  document.getElementById('sidebar-close-btn').addEventListener('click', hide);
  document.getElementById('sidebar-scrim').addEventListener('click', hide);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen() && !isDocked()) hide();
  });
  SIDEBAR_DOCK_QUERY.addEventListener('change', placeForViewport);
  placeForViewport();
  // Two frames: the first paints the sidebar where it was placed, the second
  // lets later changes animate.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('sidebar-animate')));

  window.Sidebar = { isOpen, isDocked, show, hide, close };
})();
