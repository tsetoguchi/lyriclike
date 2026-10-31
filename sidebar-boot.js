// Opens the docked sidebar before the first paint. sidebar.js runs at the end
// of the page, so without this the page draws at the rail's width and then
// jumps right by the sidebar's. The two must agree on the width and the key.
(function openDockedSidebarEarly() {
  'use strict';

  const SIDEBAR_STORAGE_KEY = 'sidebar_open';
  const SIDEBAR_DOCK_QUERY = '(min-width: 1200px)';
  const SIDEBAR_OPEN_CLASS = 'sidebar-open';

  function isOpenPreferred() {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  if (window.matchMedia(SIDEBAR_DOCK_QUERY).matches && isOpenPreferred()) {
    document.body.classList.add(SIDEBAR_OPEN_CLASS);
  }
})();
