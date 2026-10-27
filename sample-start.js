// Places the amber buttons that sit under the verse: the sample's "Start your
// own" and the save nudge's "Keep this page". The editor stretches to the foot
// of the pad, so a button cannot just follow the text in the page flow; it is
// set to the verse's last line instead. storage.js and save-nudge.js decide
// when they show; this file only places them.
(function defineSampleStart() {
  'use strict';

  // Room between the verse's last line and the button. sample-pointer.js
  // uses the same room to put its phone tip under the button.
  const GAP_BELOW_VERSE_PX = 24;

  const buttonEls = [
    document.getElementById('sample-clear'),
    document.getElementById('save-keep'),
  ];
  const lyricsAreaEl = document.querySelector('.lyrics-area');
  let placeFrame = null;

  function lastWordRect() {
    const words = document.querySelectorAll('#lyrics-highlight .lyric-word');
    return words.length > 0 ? words[words.length - 1].getBoundingClientRect() : null;
  }

  function shownButtons() {
    return buttonEls.filter((buttonEl) => !buttonEl.hidden);
  }

  // The buttons scroll with the text, so their top is measured in the
  // scroller's content, not the viewport.
  function placeSampleStart() {
    placeFrame = null;
    const lastRect = lastWordRect();
    if (lastRect === null) return;
    const areaTop = lyricsAreaEl.getBoundingClientRect().top;
    const top = lastRect.bottom - areaTop + lyricsAreaEl.scrollTop + GAP_BELOW_VERSE_PX;
    shownButtons().forEach((buttonEl) => { buttonEl.style.top = top + 'px'; });
  }

  function schedulePlace() {
    if (shownButtons().length === 0 || placeFrame !== null) return;
    placeFrame = requestAnimationFrame(placeSampleStart);
  }

  // Watching the hidden attribute places a button the moment it shows; size
  // changes cover wrapping lines and panel drags. The save button follows the
  // writer's own lines, so typing moves it too.
  buttonEls.forEach((buttonEl) => {
    new MutationObserver(schedulePlace).observe(buttonEl, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  });
  document.getElementById('lyrics').addEventListener('input', schedulePlace);
  new ResizeObserver(schedulePlace).observe(lyricsAreaEl);
  window.addEventListener('resize', schedulePlace);
  document.fonts.ready.then(schedulePlace);
})();
