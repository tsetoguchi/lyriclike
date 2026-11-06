// Soap bubbles that rise behind the page in the Aero theme. They sit under
// the glass panels and the lyrics sheet, so they never cover the writing.
// The layer is always built; theme-aero.css only shows it under Aero, and a
// hidden layer runs no animation.
const LAYER_CLASS = 'aero-bubbles';
const BUBBLE_CLASS = 'aero-bubble';
// Few on purpose: each one moving under the frosted glass makes it re-blur.
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

function buildBubble([left, size, riseSeconds, sway, delayShare]) {
  const bubble = document.createElement('span');
  bubble.className = BUBBLE_CLASS;
  bubble.style.setProperty('--bubble-left', `${left}vw`);
  bubble.style.setProperty('--bubble-size', `${size}px`);
  bubble.style.setProperty('--bubble-rise', `${riseSeconds}s`);
  bubble.style.setProperty('--bubble-sway', `${sway}px`);
  bubble.style.setProperty('--bubble-delay', `${-delayShare * riseSeconds}s`);
  return bubble;
}

function buildLayer() {
  const layer = document.createElement('div');
  layer.className = LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  layer.append(...BUBBLES.map(buildBubble));
  return layer;
}

document.body.prepend(buildLayer());
