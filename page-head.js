// On phones the page's head (its title, Share, the page's own buttons and any
// notice) floats over the top of the words and scrolls away with them, so a
// long lyric gets the whole screen. styles.css places it; this keeps the
// words starting under it and moves it as they scroll. Invite is not part of
// it and stays in the panel's corner.
(function definePageHead() {
  'use strict';

  const PHONE_QUERY = window.matchMedia('(max-width: 768px)');
  const HEIGHT_PROPERTY = '--page-head-height';

  const panelEl = document.querySelector('.lyrics-panel');
  const headEl = document.getElementById('page-head');
  const scrollers = [
    document.querySelector('.lyrics-area'), document.getElementById('page-preview'),
  ].filter(Boolean);

  let moveFrame = null;

  function isPhone() {
    return PHONE_QUERY.matches;
  }

  function setHeadHeight() {
    if (!isPhone()) {
      panelEl.style.removeProperty(HEIGHT_PROPERTY);
      return;
    }
    panelEl.style.setProperty(HEIGHT_PROPERTY, headEl.offsetHeight + 'px');
  }

  // Whichever scroller is showing: the preview takes the words' place.
  function visibleScrollTop() {
    const shown = scrollers.find(el => !el.hidden && el.offsetParent !== null);
    return shown ? shown.scrollTop : 0;
  }

  // The head goes up exactly as far as the words, so it reads as their top.
  function moveHead() {
    moveFrame = null;
    if (!isPhone()) {
      headEl.style.removeProperty('transform');
      return;
    }
    const offset = Math.min(visibleScrollTop(), headEl.offsetHeight);
    headEl.style.transform = offset > 0 ? `translateY(${-offset}px)` : '';
  }

  function scheduleMove() {
    if (moveFrame === null) moveFrame = requestAnimationFrame(moveHead);
  }

  function fitToLayout() {
    setHeadHeight();
    moveHead();
  }

  new ResizeObserver(fitToLayout).observe(headEl);
  for (const scroller of scrollers) {
    scroller.addEventListener('scroll', scheduleMove, { passive: true });
  }
  PHONE_QUERY.addEventListener('change', fitToLayout);
  fitToLayout();
})();
