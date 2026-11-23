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
- **Tap menu.** Wait 600ms, `page.click('#rhymes-menu-btn')`: the popover
  opens. Click again: it shuts.
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
- Real iPhone touch can differ: the long-press callout, scroll stealing the
  drag. Ask the user to check the hold and the mid-screen swipe on an
  iPhone.
