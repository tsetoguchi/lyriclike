// Keeps popups above the on-screen keyboard. On iOS the keyboard covers the
// page instead of shrinking it, so a popup that fills the screen would have
// its fields hidden; on a short screen, like an iPhone Duo standing as a
// tent, that is the whole form. This sets --keyboard-inset to the height the
// keyboard covers, which the popup overlays leave clear, and scrolls the
// field being typed in back into view.
(() => {
  const OVERLAY_SELECTOR = '.modal-overlay, #password-overlay';

  // The layout viewport keeps its height under the keyboard; the visual one
  // loses it.
  function measureKeyboardInset(viewport, layoutHeight) {
    const covered = layoutHeight - viewport.height - viewport.offsetTop;
    return Math.max(0, Math.round(covered));
  }

  function revealFocusedField() {
    const field = document.activeElement;
    if (!field || !field.closest(OVERLAY_SELECTOR)) return;
    field.scrollIntoView({ block: 'nearest' });
  }

  function applyKeyboardInset() {
    const inset = measureKeyboardInset(window.visualViewport,
      document.documentElement.clientHeight);
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
    requestAnimationFrame(revealFocusedField);
  }

  window.KeyboardInset = { measureKeyboardInset };
  if (!window.visualViewport) return;
  window.visualViewport.addEventListener('resize', applyKeyboardInset);
  window.visualViewport.addEventListener('scroll', applyKeyboardInset);
})();
