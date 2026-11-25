# Phone gestures

On a phone, swipes move between the sidebar, Lyrics and Rhymes, and holding
Highlights opens its menu under the finger so one slide picks an overlay.

## Sub-features

- `swipe-sidebar` a swipe right anywhere on Lyrics opens the sidebar.
- `swipe-edge` a swipe right from the screen's left 20px opens the sidebar
  on any tab.
- `swipe-rhymes` a swipe left on Lyrics opens Rhymes, sidebar stays shut.
- `swipe-back` a swipe right on Rhymes goes back to Lyrics, sidebar stays
  shut.
- `hold-open` holding Highlights for 350ms opens its menu.
- `hold-pick` sliding onto an overlay and letting go switches it and shuts
  the menu.
- `hold-miss` letting go off the overlays leaves the menu open.
- `tap-menu` a quick tap on Highlights still opens and shuts the menu.
- `sheet-drag` a drag down on a word's meaning sheet (Rhymes, tap a chip)
  follows the finger; past a third of its height, or a flick, it closes,
  otherwise it springs back (sheet-drag.js).

## How to get to it (user POV)

- Open the site on a phone. Swipe across the lyrics.
- Press and hold Highlights in the bottom bar, slide up, let go.

## Driving it with Playwright MCP

Preconditions:

- Phone width per `phone-layout.md`. Close the welcome tour first:
  `page.keyboard.press('Escape')`, then `window.isCoachTourOpen()` is
  `false`.
- The test browser has no touch screen, so build the events by hand. Both
  helpers go inside `browser_run_code_unsafe`:

```js
// A swipe on the lyrics, in 6 moves.
const swipe = (fromX, toX, y = 400) => page.evaluate(([fromX, toX, y]) => {
  const target = document.getElementById('lyrics');
  const t = x => new Touch({ identifier: 1, target, clientX: x, clientY: y });
  const fire = (type, x, isDown) => target.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true, touches: isDown ? [t(x)] : [], changedTouches: [t(x)] }));
  fire('touchstart', fromX, true);
  for (let i = 1; i <= 6; i++) fire('touchmove', fromX + (toX - fromX) * i / 6, true);
  fire('touchend', toX, false);
}, [fromX, toX, y]);

// One touch pointer event on the Highlights button.
const press = (type, x, y) => page.evaluate(([type, x, y]) => {
  document.getElementById('rhymes-menu-btn').dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerType: 'touch', clientX: x, clientY: y, pointerId: 7, isPrimary: true }));
}, [type, x, y]);
```

Read the tab with
`document.querySelector('.main').classList.contains('show-rhymes')` and the
sidebar with `window.Sidebar.isOpen()`. Wait 600ms after each swipe.

- **Swipe sidebar.** On Lyrics, `swipe(150, 330)`. `Sidebar.isOpen()` is
  `true`. Shut it with `window.Sidebar.hide()`.
- **Swipe edge.** On Rhymes, `swipe(5, 200)`. The sidebar opens.
- **Swipe rhymes.** On Lyrics, `swipe(300, 120)`. The tab is Rhymes and the
  sidebar is shut.
- **Swipe back.** On Rhymes, `swipe(150, 330)`. The tab is Lyrics and the
  sidebar is shut.
- **Hold open.** Note `aria-pressed` on `#rhyme-scheme-toggle` and
  `#internal-rhyme-toggle`. `press('pointerdown', cx, cy)` at the centre of
  `#rhymes-menu-btn`, wait 450ms. `#rhymes-menu-popover` is not `hidden`.
- **Hold pick.** Wait 300ms more for the menu to finish growing, then
  `press('pointermove', ...)` at the centre of `#internal-rhyme-toggle`. It
  gains `.is-picking`. `press('pointerup', ...)` there, then
  `document.getElementById('rhymes-menu-btn').click()` to stand in for the
  click the phone sends after a hold. Internal rhymes' `aria-pressed` has
  flipped, Rhyme Scheme's hasn't, and the popover is `hidden`.
- **Hold miss.** Hold again, then `pointerup` on the button itself and the
  stand-in click. The popover stays open.
- **Tap menu.** Hold miss left the popover open. Wait 600ms,
  `page.click('#rhymes-menu-btn')`: it shuts. Click again: it opens.
- **Sheet drag.** On Rhymes, click a `#rhyme-results .rhyme-word`, wait
  700ms. Drag `.def-popup` itself straight down from 10px under its top
  with `dragSheet` below. The sheet's height follows its meaning (258 to
  337px at 852 tall, capped at half the screen), so read
  `h = document.querySelector('.def-popup').offsetHeight` first. It closes
  past `h / 3` or on a flick of 0.5px/ms. Mid-drag its inline `transform`
  is a `translateY` and `.def-overlay`'s opacity is under 1.
  `dragSheet(25, 600)` and `dragSheet(h / 3 - 10, 600)` leave it open with
  no inline transform; `dragSheet(h / 3 + 10, 600)` closes it (no
  `.def-popup` after 500ms); `dragSheet(30, 40)` closes it as a flick.

```js
// Five moves spaced with real timers, so the sheet sees the speed.
const dragSheet = (dy, ms) => page.evaluate(async ([dy, ms]) => {
  const el = document.querySelector('.def-popup');
  const r = el.getBoundingClientRect();
  const x = r.x + r.width / 2, y0 = r.y + 10;
  const t = y => new Touch({ identifier: 2, target: el, clientX: x, clientY: y });
  const fire = (type, y, isDown) => el.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true, touches: isDown ? [t(y)] : [], changedTouches: [t(y)] }));
  fire('touchstart', y0, true);
  for (let i = 1; i <= 5; i++) {
    await new Promise(done => setTimeout(done, ms / 5));
    fire('touchmove', y0 + dy * i / 5, true);
  }
  fire('touchend', y0 + dy, false);
}, [dy, ms]);
```
- **Proof.** Screenshots to `.playwright-mcp/phone-gestures/`: one with the
  sidebar open after the mid-screen swipe, one with the menu open during
  the hold.

## Gotchas

- A swipe that starts on a row that scrolls sideways, or while text is
  selected, belongs to that row. Start swipes on `#lyrics` with nothing
  selected.
- The hold helper skips the browser's own click. Without the stand-in
  `click()` you never test that the click after a hold is swallowed, and a
  bug there shuts the menu the hold just opened.
- A click within 500ms of a hold ends is eaten on purpose. Wait before the
  tap-menu step.
- Mouse presses never start a hold. A `pointerType` other than `touch`
  proves nothing.
- Space the sheet's moves with `setTimeout`. Paced by
  `requestAnimationFrame` the flick comes out too slow and the sheet stays
  open.
- Swipes do nothing while the welcome tour is open, and tab swipes do
  nothing while the sidebar is open. A swipe under 60px doesn't change
  tabs.
- Real iPhone touch can differ: the long-press callout, scroll stealing the
  drag. Ask the user to check the hold and the mid-screen swipe on an
  iPhone.
