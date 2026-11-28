# Bar switches

On a phone, Syllables and Highlights in the bottom bar are switches. Their
icon dots show the state: hollow grey when off, filled white when on. The
labels stay grey, so a switch never looks like the selected tab.

On a desktop, the same switches (Syllables, Rhyme Scheme, Internal Rhymes)
sit in the header with no pill behind them. On is amber, off is grey. From
1200px wide they show their names beside the icons and sit centred over
the lyrics column. Narrower, they show icons only, with the name in a
hover tip.

## Sub-features

- `switch-off` an off switch has hollow dots in the label's grey.
- `switch-on` an on switch has filled dots in white, label still grey.
- `switch-no-dot` nothing is drawn under the label.
- `highlights-on` Highlights counts as on while either overlay is on.
- `places-plain` Create never changes look. Notebook's icon turns
  white while the sidebar is open; its label stays grey.
- `desktop-ink` in the desktop header an on switch is amber and an off
  one grey, with no fill behind either. An off switch goes white under
  the pointer.
- `desktop-names` from 1200px the names show beside the icons and the
  group is centred over the lyrics, clear of Log in or the account
  button. Below 1200px the names are hover tips.
- `desktop-forced` in forced-colours mode an off switch's dots go hollow.

## How to get to it (user POV)

- Open the site on a phone. Tap Syllables. Open Highlights and switch the
  overlays.
- Open the site on a desktop. Click the three switches at the top. Make
  the window narrower than 1200px and wider again.

## Driving it with Playwright MCP

### Phone

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
- **Highlights.** Click `#rhymes-menu-btn` to open its menu. It holds
  `#rhyme-scheme-toggle` and `#internal-rhyme-toggle` (moved down from
  the header). Turn both off: `#rhymes-menu-btn` reads off. Turn one on:
  it reads on.
- **Places.** `#create-btn` keeps the grey icon. Click `#notebook-btn`:
  the sidebar opens and its `icon` is white. `window.Sidebar.hide()`: grey
  again.
- **Proof.** A screenshot of the bar (`clip` the bottom 92px) with one
  switch on and one off, to `.playwright-mcp/bar-switches/`.

### Desktop

Preconditions:

- 1440×900, `localStorage.tour_seen = '1'`, `sessionStorage` cleared, then
  reload. Syllables and Rhyme Scheme start on, Internal Rhymes off.

Read the header with:

```js
const head = () => page.evaluate(() => {
  const group = document.querySelector('header .header-tools');
  const g = group.getBoundingClientRect();
  const lyrics = document.querySelector('.lyrics-area').getBoundingClientRect();
  const sw = ['syllable-toggle', 'rhyme-scheme-toggle', 'internal-rhyme-toggle'].map(id => {
    const b = document.getElementById(id);
    const icon = b.querySelector('.nav-icon').getBoundingClientRect();
    const name = b.querySelector('.nav-label');
    const n = name.getBoundingClientRect();
    return { id, on: b.classList.contains('active'), color: getComputedStyle(b).color,
      fill: getComputedStyle(b).backgroundColor, nameShown: getComputedStyle(name).position !== 'absolute',
      beside: Math.abs((icon.top + icon.bottom) / 2 - (n.top + n.bottom) / 2) <= 3 && n.left >= icon.right };
  });
  return { innerWidth, pill: getComputedStyle(group).backgroundColor,
    groupCentre: Math.round(g.left + g.width / 2),
    lyricsCentre: Math.round(lyrics.left + lyrics.width / 2), sw };
});
```

Amber is `rgb(233, 180, 95)`, grey `rgb(139, 150, 166)`, no fill
`rgba(0, 0, 0, 0)`.

- **Ink.** `head()`: `pill` is no fill. The two on switches have `color`
  amber, Internal Rhymes grey. Every `fill` is no fill.
- **Click.** `page.click('#internal-rhyme-toggle')`, then move the
  pointer away (`page.mouse.move(5, 600)`): it reads on and amber,
  `aria-pressed="true"`. Click it again and move away: grey.
- **Names.** At 1440 and at 1200, every switch has `nameShown` and
  `beside` true, and `groupCentre` is within 8px of `lyricsCentre`. Check
  once signed out and once signed in as Ann (see
  `running-lyriclike-locally`), and once with `window.Sidebar.hide()`.
  The group must stay at least 12px clear of the leftmost visible button
  in `#user-area` (Log in signed out, the account button signed in).
  Skip any with a zero-width box: signed in, `#sign-in-btn` is still in
  the page but hidden.
- **Resize.** At 1440, drag `#resize-handle` with `page.mouse` (down on
  its middle, move to x=700, up), then to x=1040. After each drag
  `groupCentre` is still within 8px of `lyricsCentre`.
- **Narrow.** At 1024, `nameShown` is false for all three. Colours are as
  in **Ink**.
- **Forced colours.** `page.emulateMedia({ forcedColors: 'active' })`:
  `#internal-rhyme-toggle .nav-icon circle` has `fill` `none`, and
  `#syllable-toggle`'s circle does not.
- **Proof.** Screenshots of the header (`clip` the top 70px) at 1440, 1200
  and 1024, to `.playwright-mcp/bar-switches/`.

## Gotchas

- The phone bar and the desktop header share the buttons but not the
  rules: the phone colours above hold only at phone width, and the
  desktop ones only above 768px.
- A switch you just clicked is still under the pointer. Under the pointer
  an off switch is white, not grey, so move the pointer away before you
  read it.
- `.header-right` stretches to the middle of the header. Measure the
  buttons inside it, not the box, when you check for overlap.
- Forced-colours mode paints everything one colour. Hollow against filled
  still shows the state there, colour doesn't.
