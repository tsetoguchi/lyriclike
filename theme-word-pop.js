// In the Aero theme, picking a word in the lyrics blows a soap bubble over
// it that wobbles and pops into drops. app.js sends the pick event; this
// only draws. The bubble is fixed to the window and removed once it pops.
const RHYMES_PICKED_EVENT = 'rhymes-picked';
const AERO_THEME = 'aero';
const PICKED_WORD_SELECTOR = '#lyrics-highlight .highlight-word';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const POP_CLASS = 'aero-word-pop';
const BUBBLE_CLASSES = ['aero-soap', 'aero-word-pop-bubble'];
const DROP_CLASS = 'aero-word-drop';
const DROP_COUNT = 8;
// The bubble is a little wider than the word, so it reads as around it.
const BUBBLE_MARGIN_PX = 14;
const FULL_TURN_DEGREES = 360;

function canPop() {
  return window.appTheme.current() === AERO_THEME
    && !window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function buildDrop(index) {
  const drop = document.createElement('span');
  drop.className = DROP_CLASS;
  drop.style.setProperty('--drop-angle', `${(index / DROP_COUNT) * FULL_TURN_DEGREES}deg`);
  return drop;
}

function buildPop(rect) {
  const size = Math.max(rect.width, rect.height) + BUBBLE_MARGIN_PX;
  const pop = document.createElement('span');
  pop.className = POP_CLASS;
  pop.setAttribute('aria-hidden', 'true');
  pop.style.setProperty('--pop-x', `${rect.left + rect.width / 2}px`);
  pop.style.setProperty('--pop-y', `${rect.top + rect.height / 2}px`);
  pop.style.setProperty('--pop-size', `${size}px`);
  const bubble = document.createElement('span');
  bubble.classList.add(...BUBBLE_CLASSES);
  pop.append(bubble);
  for (let index = 0; index < DROP_COUNT; index++) pop.append(buildDrop(index));
  return pop;
}

// Removed when the last drop lands, which ends after the bubble itself.
function removeWhenDone(pop) {
  const lastDrop = pop.lastElementChild;
  lastDrop.addEventListener('animationend', () => pop.remove(), { once: true });
}

function popOverPickedWord() {
  const word = document.querySelector(PICKED_WORD_SELECTOR);
  if (!word) return;
  const pop = buildPop(word.getBoundingClientRect());
  document.body.append(pop);
  removeWhenDone(pop);
}

// The pick marks the word in the same turn it sends the event, so the
// bubble waits a frame for the mark to be on the page.
document.addEventListener(RHYMES_PICKED_EVENT, () => {
  if (canPop()) requestAnimationFrame(popOverPickedWord);
});
