# Bar switches

On a phone, Syllables and Highlights in the bottom bar are switches. Their
icon dots show the state: hollow grey when off, filled white when on. The
labels stay grey, so a switch never looks like the selected tab.

## Sub-features

- `switch-off` an off switch has hollow dots in the label's grey.
- `switch-on` an on switch has filled dots in white, label still grey.
- `switch-no-dot` nothing is drawn under the label.
- `highlights-on` Highlights counts as on while either overlay is on.
- `places-plain` Create never changes look. Notebook's icon turns
  white while the sidebar is open; its label stays grey.

## How to get to it (user POV)

- Open the site on a phone. Tap Syllables. Open Highlights and switch the
  overlays.

## Driving it with Playwright MCP

Preconditions:

- Phone width per `phone-layout.md`, welcome tour closed.

Read a switch with:

```js
const look = id => page.evaluate(id => {
  const b = document.getElementById(id);
  const icon = b.querySelector('.nav-icon');
  // Create and Notebook icons have no circle, so guard it.
  const circle = icon.querySelector('circle');
  const dot = circle ? getComputedStyle(circle) : {};
  return { on: b.classList.contains('active'), fill: dot.fill, stroke: dot.stroke,
    icon: getComputedStyle(icon).color, label: getComputedStyle(b.querySelector('.nav-label')).color,
    under: getComputedStyle(b, '::after').content };
}, id);
```

White ink is `rgb(226, 231, 239)`, grey is `rgb(139, 150, 166)`.

- **On.** With `sessionStorage` cleared, Syllables is on.
  `look('syllable-toggle')` has
  `fill` white, `stroke` `none`, `icon` white, `label` grey, `under`
  `none`.
- **Off.** `page.click('#syllable-toggle')`. Now `fill` is `none`,
  `stroke` grey, `icon` grey.
- **Highlights.** Turn both overlays off in the Highlights menu:
  `#rhymes-menu-btn` reads off. Turn one on: it reads on.
- **Places.** `#create-btn` keeps the grey icon. Click `#notebook-btn`:
  the sidebar opens and its `icon` is white. `window.Sidebar.hide()`: grey
  again.
- **Proof.** A screenshot of the bar (`clip` the bottom 92px) with one
  switch on and one off, to `.playwright-mcp/bar-switches/`.

## Gotchas

- The desktop header shows the same buttons with its own rules. These
  colours hold only at phone width.
- Forced-colours mode paints everything one colour. Hollow against filled
  still shows the state there, colour doesn't.
