# Tap targets

On a phone, or any touch screen, small controls get an unseen strip that
gives them a tap target's height (`--tap-target`, 44px) without moving
anything. Nothing changes on a desktop with a mouse.

## Sub-features

- `notebook-heading` the "Notebook" group heading in the sidebar (20px
  tall) takes a tap 20px above or below its middle.
- `foot-links` each link in the sidebar's foot (`#sidebar-foot-slot`,
  16px tall) takes a tap 20px above or below its middle and 11px either
  side, short of the dot between two links.
- `close-marks` the small ✕ on the welcome tour card and on panels such
  as Log in already had this (`::after` on `.modal-close`).
- `neighbours` every other control in the sidebar still takes a tap at
  its own middle.

## How to get to it (user POV)

- On a phone, open the sidebar (Notebook in the bottom bar). Tap just
  above or below "Notebook", or just above a link at the very bottom.

## Driving it with Playwright MCP

Preconditions:

- 393×852 with `isMobile` and `hasTouch`, `localStorage.tour_seen = '1'`,
  reload, then `page.click('#notebook-btn')` and wait about a second for
  the sidebar to slide in.
- Signed out, the foot slot holds only Privacy. An extension can add more,
  so stand some in: set `#sidebar-foot-slot`'s HTML to three short links
  joined by ` · `.

Test a control with `document.elementFromPoint`: a tap lands when the
element it returns is the control or inside it.

```js
const tapZone = sel => page.evaluate(sel => [...document.querySelectorAll(sel)]
  .filter(e => e.getBoundingClientRect().width)
  .map(el => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const lands = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && el.contains(t); };
    return { name: el.innerText.trim(), misses: [[0, -20], [0, 20], [-11, 0], [11, 0]]
      .filter(([dx, dy]) => !lands(cx + dx, cy + dy)) };
  }), sel);
```

- **Notebook.** `tapZone('.list-group-toggle')`: every `misses` is
  empty.
- **Foot links.** `tapZone('#sidebar-foot-slot a')`: every `misses` is
  empty.
- **Neighbours.** Every other `button` and `a[href]` in the sidebar with a
  box, outside `.account-menu-popover`, still gets its own middle back
  from `elementFromPoint`.
- Run it at 393 and 360, signed out and signed in as Ann.
- **Desktop.** At 1440 with no touch,
  `getComputedStyle(document.querySelector('.list-group-toggle'), '::after').content`
  is `none`.

## Gotchas

- Measuring a control's box isn't enough. The ✕ marks are 28px boxes with
  a 44px `::after`, so a box check calls them too small when they aren't.
- The closed account menu's rows have boxes but can't be tapped. Leave
  `.account-menu-popover` out of the neighbours check, or it fails on main
  too.
- The Notebook strip reaches 4px into the first page row below it. That
  row is 46px tall, so its middle is still clear.
