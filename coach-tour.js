// A first-visit tour over the sample verse: the page dims, one part at a time
// is lit, and a card beside it says what that part does. storage.js starts it
// when the sample shows; once finished or skipped it stays gone in this
// browser.
(function defineCoachTour() {
  'use strict';

  const SEEN_KEY = 'tour_seen';
  // Lets the sample and its rhymes settle first, so nothing moves under the
  // light as the tour opens.
  const START_DELAY_MS = 600;
  // Room left around a lit part, and between it and the card.
  const SPOT_PADDING_PX = 6;
  const CARD_GAP_PX = 12;
  // Matches the page's side gutter, so the card never touches the screen edge.
  const EDGE_PX = 16;
  const OPENING_CLASS = 'is-opening';
  const OPEN_CLASS = 'is-open';
  const CLOSING_CLASS = 'is-closing';
  const NEW_STEP_CLASS = 'is-new-step';
  const NEXT_LABEL = 'Next';
  const LAST_LABEL = 'Got it';

  // `click` is swapped for "Tap" on touch screens. A target matching several
  // elements lights them all as one. A step whose part is hidden is passed
  // over. The gutters slide open after load, so they are judged by their
  // switch (`shownWhen`) rather than a width that may still be zero.
  const STEPS = [
    {
      target: '#lyrics-highlight .lyric-word',
      title: 'Write here',
      text: 'This is your page. The verse is a sample to play with.',
    },
    {
      target: '#syllable-gutter',
      shownWhen: '#syllable-gutter.visible',
      title: 'Syllables',
      text: 'The number beside each line is how many syllables it has.',
    },
    {
      // The letters are drawn beside each line's end, outside the gutter's
      // own box.
      target: '#rhyme-scheme-gutter .scheme-line',
      shownWhen: '#rhyme-scheme-gutter.visible',
      title: 'Rhyme scheme',
      text: 'Lines that rhyme share a letter. This verse goes A B A B.',
    },
    {
      target: '#rhymes-panel',
      phoneTarget: '.mobile-tab[data-tab="rhymes"]',
      title: 'Rhymes',
      text: '{click} any word in your lyrics to see what rhymes with it. ' +
        '{click} a rhyme to swap it in.',
    },
    {
      target: '#rhymes-panel',
      phoneTarget: '.mobile-tab[data-tab="rhymes"]',
      title: 'The next line',
      text: 'On a new line, the rhymes are for the end of the line above. ' +
        '{click} one to add it to your line.',
    },
    {
      target: '#sample-clear',
      title: 'Your turn',
      text: 'When you are ready, clear the sample and write your own.',
    },
  ];

  const tourEl = document.getElementById('coach-tour');
  if (!tourEl) return;
  const spotEl = tourEl.querySelector('.coach-spot');
  const cardEl = tourEl.querySelector('.coach-card');
  const titleEl = document.getElementById('coach-title');
  const textEl = document.getElementById('coach-text');
  const countEl = tourEl.querySelector('.coach-count');
  const backBtn = document.getElementById('coach-back');
  const nextBtn = document.getElementById('coach-next');
  const skipBtn = document.getElementById('coach-skip');
  let steps = [];
  let stepIndex = 0;
  let placeFrame = null;

  // Storage that throws can't remember the tour, and one that comes back on
  // every visit is worse than none, so it counts as seen.
  function isSeen() {
    try {
      return localStorage.getItem(SEEN_KEY) !== null;
    } catch {
      return true;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Nothing to keep it in; the tour just ends for this visit.
    }
  }

  function isTouchPrimary() {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  function isVisibleRect(rect) {
    return rect.width > 0 && rect.height > 0;
  }

  function unionRect(rects) {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function rectOf(selector) {
    const rects = [...document.querySelectorAll(selector)]
      .map((el) => el.getBoundingClientRect())
      .filter(isVisibleRect);
    return rects.length > 0 ? unionRect(rects) : null;
  }

  // The phone target is used only when it is on screen, which is how the
  // tabbed layout is told apart from the side-by-side one.
  function targetRect(step) {
    const phoneRect = step.phoneTarget ? rectOf(step.phoneTarget) : null;
    return phoneRect || rectOf(step.target);
  }

  function hasVisibleTarget(step) {
    if (step.shownWhen) return document.querySelector(step.shownWhen) !== null;
    return targetRect(step) !== null;
  }

  function wordForClick(text) {
    const verb = isTouchPrimary() ? 'Tap' : 'Click';
    return text.replace(/\{click\}/g, verb);
  }

  function lightRect(rect) {
    spotEl.style.left = rect.left - SPOT_PADDING_PX + 'px';
    spotEl.style.top = rect.top - SPOT_PADDING_PX + 'px';
    spotEl.style.width = rect.width + SPOT_PADDING_PX * 2 + 'px';
    spotEl.style.height = rect.height + SPOT_PADDING_PX * 2 + 'px';
  }

  // Each side is tried in turn; a part that fills the screen, like the
  // editor on a phone, gets the card over its foot instead.
  function cardSpots(rect, card) {
    const gap = SPOT_PADDING_PX + CARD_GAP_PX;
    return [
      { left: rect.left, top: rect.bottom + gap },
      { left: rect.left, top: rect.top - gap - card.height },
      { left: rect.left - gap - card.width, top: rect.top },
      { left: rect.right + gap, top: rect.top },
    ];
  }

  function fitsOnScreen(spot, card) {
    return spot.left >= EDGE_PX && spot.top >= EDGE_PX &&
      spot.left + card.width <= innerWidth - EDGE_PX &&
      spot.top + card.height <= innerHeight - EDGE_PX;
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(value, high));
  }

  function placeCard(rect) {
    const card = { width: cardEl.offsetWidth, height: cardEl.offsetHeight };
    const fallback = { left: rect.left, top: innerHeight - EDGE_PX - card.height };
    const spot = cardSpots(rect, card).find((each) => fitsOnScreen(each, card)) || fallback;
    cardEl.style.left = clamp(spot.left, EDGE_PX, innerWidth - EDGE_PX - card.width) + 'px';
    cardEl.style.top = clamp(spot.top, EDGE_PX, innerHeight - EDGE_PX - card.height) + 'px';
  }

  function placeStep() {
    placeFrame = null;
    if (tourEl.hidden) return;
    const rect = targetRect(steps[stepIndex]);
    if (rect) {
      lightRect(rect);
      placeCard(rect);
    }
    placeFrame = requestAnimationFrame(placeStep);
  }

  // Lit parts move under the tour as gutters slide open, fonts load and the
  // window resizes, so the light follows them every frame while it is open.
  // A new step is placed at once rather than on the next frame, which a
  // background tab may hold back.
  function followTarget() {
    cancelAnimationFrame(placeFrame);
    placeStep();
  }

  function showStep(index) {
    stepIndex = index;
    const step = steps[index];
    const isLast = index === steps.length - 1;
    titleEl.textContent = step.title;
    textEl.textContent = wordForClick(step.text);
    countEl.textContent = index + 1 + ' of ' + steps.length;
    backBtn.hidden = index === 0;
    nextBtn.textContent = isLast ? LAST_LABEL : NEXT_LABEL;
    replayWordsIn();
    followTarget();
    nextBtn.focus();
  }

  // An animation only plays again once its class has been off for a layout.
  function replayWordsIn() {
    cardEl.classList.remove(NEW_STEP_CLASS);
    void cardEl.offsetWidth;
    cardEl.classList.add(NEW_STEP_CLASS);
  }

  function isMotionReduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function hideTour() {
    tourEl.hidden = true;
    tourEl.classList.remove(OPEN_CLASS, CLOSING_CLASS);
  }

  // The card's own animations bubble up here too; only the fade ends it.
  function hideAfterFade(event) {
    if (event.target !== tourEl) return;
    tourEl.removeEventListener('animationend', hideAfterFade);
    hideTour();
  }

  // The tour fades out rather than vanishing; with motion reduced there is
  // no fade, and so no animationend to wait for.
  function endTour(trigger) {
    if (tourEl.classList.contains(CLOSING_CLASS)) return;
    markSeen();
    document.removeEventListener('keydown', handleTourKey);
    trackEvent('tour_ended', { trigger, step: stepIndex + 1, steps: steps.length });
    if (isMotionReduced()) {
      hideTour();
      return;
    }
    tourEl.classList.add(CLOSING_CLASS);
    tourEl.addEventListener('animationend', hideAfterFade);
  }

  function goNext() {
    if (stepIndex === steps.length - 1) {
      endTour('finished');
      return;
    }
    showStep(stepIndex + 1);
  }

  function goBack() {
    if (stepIndex > 0) showStep(stepIndex - 1);
  }

  function handleTourKey(event) {
    if (event.key === 'Escape') endTour('skipped');
    else if (event.key === 'ArrowRight') goNext();
    else if (event.key === 'ArrowLeft') goBack();
  }

  function openTour() {
    steps = STEPS.filter(hasVisibleTarget);
    if (steps.length === 0) return;
    tourEl.classList.add(OPENING_CLASS, OPEN_CLASS);
    tourEl.hidden = false;
    document.addEventListener('keydown', handleTourKey);
    trackEvent('tour_started', { steps: steps.length });
    showStep(0);
    // Laid out once without glides, so the light starts on the first part.
    void tourEl.offsetWidth;
    tourEl.classList.remove(OPENING_CLASS);
  }

  // Returns whether the tour will run, so the caller can hold back its own
  // first-visit hints.
  function startCoachTour() {
    if (isSeen()) return false;
    setTimeout(openTour, START_DELAY_MS);
    return true;
  }

  nextBtn.addEventListener('click', goNext);
  backBtn.addEventListener('click', goBack);
  skipBtn.addEventListener('click', () => endTour('skipped'));

  window.startCoachTour = startCoachTour;
})();
