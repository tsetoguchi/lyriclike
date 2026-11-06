// Soap bubbles that rise behind the page in the Aero theme. They sit under
// the glass panels and the lyrics sheet, so they never cover the writing.
// The layer is always built; theme-aero.css only shows it under Aero.
// Each bubble is moved with the Web Animations API using plain numbers, so
// the graphics card moves it without the page redoing styles every frame.
const LAYER_CLASS = 'aero-bubbles';
const BUBBLE_CLASS = 'aero-soap aero-bubble';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MS_PER_SECOND = 1000;
// A sway takes a sixth of the rise, so a bubble weaves a few times going up.
const SWAYS_PER_RISE = 6;
// [left in vw, size in px, seconds to rise, sway in px, delay as a 0..1 share
// of the rise, so the bubbles start spread up the screen]
const BUBBLES = Object.freeze([
  [6, 140, 46, 18, 0.15],
  [82, 180, 58, 22, 0.55],
  [48, 96, 40, 14, 0.85],
  [22, 54, 30, 12, 0.4],
  [64, 38, 26, 10, 0.1],
  [91, 46, 34, 12, 0.7],
  [35, 22, 22, 8, 0.25],
  [12, 30, 28, 10, 0.95],
  [74, 18, 20, 6, 0.35],
  [56, 26, 24, 8, 0.6],
  [3, 16, 19, 6, 0.8],
  [42, 64, 36, 16, 0.05],
]);

function buildBubble(left, size) {
  const bubble = document.createElement('span');
  bubble.className = BUBBLE_CLASS;
  bubble.style.setProperty('--bubble-left', `${left}vw`);
  bubble.style.setProperty('--bubble-size', `${size}px`);
  return bubble;
}

// Up from below the screen to above it, then round again.
function animateRise(bubble, size, riseMs, delayMs) {
  const frames = [
    { transform: 'translateY(0)' },
    { transform: `translateY(calc(-100vh - ${size * 2}px))` },
  ];
  return bubble.animate(frames, {
    duration: riseMs, delay: delayMs, iterations: Infinity, easing: 'linear',
  });
}

function animateSway(bubble, sway, riseMs, delayMs) {
  const frames = [{ translate: `${-sway}px 0` }, { translate: `${sway}px 0` }];
  return bubble.animate(frames, {
    duration: riseMs / SWAYS_PER_RISE, delay: delayMs, iterations: Infinity,
    direction: 'alternate', easing: 'ease-in-out',
  });
}

// With reduced motion the bubbles are left where they start, so the sky
// keeps them but nothing moves.
function startBubble(bubble, [, size, riseSeconds, sway, delayShare], isStill) {
  const riseMs = riseSeconds * MS_PER_SECOND;
  const delayMs = -delayShare * riseMs;
  const animations = [
    animateRise(bubble, size, riseMs, delayMs),
    animateSway(bubble, sway, riseMs, delayMs),
  ];
  if (isStill) animations.forEach((animation) => animation.pause());
}

function buildLayer() {
  const layer = document.createElement('div');
  layer.className = LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  const isStill = window.matchMedia(REDUCED_MOTION_QUERY).matches;
  for (const entry of BUBBLES) {
    const bubble = buildBubble(entry[0], entry[1]);
    layer.append(bubble);
    startBubble(bubble, entry, isStill);
  }
  return layer;
}

document.body.prepend(buildLayer());
