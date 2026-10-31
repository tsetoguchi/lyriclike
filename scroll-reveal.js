// The scrollbars stay invisible until a scroller moves. This adds
// .is-scrolling while the content moves (wheel, touch, keys, dragging the bar,
// or the editor following the caret) and drops it a moment after it stops, so
// the bar fades out instead of vanishing mid-read.
const SCROLLER_SELECTOR =
  '.lyrics-area, .page-preview, #lyrics-list-items, #rhyme-results';
const SCROLLING_CLASS = 'is-scrolling';
const IDLE_MS = 700;

const idleTimers = new WeakMap();

function markScrolling(scroller) {
  scroller.classList.add(SCROLLING_CLASS);
  clearTimeout(idleTimers.get(scroller));
  const timer = setTimeout(() => scroller.classList.remove(SCROLLING_CLASS), IDLE_MS);
  idleTimers.set(scroller, timer);
}

// Scroll events do not bubble, so one capturing listener covers scrollers that
// are created later too.
document.addEventListener('scroll', (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !target.matches(SCROLLER_SELECTOR)) return;
  markScrolling(target);
}, true);
