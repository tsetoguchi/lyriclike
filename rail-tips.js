// The folded sidebar's icons name themselves in a pill beside the rail when
// pointed at or tabbed to, as in Gemini. The name is each icon's aria-label,
// so items an extension script adds to the rail slot get one too. The
// browser's own title tip is taken off on first hover so two never show.
const RAIL_ID = 'sidebar-rail';
const TIP_CLASS = 'rail-tip';
const VISIBLE_CLASS = 'visible';
const ITEM_SELECTOR = 'a[aria-label], button[aria-label]';
const TIP_GAP_PX = 8;

function showRailTips(rail) {
  const tip = document.createElement('div');
  tip.className = TIP_CLASS;
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);

  function railItemFrom(target) {
    const item = target instanceof Element ? target.closest(ITEM_SELECTOR) : null;
    return item && rail.contains(item) ? item : null;
  }

  function showTip(item) {
    item.removeAttribute('title');
    tip.textContent = item.getAttribute('aria-label');
    const box = item.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    tip.style.left = `${railBox.right + TIP_GAP_PX}px`;
    tip.style.top = `${box.top + box.height / 2}px`;
    tip.classList.add(VISIBLE_CLASS);
  }

  function hideTip() {
    tip.classList.remove(VISIBLE_CLASS);
  }

  function onEnter(event) {
    const item = railItemFrom(event.target);
    if (item) showTip(item);
  }

  function onLeave(event) {
    if (!railItemFrom(event.relatedTarget)) hideTip();
  }

  rail.addEventListener('pointerover', onEnter);
  rail.addEventListener('pointerout', onLeave);
  rail.addEventListener('focusin', onEnter);
  rail.addEventListener('focusout', onLeave);
  rail.addEventListener('click', hideTip);
}

const rail = document.getElementById(RAIL_ID);
if (rail) showRailTips(rail);
