// The sample verse's first-visit pointer: a faint arrow from the picked word
// to where its rhymes show, and one line on what to do. storage.js decides
// when it shows; this file only draws it.
(function defineSamplePointer() {
  'use strict';

  const TIP_POINTER = 'Click a word to explore rhymes';
  const TIP_TOUCH = 'Tap a word to explore rhymes';
  // Space left between the arrow's ends and what they point from and to.
  const END_GAP_PX = 8;
  // Shorter than this the arrow reads as a smudge, not a pointer.
  const MIN_ARROW_PX = 24;
  // How far the arrow bows away from a straight line.
  const CURVE_BOW_PX = 14;
  const TIP_GAP_PX = 6;
  // On a phone the tip sits under the verse rather than over its lines.
  const TIP_BELOW_VERSE_PX = 12;
  // Matches the page's side gutter, so the tip never touches the screen edge.
  const TIP_EDGE_PX = 16;

  const pointerEl = document.getElementById('sample-pointer');
  const pathEl = pointerEl.querySelector('.sample-pointer-path');
  const tipEl = pointerEl.querySelector('.sample-pointer-tip');
  const lyricsAreaEl = document.querySelector('.lyrics-area');
  const panelWordEl = document.getElementById('selected-word');
  const panelEl = document.getElementById('rhymes-panel');
  const rhymesTabEl = document.querySelector('.mobile-tab[data-tab="rhymes"]');
  const sampleClearEl = document.getElementById('sample-clear');
  let isActive = false;
  let placeFrame = null;

  function isVisibleRect(rect) {
    return rect.width > 0 && rect.height > 0;
  }

  // Phones show the rhymes on their own tab, so the arrow aims at the tab.
  function isTabLayout() {
    return isVisibleRect(rhymesTabEl.getBoundingClientRect());
  }

  // A word scrolled out of the editor has nothing to point from.
  function isInsideLyrics(rect) {
    const area = lyricsAreaEl.getBoundingClientRect();
    return rect.top >= area.top && rect.bottom <= area.bottom;
  }

  function panelTargetRect() {
    const wordRect = panelWordEl.getBoundingClientRect();
    return isVisibleRect(wordRect) ? wordRect : panelEl.getBoundingClientRect();
  }

  function arrowToPanel(wordRect) {
    const target = panelTargetRect();
    // Leaving from the word's top keeps clear of the rhyme scheme letter that
    // sits just past the end of the line.
    const from = { x: wordRect.left + wordRect.width / 2, y: wordRect.top - END_GAP_PX };
    const to = { x: target.left - END_GAP_PX, y: target.top + target.height / 2 };
    if (to.x - from.x < MIN_ARROW_PX) return null;
    return { from, to, wordRect, bow: CURVE_BOW_PX, isTab: false };
  }

  // The sample's button sits between the verse and the tabs, so the arrow
  // lands right of it and bows right, away from it.
  function arrowToTab(wordRect) {
    const tab = rhymesTabEl.getBoundingClientRect();
    const buttonRight = sampleClearEl.getBoundingClientRect().right;
    const from = { x: wordRect.left + wordRect.width / 2, y: wordRect.top - END_GAP_PX };
    const to = {
      x: Math.max(tab.left + tab.width / 2, buttonRight + END_GAP_PX),
      y: tab.bottom + END_GAP_PX,
    };
    if (from.y - to.y < MIN_ARROW_PX) return null;
    return { from, to, wordRect, bow: -CURVE_BOW_PX, isTab: true };
  }

  function measureArrow() {
    const wordEl = document.querySelector('#lyrics-highlight .highlight-word');
    if (!wordEl) return null;
    const wordRect = wordEl.getBoundingClientRect();
    if (!isVisibleRect(wordRect) || !isInsideLyrics(wordRect)) return null;
    return isTabLayout() ? arrowToTab(wordRect) : arrowToPanel(wordRect);
  }

  // The bend sits square to the line. A positive bow is on its left-hand
  // side as drawn: up for an arrow running right, left for one running up.
  function bendPoint(arrow) {
    const { from, to, bow } = arrow;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return {
      x: (from.x + to.x) / 2 + (dy / length) * bow,
      y: (from.y + to.y) / 2 - (dx / length) * bow,
    };
  }

  function drawArrow(arrow) {
    const bend = bendPoint(arrow);
    pathEl.setAttribute('d', 'M' + arrow.from.x + ' ' + arrow.from.y +
      ' Q' + bend.x + ' ' + bend.y + ' ' + arrow.to.x + ' ' + arrow.to.y);
  }

  // Where the drawn curve passes halfway, which is not the bend point itself.
  function curveMiddle(arrow) {
    const bend = bendPoint(arrow);
    return {
      x: (arrow.from.x + 2 * bend.x + arrow.to.x) / 4,
      y: (arrow.from.y + 2 * bend.y + arrow.to.y) / 4,
    };
  }

  function clampTipLeft(left, tipWidth) {
    const maxLeft = window.innerWidth - TIP_EDGE_PX - tipWidth;
    return Math.max(TIP_EDGE_PX, Math.min(left, maxLeft));
  }

  function verseBottom() {
    const words = document.querySelectorAll('#lyrics-highlight .lyric-word');
    return words[words.length - 1].getBoundingClientRect().bottom;
  }

  // On a wide screen the tip rides the arrow's middle, like a label on it.
  // On a phone the arrow is short and steep, so the tip waits under the verse.
  function placeTip(arrow) {
    const tipWidth = tipEl.offsetWidth;
    const middle = curveMiddle(arrow);
    const left = arrow.isTab ? arrow.wordRect.right - tipWidth : middle.x - tipWidth / 2;
    const top = arrow.isTab
      ? verseBottom() + TIP_BELOW_VERSE_PX
      : middle.y - tipEl.offsetHeight / 2;
    tipEl.style.left = clampTipLeft(left, tipWidth) + 'px';
    tipEl.style.top = top + 'px';
  }

  function placePointer() {
    placeFrame = null;
    const arrow = isActive ? measureArrow() : null;
    pointerEl.classList.toggle('is-shown', arrow !== null);
    if (arrow === null) return;
    drawArrow(arrow);
    placeTip(arrow);
  }

  function schedulePlace() {
    if (!isActive || placeFrame !== null) return;
    placeFrame = requestAnimationFrame(placePointer);
  }

  function showSamplePointer() {
    isActive = true;
    tipEl.textContent = isTouchPrimary() ? TIP_TOUCH : TIP_POINTER;
    schedulePlace();
  }

  function hideSamplePointer() {
    isActive = false;
    pointerEl.classList.remove('is-shown');
  }

  // Panel drags, tab switches and the word's own text arriving all change a
  // size somewhere, so watching sizes covers them without hooking each one.
  const resizeObserver = new ResizeObserver(schedulePlace);
  for (const el of [lyricsAreaEl, panelEl, panelWordEl]) resizeObserver.observe(el);
  window.addEventListener('resize', schedulePlace);
  lyricsAreaEl.addEventListener('scroll', schedulePlace, { passive: true });
  document.fonts.ready.then(schedulePlace);

  window.showSamplePointer = showSamplePointer;
  window.hideSamplePointer = hideSamplePointer;
})();
