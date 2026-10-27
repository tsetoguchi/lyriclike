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
  // Room left around a lit part, and between it and the card. Wide enough
  // that the light's feathered edge falls on the margin, not the part.
  const SPOT_PADDING_PX = 12;
  const CARD_GAP_PX = 12;
  // Matches the page's side gutter, so the card never touches the screen edge.
  const EDGE_PX = 16;
  const OPENING_CLASS = 'is-opening';
  const OPEN_CLASS = 'is-open';
  const CLOSING_CLASS = 'is-closing';
  const NEW_STEP_CLASS = 'is-new-step';
  const LIVE_CLASS = 'is-live';
  const DASH_CLASS = 'coach-dash';
  const DASH_DONE_CLASS = 'is-done';
  const NEXT_LABEL = 'Next';
  const LAST_LABEL = 'Got it';

  // `{Click}` and `{click}` become "Tap" and "tap" on touch screens. A target
  // matching several elements lights them all as one. A `live` part takes
  // clicks, so what the card offers can be tried; its phone stand-in, a tab
  // that would switch the view under the tour, never does. A step whose part
  // is hidden is passed over. The gutters slide open after load, so they are
  // judged by their switch (`shownWhen`) rather than a width that may still be
  // zero.
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
      live: true,
      title: 'Rhymes',
      text: 'Rhymes for the word you picked show here. {Click} one to swap ' +
        'it into your line, or {click} another word in your lyrics.',
    },
    {
      target: '#rhymes-panel',
      phoneTarget: '.mobile-tab[data-tab="rhymes"]',
      title: 'The next line',
      text: 'When you start a new line, the rhymes switch to the last word ' +
        'of the line above, and the one you pick is added to your line.',
    },
    {
      target: '#sample-clear',
      live: true,
      title: 'Your turn',
      text: 'When you are ready, clear the sample and write your own.',
    },
  ];

  const tourEl = document.getElementById('coach-tour');
  if (!tourEl) return;
  const spotEl = tourEl.querySelector('.coach-spot');
  const blockEls = tourEl.querySelectorAll('.coach-block');
  const dashesEl = tourEl.querySelector('.coach-steps');
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
    return phoneRectOf(step) || rectOf(step.target);
  }

  function phoneRectOf(step) {
    return step.phoneTarget ? rectOf(step.phoneTarget) : null;
  }

  function isLive(step) {
    return Boolean(step.live) && phoneRectOf(step) === null;
  }

  function hasVisibleTarget(step) {
    if (step.shownWhen) return document.querySelector(step.shownWhen) !== null;
    return targetRect(step) !== null;
  }

  function wordForClick(text) {
    const verb = isTouchPrimary() ? 'tap' : 'click';
    const capitalVerb = verb.charAt(0).toUpperCase() + verb.slice(1);
    return text.replace(/\{Click\}/g, capitalVerb).replace(/\{click\}/g, verb);
  }

  function setBox(el, left, top, width, height) {
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = Math.max(0, width) + 'px';
    el.style.height = Math.max(0, height) + 'px';
  }

  // The four blocks frame the light: above, below, left and right of it.
  function lightRect(rect) {
    const left = rect.left - SPOT_PADDING_PX;
    const top = rect.top - SPOT_PADDING_PX;
    const right = rect.right + SPOT_PADDING_PX;
    const bottom = rect.bottom + SPOT_PADDING_PX;
    setBox(spotEl, left, top, right - left, bottom - top);
    setBox(blockEls[0], 0, 0, innerWidth, top);
    setBox(blockEls[1], 0, bottom, innerWidth, innerHeight - bottom);
    setBox(blockEls[2], 0, top, left, bottom - top);
    setBox(blockEls[3], right, top, innerWidth - right, bottom - top);
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
    const maxLeft = innerWidth - EDGE_PX - card.width;
    const maxTop = innerHeight - EDGE_PX - card.height;
    const fallback = { left: rect.left, top: maxTop };
    const fitting = cardSpots(rect, card).find((each) => fitsOnScreen(each, card));
    const spot = fitting || fallback;
    cardEl.style.left = clamp(spot.left, EDGE_PX, maxLeft) + 'px';
    cardEl.style.top = clamp(spot.top, EDGE_PX, maxTop) + 'px';
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
    countEl.textContent = 'Step ' + (index + 1) + ' of ' + steps.length;
    backBtn.hidden = index === 0;
    nextBtn.textContent = isLast ? LAST_LABEL : NEXT_LABEL;
    spotEl.classList.toggle(LIVE_CLASS, isLive(step));
    markDashes(index);
    replayWordsIn();
    followTarget();
    // The card, not Next, so no focus ring lands on a button nobody tabbed to.
    cardEl.focus();
  }

  function drawDashes() {
    dashesEl.replaceChildren(...steps.map(() => {
      const dash = document.createElement('span');
      dash.className = DASH_CLASS;
      return dash;
    }));
  }

  function markDashes(index) {
    [...dashesEl.children].forEach((dash, dashIndex) => {
      dash.classList.toggle(DASH_DONE_CLASS, dashIndex <= index);
    });
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

  // Trying a rhyme on the sample makes it the writer's own, which takes the
  // "Start your own" button away, so the steps are counted again each move.
  function refreshSteps() {
    const current = steps[stepIndex];
    steps = STEPS.filter((step) => step === current || hasVisibleTarget(step));
    stepIndex = steps.indexOf(current);
    drawDashes();
  }

  function goNext() {
    refreshSteps();
    if (stepIndex === steps.length - 1) {
      endTour('finished');
      return;
    }
    showStep(stepIndex + 1);
  }

  function goBack() {
    refreshSteps();
    if (stepIndex > 0) showStep(stepIndex - 1);
  }

  // Arrows inside the lyrics move the caret there, not the tour.
  function handleTourKey(event) {
    if (event.key === 'Escape') endTour('skipped');
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowRight') goNext();
    else if (event.key === 'ArrowLeft') goBack();
  }

  function openTour() {
    steps = STEPS.filter(hasVisibleTarget);
    if (steps.length === 0) return;
    drawDashes();
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
  // Pressing the lit "Start your own" does what the last card asks.
  document.addEventListener('click', (event) => {
    if (tourEl.hidden || !(event.target instanceof Element)) return;
    if (event.target.closest('#sample-clear')) endTour('finished');
  });

  window.startCoachTour = startCoachTour;
})();
