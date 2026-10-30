// A first-visit tour: the page dims, one part at a time is lit, and a card
// beside it says what that part does. storage.js starts the sample tour when
// the sample verse shows, or the word tour for someone arriving from a rhyme
// page with one word's rhymes open. Once either is finished or skipped,
// neither comes back in this browser.
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

  // `{Click}` and `{click}` become "Tap" and "tap" on touch screens, and
  // `{word}` the word a rhyme page linked to. A target
  // matching several elements lights them all as one. A `live` part takes
  // clicks, so what the card offers can be tried; its phone stand-in, a tab
  // that would switch the view under the tour, never does. A step whose part
  // is hidden is passed over. The gutters slide open after load, so they are
  // judged by their switch (`shownWhen`) rather than a width that may still be
  // zero.
  const SWITCHES_STEP = {
    // On a phone the switches live in the bottom bar: Syllables, and the
    // rhyme letters inside Highlights.
    target: '#syllable-toggle, #rhyme-scheme-toggle',
    phoneTarget: '#bottom-nav #syllable-toggle, #bottom-nav #rhymes-menu-btn',
    live: true,
    title: 'Show or hide them',
    text: '{Click} these to turn the syllable counts and the rhyme letters ' +
      'on and off.',
    phoneText: 'Tap Syllables to turn the counts on and off. The rhyme ' +
      'letters are under Highlights.',
  };

  const SYLLABLES_STEP = {
    target: '#syllable-gutter',
    shownWhen: '#syllable-gutter.visible',
    title: 'Syllables',
    text: 'The number beside each line is how many syllables it has.',
  };

  // The letters are drawn beside each line's end, outside the gutter's own
  // box.
  const SCHEME_STEP = {
    target: '#rhyme-scheme-gutter .scheme-line',
    shownWhen: '#rhyme-scheme-gutter.visible',
    title: 'Rhyme scheme',
    text: 'Lines that rhyme share a letter, so A A B B is two rhyming pairs.',
  };

  const RHYMES_STEP = {
    target: '#rhymes-panel',
    phoneTarget: '.mobile-tab[data-tab="rhymes"]',
    live: true,
    title: 'Rhymes',
    text: '{Click} a word in your lyrics and its rhymes show here. {Click} ' +
      'a rhyme to swap it into your line.',
    phoneText: 'Your rhymes are on this tab. Tap one there to swap it into ' +
      'your line.',
  };

  const NEXT_LINE_STEP = {
    target: '#rhymes-panel',
    phoneTarget: '.mobile-tab[data-tab="rhymes"]',
    title: 'The next line',
    text: 'When you start a new line, the rhymes switch to the last word of ' +
      'the line above, and the one you pick is added to your line.',
  };

  const SAMPLE_STEPS = [
    {
      target: '#lyrics-highlight .lyric-word',
      title: 'Write here',
      text: 'This is your page. The verse is a sample to play with.',
    },
    SYLLABLES_STEP,
    { ...SCHEME_STEP, text: 'Lines that rhyme share a letter. This verse goes A B A B.' },
    SWITCHES_STEP,
    {
      ...RHYMES_STEP,
      text: 'Rhymes for the picked word show here. {Click} one to swap it ' +
        'into your line.',
    },
    NEXT_LINE_STEP,
    {
      target: '#sample-clear',
      live: true,
      title: 'Your turn',
      text: 'When you are ready, clear the sample and write your own.',
    },
  ];

  // The pad is blank, so the rhymes they came for lead. A chip pressed with
  // nothing written opens its meaning in a dialog the dark would cover, so
  // the panel is lit but not live.
  const WORD_STEPS = [
    {
      target: '#rhymes-panel',
      phoneTarget: '.mobile-tab[data-tab="rhymes"]',
      title: 'Rhymes for "{word}"',
      text: 'Everything here rhymes with "{word}", the closest first. Near ' +
        'rhymes and other kinds are further down.',
      phoneText: 'Your rhymes for "{word}" are on this tab, the closest first.',
    },
    {
      target: '#lyrics',
      live: true,
      title: 'Write here',
      text: 'Type your lyrics here. {Click} any word you write to see what ' +
        'rhymes with it.',
    },
    SWITCHES_STEP,
  ];

  // Replayed from the sidebar over the writer's own page, so nothing here
  // speaks of a sample.
  const PAGE_STEPS = [
    {
      target: '#lyrics',
      title: 'Write here',
      text: 'This is your page. Type your lyrics here, one line at a time.',
    },
    SYLLABLES_STEP,
    SCHEME_STEP,
    SWITCHES_STEP,
    RHYMES_STEP,
    NEXT_LINE_STEP,
  ];

  const TOURS = { sample: SAMPLE_STEPS, word: WORD_STEPS, page: PAGE_STEPS };

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
  let tourName = '';
  let tourWord = '';
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

  function textFor(step) {
    return step.phoneText && phoneRectOf(step) !== null ? step.phoneText : step.text;
  }

  function isLive(step) {
    return Boolean(step.live) && phoneRectOf(step) === null;
  }

  function hasVisibleTarget(step) {
    if (step.shownWhen) return document.querySelector(step.shownWhen) !== null;
    return targetRect(step) !== null;
  }

  function fillWords(text) {
    const verb = isTouchPrimary() ? 'tap' : 'click';
    const capitalVerb = verb.charAt(0).toUpperCase() + verb.slice(1);
    return text.replace(/\{Click\}/g, capitalVerb)
      .replace(/\{click\}/g, verb)
      .replace(/\{word\}/g, tourWord);
  }

  function setBox(el, left, top, width, height) {
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = Math.max(0, width) + 'px';
    el.style.height = Math.max(0, height) + 'px';
  }

  // The light and the card move by `translate`, which the compositor glides
  // without laying the page out again each frame. It is its own property, so
  // the card's opening grow (a `transform`) does not fight it.
  function moveTo(el, left, top) {
    el.style.translate = left + 'px ' + top + 'px';
  }

  // The four blocks frame the light: above, below, left and right of it.
  function lightRect(rect) {
    const left = rect.left - SPOT_PADDING_PX;
    const top = rect.top - SPOT_PADDING_PX;
    const right = rect.right + SPOT_PADDING_PX;
    const bottom = rect.bottom + SPOT_PADDING_PX;
    moveTo(spotEl, left, top);
    spotEl.style.width = right - left + 'px';
    spotEl.style.height = bottom - top + 'px';
    setBox(blockEls[0], 0, 0, innerWidth, top);
    setBox(blockEls[1], 0, bottom, innerWidth, innerHeight - bottom);
    setBox(blockEls[2], 0, top, left, bottom - top);
    setBox(blockEls[3], right, top, innerWidth - right, bottom - top);
  }

  // Below, above, left, then right of the part. Above or below, the card may
  // slide sideways to stay on screen, so a part at the screen's edge, like
  // the phone's bottom bar, still gets it above.
  function cardSpots(rect, card) {
    const gap = SPOT_PADDING_PX + CARD_GAP_PX;
    const slidLeft = clamp(rect.left, EDGE_PX, innerWidth - EDGE_PX - card.width);
    return [
      { left: slidLeft, top: rect.bottom + gap },
      { left: slidLeft, top: rect.top - gap - card.height },
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
    moveTo(cardEl, clamp(spot.left, EDGE_PX, maxLeft), clamp(spot.top, EDGE_PX, maxTop));
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
    const isLast = index === steps.length - 1;
    titleEl.textContent = fillWords(steps[index].title);
    countEl.textContent = 'Step ' + (index + 1) + ' of ' + steps.length;
    backBtn.hidden = index === 0;
    nextBtn.textContent = isLast ? LAST_LABEL : NEXT_LABEL;
    fitStepToLayout();
    markDashes(index);
    replayWordsIn();
    followTarget();
    // The card, not Next, so no focus ring lands on a button nobody tabbed to.
    cardEl.focus();
  }

  // The wording and what can be clicked depend on the layout, so they are
  // set again when the window crosses into the phone layout or out of it.
  function fitStepToLayout() {
    const step = steps[stepIndex];
    textEl.textContent = fillWords(textFor(step));
    spotEl.classList.toggle(LIVE_CLASS, isLive(step));
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
    trackEvent('tour_ended', {
      tour: tourName, trigger, step: stepIndex + 1, steps: steps.length,
    });
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
    steps = TOURS[tourName].filter((step) => step === current || hasVisibleTarget(step));
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

  // Tab goes round the card's buttons only: the page behind is in the dark
  // and takes no clicks, so its buttons should take no keys either.
  function keepFocusInCard(event) {
    const buttons = [...cardEl.querySelectorAll('button')].filter((btn) => !btn.hidden);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const isLeaving = !cardEl.contains(document.activeElement) ||
      document.activeElement === (event.shiftKey ? first : last) ||
      document.activeElement === cardEl;
    if (!isLeaving) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }

  // Arrows inside the lyrics move the caret there, not the tour.
  function handleTourKey(event) {
    if (event.key === 'Escape') endTour('skipped');
    if (event.key === 'Tab') keepFocusInCard(event);
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowRight') goNext();
    else if (event.key === 'ArrowLeft') goBack();
  }

  function openTour() {
    steps = TOURS[tourName].filter(hasVisibleTarget);
    if (steps.length === 0) return;
    // Seen once it opens, not once it ends: signing up mid-tour reloads the
    // page, and the tour started over for the new account.
    markSeen();
    drawDashes();
    tourEl.classList.add(OPENING_CLASS, OPEN_CLASS);
    tourEl.hidden = false;
    document.addEventListener('keydown', handleTourKey);
    trackEvent('tour_started', { tour: tourName, steps: steps.length });
    showStep(0);
    // Laid out once without glides, so the light starts on the first part.
    void tourEl.offsetWidth;
    tourEl.classList.remove(OPENING_CLASS);
  }

  function chooseTour(name, word) {
    tourName = name;
    tourWord = word || '';
  }

  // `name` is a key of TOURS; `word` fills the word tour's cards. Returns
  // whether the tour will run, so the caller can hold back its own
  // first-visit hints.
  function startCoachTour(name, word) {
    if (isSeen() || !TOURS[name]) return false;
    chooseTour(name, word);
    setTimeout(openTourUnlessHeld, START_DELAY_MS);
    return true;
  }

  // A window already open (sign-up from a shared page), or one on its way
  // (window.isTourHeld, set by an invite link), asked first, so the tour
  // waits for a later visit rather than cover it.
  function openTourUnlessHeld() {
    if (window.isTourHeld === true || document.querySelector('.modal-overlay.open')) return;
    openTour();
  }

  // Asked for from the sidebar, so it runs at once, seen before or not.
  function replayCoachTour(name) {
    if (!TOURS[name] || !tourEl.hidden) return;
    chooseTour(name, '');
    openTour();
  }

  nextBtn.addEventListener('click', goNext);
  backBtn.addEventListener('click', goBack);
  skipBtn.addEventListener('click', () => endTour('skipped'));
  window.addEventListener('resize', () => {
    if (!tourEl.hidden) fitStepToLayout();
  });
  // Pressing the lit "Start your own" does what the last card asks.
  document.addEventListener('click', (event) => {
    if (tourEl.hidden || !(event.target instanceof Element)) return;
    if (event.target.closest('#sample-clear')) endTour('finished');
  });

  window.startCoachTour = startCoachTour;
  window.replayCoachTour = replayCoachTour;
})();
