// Places the sample's "Start your own" button under the verse. The editor
// stretches to the foot of the pad, so the button cannot just follow the text
// in the page flow; it is set to the verse's last line instead. storage.js
// decides when it shows; this file only places it.
(function defineSampleStart() {
  'use strict';

  // Room between the verse's last line and the button.
  const GAP_BELOW_VERSE_PX = 24;

  const buttonEl = document.getElementById('sample-clear');
  const lyricsAreaEl = document.querySelector('.lyrics-area');
  let placeFrame = null;

  function lastWordRect() {
    const words = document.querySelectorAll('#lyrics-highlight .lyric-word');
    return words.length > 0 ? words[words.length - 1].getBoundingClientRect() : null;
  }

  // The button scrolls with the text, so its top is measured in the
  // scroller's content, not the viewport.
  function placeSampleStart() {
    placeFrame = null;
    if (buttonEl.hidden) return;
    const lastRect = lastWordRect();
    if (lastRect === null) return;
    const areaTop = lyricsAreaEl.getBoundingClientRect().top;
    const top = lastRect.bottom - areaTop + lyricsAreaEl.scrollTop + GAP_BELOW_VERSE_PX;
    buttonEl.style.top = top + 'px';
  }

  function schedulePlace() {
    if (buttonEl.hidden || placeFrame !== null) return;
    placeFrame = requestAnimationFrame(placeSampleStart);
  }

  // Watching the hidden attribute places the button the moment storage.js
  // shows it; size changes cover wrapping lines and panel drags.
  new MutationObserver(schedulePlace).observe(buttonEl, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  new ResizeObserver(schedulePlace).observe(lyricsAreaEl);
  window.addEventListener('resize', schedulePlace);
  document.fonts.ready.then(schedulePlace);
})();
