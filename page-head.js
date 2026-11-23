// On phones the page's head (its title, Share, the page's own buttons and any
// notice) floats over the top of the words and scrolls away with them, so a
// long lyric gets the whole screen. styles.css places it; this keeps the
// words starting under it and gets it scrolling with them. Invite is not part
// of it and stays in the panel's corner.
//
// While the editor shows, the head sits inside the editor's scroller, so the
// browser scrolls it with the words itself. Moving it from a scroll handler
// instead ran a frame behind the words on iOS, and the title shook as the
// page scrolled. The preview redraws its whole box, so there the head stays
// in the panel and follows the preview's scroll as before.
(function definePageHead() {
  'use strict';

  const PHONE_QUERY = window.matchMedia('(max-width: 768px)');
  const HEIGHT_PROPERTY = '--page-head-height';

  const panelEl = document.querySelector('.lyrics-panel');
  const headEl = document.getElementById('page-head');
  const editorEl = document.querySelector('.lyrics-area');
  const previewEl = document.getElementById('page-preview');
  // The head's own spot in the panel, to go back to.
  const homeNextEl = headEl.nextElementSibling;

  let moveFrame = null;

  function isPhone() {
    return PHONE_QUERY.matches;
  }

  function belongsInEditor() {
    return isPhone() && !editorEl.hidden;
  }

  function placeHead() {
    if (belongsInEditor()) {
      if (headEl.parentElement !== editorEl) editorEl.prepend(headEl);
    } else if (headEl.parentElement !== panelEl) {
      panelEl.insertBefore(headEl, homeNextEl);
    }
  }

  function setHeadHeight() {
    if (!isPhone()) {
      panelEl.style.removeProperty(HEIGHT_PROPERTY);
      return;
    }
    panelEl.style.setProperty(HEIGHT_PROPERTY, headEl.offsetHeight + 'px');
  }

  // Only the preview needs this: in the editor the head scrolls on its own.
  // It goes up exactly as far as the words, so it reads as their top.
  function moveHead() {
    moveFrame = null;
    const followsPreview = isPhone() && headEl.parentElement === panelEl &&
      previewEl && !previewEl.hidden;
    if (!followsPreview) {
      headEl.style.removeProperty('transform');
      return;
    }
    const offset = Math.min(previewEl.scrollTop, headEl.offsetHeight);
    headEl.style.transform = offset > 0 ? `translateY(${-offset}px)` : '';
  }

  function scheduleMove() {
    if (moveFrame === null) moveFrame = requestAnimationFrame(moveHead);
  }

  function fitToLayout() {
    placeHead();
    setHeadHeight();
    moveHead();
  }

  new ResizeObserver(fitToLayout).observe(headEl);
  // The preview hides the editor while it is open.
  new MutationObserver(fitToLayout).observe(editorEl, { attributeFilter: ['hidden'] });
  if (previewEl) previewEl.addEventListener('scroll', scheduleMove, { passive: true });
  PHONE_QUERY.addEventListener('change', fitToLayout);
  fitToLayout();
})();
