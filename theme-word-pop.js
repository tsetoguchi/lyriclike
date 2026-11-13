// In the Aero theme, picking a word in the lyrics blows a soap bubble over
// it that swells, wobbles and pops into a spray of drops with a flash of
// light. app.js sends the pick event; this only draws. Every number below
// is the same as the pop in the Aero world's screen_pops.js and splashes.js,
// worked out frame by frame and handed to the browser's animation engine.
const RHYMES_PICKED_EVENT = 'rhymes-picked';
const AERO_THEME = 'aero';
const PICKED_WORD_SELECTOR = '#lyrics-highlight .highlight-word';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const POP_CLASS = 'aero-word-pop';
const BUBBLE_CLASSES = ['aero-soap', 'aero-word-pop-bubble'];
const DROP_CLASS = 'aero-word-drop';
const RING_CLASS = 'aero-word-ring';
// The bubble's wobble needs every frame. The drops and the ring follow
// smooth curves, so the browser drawing straight lines between fewer points
// is off by under a tenth of a pixel, and a pick builds far fewer frames.
const WOBBLE_FRAMES_PER_SECOND = 60;
const PATH_FRAMES_PER_SECOND = 20;
const MS_PER_SECOND = 1000;
// The bubble is a little wider than the word, so it reads as around it.
const BUBBLE_MARGIN_PX = 14;

// The bubble: swells from 15% over 0.12 s, wobbles, and is gone at 0.24 s.
const SWELL_SECONDS = 0.12;
const POP_SECONDS = 0.24;
const START_SCALE = 0.15;
const WOBBLE_RATE = 38;
const WOBBLE_SHARE = 0.06;
// The world's bubble is 1.05 across its radius; drop speeds and sizes are
// in those units, so they scale with the bubble on screen.
const WORLD_BUBBLE_RADIUS = 1.05;

// The burst at the pop.
const DROP_COUNT = 26;
const DROP_SPEED = 5;
const DROP_SPEED_RANGE = [0.45, 1.15];
const DROP_SPREAD = 1.3;
const DROP_SIZE = 0.11;
const DROP_SIZE_RANGE = [0.35, 1];
const DROP_LIFE = 0.6;
const DROP_LIFE_RANGE = [0.6, 1];
const DROP_GRAVITY = 0.4 * 9.8;
const RING_RADIUS = 2.4;
const RING_SECONDS = 0.3;
const RING_START_SHARE = 0.2;

function canPop() {
  return window.appTheme.current() === AERO_THEME
    && !window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function between([low, high]) {
  return low + Math.random() * (high - low);
}

function smoothstep(edge, value) {
  const share = Math.min(Math.max(value / edge, 0), 1);
  return share * share * (3 - 2 * share);
}

function frameTimes(seconds, framesPerSecond) {
  const count = Math.ceil(seconds * framesPerSecond);
  return Array.from({ length: count + 1 }, (_, index) => (index / count) * seconds);
}

function bubbleFrameAt(age) {
  const swell = smoothstep(SWELL_SECONDS, age);
  const wobble = 1 + Math.sin(age * WOBBLE_RATE) * WOBBLE_SHARE * swell;
  const radius = START_SCALE + (1 - START_SCALE) * swell;
  return { transform: `scale(${radius * wobble}, ${radius / wobble})` };
}

// No fill: when it ends the bubble drops back to its resting scale of zero,
// so it is there up to the pop and then simply gone, as a bubble is.
function animateBubble(bubble) {
  const frames = frameTimes(POP_SECONDS, WOBBLE_FRAMES_PER_SECOND).map(bubbleFrameAt);
  return bubble.animate(frames, {
    duration: POP_SECONDS * MS_PER_SECOND, easing: 'linear',
  });
}

// A drop flies toward the viewer inside a cone; on the flat screen that is
// out from the centre, faster the more it leans.
function launchDrop(unitPx) {
  const angle = Math.random() * Math.PI * 2;
  const lean = Math.sin(Math.sqrt(Math.random()) * DROP_SPREAD);
  const speed = DROP_SPEED * between(DROP_SPEED_RANGE) * lean * unitPx;
  return {
    velocityX: Math.cos(angle) * speed,
    velocityY: Math.sin(angle) * speed,
    sizePx: DROP_SIZE * between(DROP_SIZE_RANGE) * unitPx * 2,
    life: DROP_LIFE * between(DROP_LIFE_RANGE),
  };
}

function dropFrameAt(flight, unitPx, age) {
  const fall = 0.5 * DROP_GRAVITY * unitPx * age * age;
  const x = flight.velocityX * age;
  const y = flight.velocityY * age + fall;
  const size = 1 - (age / flight.life) ** 2;
  return { transform: `translate(${x}px, ${y}px) scale(${size})`, opacity: 1 };
}

function animateDrop(drop, flight, unitPx) {
  drop.style.setProperty('--drop-size', `${flight.sizePx}px`);
  const frames = frameTimes(flight.life, PATH_FRAMES_PER_SECOND)
    .map((age) => dropFrameAt(flight, unitPx, age));
  return drop.animate(frames, {
    duration: flight.life * MS_PER_SECOND, delay: POP_SECONDS * MS_PER_SECOND,
    easing: 'linear', fill: 'forwards',
  });
}

function ringFrameAt(age) {
  const share = age / RING_SECONDS;
  const scale = RING_START_SHARE + (1 - RING_START_SHARE) * Math.sqrt(share);
  return { transform: `scale(${scale})`, opacity: 1 - share };
}

function animateRing(ring) {
  const frames = frameTimes(RING_SECONDS, PATH_FRAMES_PER_SECOND).map(ringFrameAt);
  return ring.animate(frames, {
    duration: RING_SECONDS * MS_PER_SECOND, delay: POP_SECONDS * MS_PER_SECOND,
    easing: 'linear', fill: 'forwards',
  });
}

function addPart(pop, className) {
  const part = document.createElement('span');
  part.className = className;
  pop.append(part);
  return part;
}

function buildPop(rect, radiusPx) {
  const pop = document.createElement('span');
  pop.className = POP_CLASS;
  pop.setAttribute('aria-hidden', 'true');
  pop.style.setProperty('--pop-x', `${rect.left + rect.width / 2}px`);
  pop.style.setProperty('--pop-y', `${rect.top + rect.height / 2}px`);
  pop.style.setProperty('--pop-size', `${radiusPx * 2}px`);
  pop.style.setProperty('--ring-size', `${(radiusPx * 2 * RING_RADIUS) / WORLD_BUBBLE_RADIUS}px`);
  return pop;
}

// Runs every part and hands back their animations, so the pop can be removed
// once the last one ends.
function animatePop(pop, radiusPx) {
  const unitPx = radiusPx / WORLD_BUBBLE_RADIUS;
  const bubble = addPart(pop, BUBBLE_CLASSES.join(' '));
  const animations = [animateBubble(bubble), animateRing(addPart(pop, RING_CLASS))];
  for (let index = 0; index < DROP_COUNT; index++) {
    animations.push(animateDrop(addPart(pop, DROP_CLASS), launchDrop(unitPx), unitPx));
  }
  return animations;
}

function popOverPickedWord() {
  const word = document.querySelector(PICKED_WORD_SELECTOR);
  if (!word) return;
  const rect = word.getBoundingClientRect();
  const radiusPx = (Math.max(rect.width, rect.height) + BUBBLE_MARGIN_PX) / 2;
  const pop = buildPop(rect, radiusPx);
  document.body.append(pop);
  const animations = animatePop(pop, radiusPx);
  Promise.all(animations.map((animation) => animation.finished))
    .then(() => pop.remove(), () => pop.remove());
}

// The pick marks the word in the same turn it sends the event, so the
// bubble waits a frame for the mark to be on the page.
document.addEventListener(RHYMES_PICKED_EVENT, () => {
  if (canPop()) requestAnimationFrame(popOverPickedWord);
});
