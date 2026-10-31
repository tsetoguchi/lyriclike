// Firefox cannot round or restyle its scrollbar, so there the native bar is
// hidden and this draws a pill in its place, over the right edge of each
// scroller. Browsers that style ::-webkit-scrollbar keep the CSS-only version.
import { SCROLLER_SELECTOR, IDLE_MS } from './scroll-reveal.js';

const SHOWN_CLASS = 'is-shown';
const DRAGGING_CLASS = 'is-dragging';
const MIN_THUMB_PX = 28;

function supportsWebkitScrollbar() {
  return CSS.supports('selector(::-webkit-scrollbar)');
}

function createPill() {
  const track = document.createElement('div');
  track.className = 'pill-scrollbar';
  track.setAttribute('aria-hidden', 'true');
  track.hidden = true;
  const thumb = document.createElement('div');
  thumb.className = 'pill-scrollbar-thumb';
  track.appendChild(thumb);
  document.body.appendChild(track);
  return { track, thumb };
}

function trackInnerHeight(track) {
  const style = getComputedStyle(track);
  return track.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
}

function isScrollable(scroller) {
  const box = scroller.getBoundingClientRect();
  const isOnScreen = box.width > 0 && box.right > 0 && box.left < innerWidth;
  return isOnScreen && scroller.scrollHeight > scroller.clientHeight + 1;
}

function placeTrack(scroller, track) {
  const box = scroller.getBoundingClientRect();
  track.style.top = `${box.top}px`;
  track.style.height = `${box.height}px`;
  track.style.right = `${document.documentElement.clientWidth - box.right}px`;
}

function placeThumb(scroller, pill) {
  const inner = trackInnerHeight(pill.track);
  const thumbHeight = Math.max(
    MIN_THUMB_PX, inner * scroller.clientHeight / scroller.scrollHeight);
  const scrollRange = scroller.scrollHeight - scroller.clientHeight;
  const travel = inner - thumbHeight;
  pill.thumb.style.height = `${thumbHeight}px`;
  pill.thumb.style.transform = `translateY(${travel * scroller.scrollTop / scrollRange}px)`;
}

function layoutPill(scroller, pill) {
  pill.track.hidden = !isScrollable(scroller);
  if (pill.track.hidden) return;
  placeTrack(scroller, pill.track);
  placeThumb(scroller, pill);
}

function startDrag(event, scroller, pill, state) {
  event.preventDefault();
  const startY = event.clientY;
  const startScroll = scroller.scrollTop;
  const scrollRange = scroller.scrollHeight - scroller.clientHeight;
  const travel = trackInnerHeight(pill.track) - pill.thumb.offsetHeight;
  state.isDragging = true;
  pill.thumb.classList.add(DRAGGING_CLASS);
  pill.thumb.setPointerCapture(event.pointerId);

  function onMove(moveEvent) {
    scroller.scrollTop = startScroll + (moveEvent.clientY - startY) * scrollRange / travel;
  }

  function onUp() {
    state.isDragging = false;
    pill.thumb.classList.remove(DRAGGING_CLASS);
    pill.thumb.removeEventListener('pointermove', onMove);
    pill.thumb.removeEventListener('pointerup', onUp);
    state.refresh();
  }

  pill.thumb.addEventListener('pointermove', onMove);
  pill.thumb.addEventListener('pointerup', onUp);
}

function trackVisibility(scroller, pill) {
  const state = { isHovered: false, isScrolling: false, isDragging: false };
  let idleTimer = 0;

  state.refresh = () => {
    const isShown = state.isHovered || state.isScrolling || state.isDragging;
    pill.thumb.classList.toggle(SHOWN_CLASS, isShown);
  };

  function setHovered(isHovered) {
    state.isHovered = isHovered;
    state.refresh();
  }

  function onScroll() {
    state.isScrolling = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      state.isScrolling = false;
      state.refresh();
    }, IDLE_MS);
    state.refresh();
  }

  scroller.addEventListener('pointerenter', () => setHovered(true));
  scroller.addEventListener('pointerleave', () => setHovered(false));
  pill.thumb.addEventListener('pointerenter', () => setHovered(true));
  pill.thumb.addEventListener('pointerleave', () => setHovered(false));
  scroller.addEventListener('scroll', onScroll);
  return state;
}

function watchLayout(scroller, relayout) {
  new ResizeObserver(relayout).observe(scroller);
  new MutationObserver(relayout).observe(scroller, { childList: true, subtree: true });
  scroller.addEventListener('scroll', relayout);
}

function installPill(scroller) {
  const pill = createPill();
  const relayout = () => layoutPill(scroller, pill);
  const state = trackVisibility(scroller, pill);
  scroller.style.scrollbarWidth = 'none';
  pill.thumb.addEventListener('pointerdown', (event) => startDrag(event, scroller, pill, state));
  watchLayout(scroller, relayout);
  return relayout;
}

function installAllPills() {
  const relayouts = [...document.querySelectorAll(SCROLLER_SELECTOR)].map(installPill);
  let isQueued = false;
  function relayoutAll() {
    if (isQueued) return;
    isQueued = true;
    requestAnimationFrame(() => {
      isQueued = false;
      relayouts.forEach((relayout) => relayout());
    });
  }
  window.addEventListener('resize', relayoutAll);
  // Panels slide and fold with transitions that move a scroller without
  // resizing it, so the pill follows whenever any transition ends.
  document.addEventListener('transitionend', relayoutAll, true);
  relayoutAll();
}

if (!supportsWebkitScrollbar()) installAllPills();
