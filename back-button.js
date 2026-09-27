// The phone's Back button closes whatever is open on top, instead of leaving
// the site. While anything closable is open, one extra history entry sits on
// top of the page; Back pops it and this file closes the topmost layer. A
// layer closed any other way takes the entry back out, so Back never has to
// be pressed twice to leave.
(function handleBackButton() {
  'use strict';

  const GUARD_STATE = { backGuard: true };
  const OPEN_CLASS = 'open';

  const dialogOverlay = document.getElementById('dialog-overlay');
  const authOverlay = document.getElementById('auth-overlay');
  const settingsOverlay = document.getElementById('account-settings-overlay');

  // Topmost first: Back closes the first one that is open.
  const LAYERS = [
    { isOpen: () => isOverlayOpen(dialogOverlay), close: () => closeDialog(null) },
    { isOpen: () => isOverlayOpen(authOverlay), close: () => window.closeAuthModal() },
    { isOpen: () => isOverlayOpen(settingsOverlay), close: closeAccountSettings },
    { isOpen: isDefinitionOpen, close: closeDefinition },
    { isOpen: isRhymesMenuOpen, close: () => setRhymesMenuOpen(false) },
    { isOpen: () => isSidebarOpen() && !isSidebarDocked(), close: hideSidebar },
    { isOpen: isRhymesTabShowing, close: () => switchMobileTab(LYRICS_TAB) },
  ];

  let hasGuard = history.state !== null && history.state.backGuard === true;
  let isUnwinding = false;

  function isOverlayOpen(overlay) {
    return overlay.classList.contains(OPEN_CLASS);
  }

  // Only a tapped definition has an overlay; a hover peek is not a layer.
  function isDefinitionOpen() {
    return document.querySelector('.def-overlay') !== null;
  }

  function isRhymesTabShowing() {
    return isMobileView() && mainEl.classList.contains('show-rhymes');
  }

  function isAnyLayerOpen() {
    return LAYERS.some(layer => layer.isOpen());
  }

  // Waits out an unwind in progress: pushing before its popstate lands would
  // let that popstate eat the new entry.
  function syncGuard() {
    if (isUnwinding) return;
    const isOpen = isAnyLayerOpen();
    if (isOpen && !hasGuard) {
      history.pushState(GUARD_STATE, '');
      hasGuard = true;
    } else if (!isOpen && hasGuard) {
      isUnwinding = true;
      hasGuard = false;
      history.back();
    }
  }

  function closeTopLayer() {
    const layer = LAYERS.find(candidate => candidate.isOpen());
    if (layer) layer.close();
  }

  function handlePopState() {
    if (isUnwinding) {
      isUnwinding = false;
    } else {
      hasGuard = false;
      closeTopLayer();
    }
    syncGuard();
  }

  function watchLayers() {
    const observer = new MutationObserver(syncGuard);
    const watchClass = { attributes: true, attributeFilter: ['class'] };
    observer.observe(document.body, { ...watchClass, childList: true });
    observer.observe(dialogOverlay, watchClass);
    observer.observe(authOverlay, watchClass);
    observer.observe(settingsOverlay, watchClass);
    observer.observe(mainEl, watchClass);
    observer.observe(rhymesMenuPopoverEl, { attributes: true, attributeFilter: ['hidden'] });
  }

  window.addEventListener('popstate', handlePopState);
  // Widening past the phone breakpoint turns the Rhymes tab and a sliding
  // sidebar into fixed parts of the page, with no mutation to announce it.
  window.addEventListener('resize', syncGuard);
  watchLayers();
  syncGuard();
})();
